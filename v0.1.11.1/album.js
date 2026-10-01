"use strict";

/* 🔴 O-13：這一筆是舊版存的嗎？判準用 rawW（舊紀錄一定沒有）。 */
const isLegacy = r => (r.rawW===undefined || r.rawW===null);
const verOf = r => r.appVer || (isLegacy(r)? 'v0.1.2（舊）' : 'v0.1.2.1');

let _urls=[];
function revokeAll(){ _urls.forEach(u=>URL.revokeObjectURL(u)); _urls=[]; }
function objURL(b){ const u=URL.createObjectURL(b); _urls.push(u); return u; }

/* ⚠️ 環境偵測：某些情境下 IndexedDB 會被【整個擋掉】，且錯誤訊息看起來像程式壞了。
   → 要先講清楚「這是環境，不是程式」（留什麼：整段一字不動；v0.1.9 R-40：搬到相簿清單頁最上面）。 */
function envNote(){
  const bad = (location.protocol==='data:' || location.origin==='null');
  return bad ? `<div class="pstat" style="border-color:var(--warnB)">
      🔴 <b>這個環境擋住了瀏覽器儲存</b>（來源：<code>${location.origin}</code>／<code>${location.protocol}</code>）。<br>
      IndexedDB 與 localStorage 都用不了 → <b>照片存不進去，這不是程式的問題。</b><br>
      ⚠️ 請改用 <b>正式網址</b>（有正式的來源）開啟本頁再測。</div>` : '';
}

/* ══════════════════════════════════════════════════════════════
   🔴🔴 v0.1.9 批 5｜相簿畫面（_i §3 清單頁、§4 內頁、§6 多選、§7 轉移／複製、§9-1 上傳入口）
   ── R-40 舊照片分頁控制項的處置（O-27：沒有「沒提到」這個選項）───────────────
     〔📷 拍照〕〔🖼️ 從相簿選〕　🔁 換成〔📷〕＋〔＋ 上傳到：… ▾〕（R-36；#fCam／#fLib 兩個 input 留著）
     〔改名〕　　　　　　　　　 🔁 點名字改（album_photo 的名字，不是 photos.name —— photos.name 凍結，舊版在讀）
     〔標到平面圖／重新標位置〕 🔁 內頁〔📍 指定位置〕／〔📍 在平面圖上看位置〕（定位模式＝批 8）
     〔刪除〕（沒有確認框）　　 🔁 放大畫面／多選的〔刪除〕＋勾選清單框（批 6）
     卡片上的診斷文字　　　　　 ✅ 搬到放大畫面最下面一行小字（批 6）
     pstat（張數／本機配額）　　✅ 本機配額搬到放大畫面最下面；張數不再顯示（「張數不是資訊」）
     envNote（儲存被擋的警告） ✅ 搬到相簿清單頁最上面
     「還沒有照片」空狀態　　　 🔁「還沒有相簿」
   ══════════════════════════════════════════════════════════════ */
S.alb = { open:null, multi:null, flash:null };   // open＝打開中的相簿 id；multi＝多選中的 album_photo id 集合
S.dbNote = '';
S.photoMsg = '';
let PHOTOS = new Map();                           // 照片本身（reloadObjects 載入；含 Blob）
const albumOf = id => ALBUMS.find(a=>a.id===id) || null;
const byApSort = (a,b)=> (Number(a.sort)||0)-(Number(b.sort)||0)
  || String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || String(a.id).localeCompare(String(b.id));
function apsOf(albumId){ return APHOTOS.filter(x=>x.albumId===albumId).sort(byApSort); }
/* 這張照片在哪幾本【活的】相簿裡（活的 album_photo 且相簿本身沒被刪） */
function albumsOfPhoto(photoId){ return APHOTOS.filter(x=>x.photoId===photoId && albumOf(x.albumId)); }
const hasCloudOrig = p => !!(p && p.origStatus==='has');
const albName = a => (a && a.name) ? a.name : '（沒有名字的相簿）';
/* ╔═ 🔴 v0.1.10 P9（§0d ⑦）｜相簿序號與顏色（雲端發、App 只讀）═══════════════════════════════╗
   PAL＝40 個淡色（CIELAB L* 78～90）。🔴 長度與雲端 SQL 的 `color < 40`、`generate_series(0, 39)` 一致（O-37：三處一起改）。
   算法與對比結果見施工紀錄批 4：
     深色外框 #3a3a3a 對淺色平面圖底色 ≥ 10.4:1；淡色機身對深色主題底色 ≥ 9.3:1；外框對機身 ≥ 6.3:1；
     深字 #222 對白鏡頭 15.9:1；相鄰號碼 ΔE2000 ≥ 20.2；任兩色 ≥ 7.4（前 12 色兩兩 ≥ 12.4）。
   排序＝「先挑離已選最遠的」（maximin），再調成相鄰號碼差 ≥ 20 ⇒ 同一專案先發的號（前面幾色）最分得開。 ╚═╝ */
const PAL = ["#f7bebf", "#32d4de", "#e5e799", "#adbffe", "#f1b57d", "#7dd2a1", "#e9aded", "#bfe9fa", "#e8defc", "#bac5a8", "#7bc9fc", "#f4e0c5", "#b1efe2", "#d7bf76", "#d7b8cd", "#c3eeb4", "#dbbaa9", "#9ac9cc", "#f9aacb", "#56d5c0", "#faaf96", "#b3ca7f", "#bcbfdd", "#e5e4c5", "#ccb5fe", "#96f1fa", "#ccc0a3", "#37d1f7", "#d0e9d0", "#c3d9f5", "#8cf6d1", "#fcdfa2", "#97ccb8", "#fed8e9", "#a1c6da", "#71f7ec", "#ffdbcb", "#edccfc", "#ffcea8", "#a8cb9c"];
const PIN_OUTLINE = '#3a3a3a', PIN_TEXT = '#222', NO_COLOR = '#e4e4e4';   // 還沒拿到顏色（未連線／還沒同步）＝淡灰
const albColor  = a => (a && a.color!=null && PAL[a.color]) ? PAL[a.color] : NO_COLOR;
const albNoText = a => (a && a.no!=null) ? '#'+a.no : '#—';               // 還沒拿到序號 ⇒「#—」（Ali 10-01：可以）
function recentAlbumIds(){
  try{ const a=JSON.parse(LS.get(RECENT_ALBUMS_KEY)||'[]'); return Array.isArray(a)? a : []; }catch(e){ return []; }
}
/* §3：最近有變動的相簿排最上（R-16 推算，不存） */
async function sortedAlbums(){
  const rec=await albumRecency();
  return ALBUMS.slice().sort((a,b)=> String(rec.get(b.id)||'').localeCompare(String(rec.get(a.id)||''))
                                   || String(a.id).localeCompare(String(b.id)));
}
/* ▾ 選單與轉移目標選單「同一份清單、同樣排序」（§7）：最近用過 3 本置頂，其餘照最近變動 */
function targetOrder(sorted){
  const rec=recentAlbumIds().filter(id=>sorted.some(a=>a.id===id));
  return rec.map(id=>sorted.find(a=>a.id===id)).concat(sorted.filter(a=>!rec.includes(a.id)));
}

/* ── 選單（▾／轉移目標／⋯）──
   🔴 R-37：選單項目的 onClick 在【同一個點擊事件】裡同步執行（中間不 await）⇒ 要開選檔時 iPhone 不會擋。 */
let _menuUrls=[];
function openMenu(title, items){
  _menuUrls.forEach(u=>URL.revokeObjectURL(u)); _menuUrls=[];
  const box=$('menuBox'); box.innerHTML='';
  if(title){ const t=document.createElement('div'); t.className='mt'; t.textContent=title; box.appendChild(t); }
  for(const it of items){
    const b=document.createElement('button'); b.className='mi'+(it.cls?' '+it.cls:'');
    b.textContent=it.label;
    if(it.thumb){ const u=URL.createObjectURL(it.thumb); _menuUrls.push(u);   // R-35：封面小縮圖
      const im=document.createElement('img'); im.src=u; im.alt=''; b.prepend(im); }
    if(it.swatch){ const s=document.createElement('span'); s.className='csw'; s.style.background=it.swatch; b.prepend(s); }   // 🔴 v0.1.10 P9
    if(it.sub){ const s=document.createElement('span'); s.className='ms'; s.textContent=it.sub; b.appendChild(s); }
    b.disabled=!!it.disabled;
    b.onclick=e=>{ e.stopPropagation(); closeMenu(); it.onClick && it.onClick(); };
    box.appendChild(b);
  }
  const c=document.createElement('button'); c.className='mi'; c.textContent='取消';
  c.onclick=()=>closeMenu(); box.appendChild(c);
  $('ovMenu').hidden=false;
}
function closeMenu(){ $('ovMenu').hidden=true; }
$('ovMenu').addEventListener('click', e=>{ if(e.target.id==='ovMenu') closeMenu(); });

/* ── 上傳入口（§9-1、R-36、R-37）── */
let _pickTarget='new';
function pickUpload(kind, target){
  _pickTarget = target || 'new';
  const inp=$(kind==='cam' ? 'fCam' : 'fLib');
  inp.value='';
  inp.click();                                  // 🔴 同步呼叫（在使用者的點擊裡）
}
async function onPickFiles(e, source){
  const files=[...(e.target.files||[])];
  e.target.value='';
  if(!files.length) return;                     // 🔴 R-37／相-29：取消選檔 ⇒ 什麼都不做（不會多出空相簿）
  S.photoMsg='';
  /* 🔴 v0.1.10 P1：整批結束【一定】走到「寫訊息＋重畫」（v0.1.9 丟錯時整段中斷、畫面什麼都沒有） */
  try{
    const res=await uploadFiles(files, source, _pickTarget);
    S.photoMsg=res.msgs.join('\n');             // 🔴 R-13：存不進去／做不出壓縮版的那幾張，頁面上說原因（不跳視窗）
    /* 🔴 v0.1.10 P2：內頁 ⇒ 這一批每一張都閃、捲到第一張；首頁（新相簿）⇒ 閃整本卡片（照舊） */
    if(res.made && res.albumId) S.alb.flash={albumId:res.albumId, last:true, apIds:res.apIds};
  }catch(err){
    S.photoMsg='這次加照片中途出錯：'+((err&&err.name)||'Error')+'｜'+((err&&err.message)||err);
  }finally{
    await renderAlbums(); render();
  }
}
$('fCam').onchange=e=>onPickFiles(e,'拍照');
$('fLib').onchange=e=>onPickFiles(e,'相簿');
function uploadRow(target, sorted){
  const row=document.createElement('div'); row.className='atop';
  const full = usageLevel()==='full';           // 🔴 §9-4：≥ 95% ⇒〔📷〕〔上傳到〕變灰
  const cam=document.createElement('button'); cam.className='abtn'; cam.textContent='📷';
  cam.title='拍照'; cam.disabled=full; cam.onclick=()=>pickUpload('cam', target);
  const up=document.createElement('span'); up.className='upl';
  const main=document.createElement('button'); main.className='abtn pri';
  main.textContent = `＋ 上傳到：${target==='new' ? '新相簿' : '這本'}`;
  main.disabled=full; main.onclick=()=>pickUpload('lib', target);
  const dd=document.createElement('button'); dd.className='abtn pri dd'; dd.textContent='▾';
  dd.title='換一本'; dd.disabled=full;
  dd.onclick=()=>{
    const items=[];
    if(target!=='new'){
      const cur=albumOf(target);
      items.push({label:`✓ 這本（${albName(cur)}）`, cls:'cur', onClick:()=>pickUpload('lib', target)});
    }
    items.push({label: target==='new' ? '✓ 新相簿' : '新相簿', cls: target==='new'?'cur':'', onClick:()=>pickUpload('lib','new')});
    for(const a of targetOrder(sorted)){
      if(a.id===target) continue;
      items.push({label:albName(a), onClick:()=>pickUpload('lib', a.id)});
    }
    openMenu('上傳到哪一本？（選了就開始選照片）', items);
  };
  up.appendChild(main); up.appendChild(dd);
  row.appendChild(cam); row.appendChild(up);
  return row;
}
/* ── 用量條（§9-4：常駐、同一條、不跳視窗；滿格＝1 GB） ── */
function usageBox(thin){
  const d=document.createElement('div');
  if(!CLOUD.on){ if(thin) return null; d.className='usage'; d.textContent='未連線：照片只存這台'; return d; }
  const U=S.usage, lv=usageLevel();
  if(thin && lv!=='warn' && lv!=='full') return null;   // 內頁的細條只在 ≥ 70% 出現（B7-c，建造者定）
  d.className='usage'+(lv==='warn'?' warn':lv==='full'?' full':'')+(thin?' thin':'');
  if(!U || U.total==null){ d.textContent='雲端用量：讀取中'; return d; }
  const head = lv==='full' ? `🔴 雲端用量 ${fmtBytes(U.total)} / 1 GB ⇒ 暫停上傳`
             : lv==='warn' ? `⚠️ 雲端用量 ${fmtBytes(U.total)} / 1 GB ⇒ 新照片只存壓縮版`
             : `雲端用量 ${fmtBytes(U.total)} / 1 GB`;
  const h=document.createElement('div'); h.textContent=head+(U.fake?'（測試值）':''); d.appendChild(h);
  const bar=document.createElement('div'); bar.className='ubar';
  const i=document.createElement('i'); i.style.width=Math.min(100, U.total/USAGE_CAP*100).toFixed(1)+'%';
  bar.appendChild(i); d.appendChild(bar);
  if(!thin){
    const s=document.createElement('div'); s.className='scrubt'; s.style.margin='3px 0 0';
    s.textContent=`其中原檔 ${fmtBytes(U.orig||0)}`; d.appendChild(s);
    if(lv==='warn' || lv==='full'){
      const acts=document.createElement('div'); acts.className='uacts';
      /* 🔴 v0.1.9 批 7（B7-c）：〔備份原檔〕＝相簿清單一次一本 ⇒ 批 9 的 exportAlbumZip；〔刪除雲端的原檔〕＝勾選 ⇒ 確認 ⇒ 先改列再刪檔 */
      for(const [t,fn,id] of [['備份原檔',openBackupOrig,'btnBackupOrig'],['刪除雲端的原檔',openPurgeOrig,'btnPurgeOrig']]){
        const b=document.createElement('button'); b.className='abtn sm'; b.textContent=t; b.id=id;
        b.onclick=()=>fn();
        acts.appendChild(b);
      }
      d.appendChild(acts);
    }
  }
  return d;
}
/* 頁面上方的狀態（環境、資料庫錯誤、搬家進度、上傳結果） */
function albNotes(){
  const d=document.createElement('div');
  let h=envNote();
  if(S.dbNote) h+=`<div class="pstat" style="border-color:var(--warnB)">🔴 ${esc(S.dbNote)}</div>`;
  h+=`<div class="pstat" id="albMig"${S.migrate?'':' hidden'}>${S.migrate?`正在整理舊照片（${S.migrate.done} / ${S.migrate.total}）`:''}</div>`;
  if(S.photoMsg) h+=`<div class="pstat"><span class="bad">${esc(S.photoMsg).split(String.fromCharCode(10)).join('<br>')}</span></div>`;
  d.innerHTML=h;
  return d;
}
function showAlbMsg(t){ S.photoMsg=t; renderAlbums(); }

/* ── 畫面：相簿分頁的進入點（舊名 renderPhotos 保留：cloudSync／cloudLeave／setTab 都叫它）── */
/* 下一幀做一次（rAF 在分頁被藏起來時不會跑 ⇒ 另掛一個 setTimeout 保底，兩個之中先到的那個做，只做一次） */
function nextFrame(fn){
  let done=false; const go=()=>{ if(done) return; done=true; fn(); };
  requestAnimationFrame(go); setTimeout(go, 50);
}
let _albSeq=0;
async function renderAlbums(){
  const box=$('albView'); if(!box) return;
  /* 🔴 正在打字（改名／備註）時不重畫：同步、用量這類背景事件會在任何時候叫 renderAlbums，
     重畫會把輸入框整個換掉 ＝ 吃掉她打的字。存完（startEdit 的 finish）自己會再畫一次。 */
  if(_albEdit) return;
  const seq=++_albSeq;
  let sorted=[];
  try{ sorted=await sortedAlbums(); }
  catch(e){
    box.innerHTML = envNote() || `<div class="pstat" style="border-color:var(--warnB)">
      🔴 瀏覽器儲存讀取失敗：${esc(e.name)}｜${esc(e.message)}<br>
      常見原因：無痕視窗、瀏覽器設定擋網站資料、或裝置空間不足。</div>`;
    return;
  }
  if(seq!==_albSeq) return;                      // 期間又被叫了一次 ⇒ 讓新的那一次畫
  revokeAll(); box.innerHTML='';
  if(S.tab==='photo') renderLayerBar();          // 🔴 v0.1.9 §3：清單頁／內頁切換時，圖層列那一條（搜尋佔位框）跟著換
  if(S.alb.open) renderAlbumInner(box, sorted);
  else renderAlbumList(box, sorted);
}
function renderPhotos(){ return renderAlbums(); }

/* ── 清單頁（圖 1）── */
function renderAlbumList(box, sorted){
  box.appendChild(albNotes());
  box.appendChild(uploadRow('new', sorted));
  const u=usageBox(false); if(u) box.appendChild(u);
  /* 🗂 _d §13-108：搜尋框的位置預留在這裡（本批不做功能、不畫元素）。 */
  if(!sorted.length){
    const e=document.createElement('div'); e.className='empty';
    e.innerHTML='<span class="ic">📷</span>還沒有相簿';
    box.appendChild(e); return;
  }
  for(const a of sorted){
    const aps=apsOf(a.id);
    const card=document.createElement('div'); card.className='alb'; card.dataset.album=a.id;
    const h=document.createElement('div'); h.className='ah';
    const n=document.createElement('span'); n.className='an'; n.textContent=albName(a);
    const no=document.createElement('span'); no.className='ano'; no.textContent=albNoText(a);   // 🔴 v0.1.10 P9：#3 在名稱左邊
    /* 🔴 §3：不寫張數（「分類才是資訊，張數不是資訊」）；R-35：「📍 已定位」只是文字、不能點 */
    const m=document.createElement('span'); m.className='am';
    m.textContent = (a.locX!=null && a.locY!=null) ? '📍 已定位' : '未定位';
    if(!aps.length){ const d=document.createElement('span'); d.className='csw'; d.style.background=albColor(a); h.appendChild(d); }   // 空相簿沒有拖曳條 ⇒ 色點
    h.appendChild(no); h.appendChild(n); h.appendChild(m);
    if(!aps.length){ const e=document.createElement('span'); e.className='am'; e.textContent='空相簿'; h.appendChild(e); }   // R-33
    const go=document.createElement('button'); go.className='abtn sm'; go.textContent='進入相簿';
    h.appendChild(go);
    h.onclick=()=>openAlbum(a.id);                 // 點名稱那一行或〔進入相簿〕⇒ 內頁
    card.appendChild(h);
    const strip=document.createElement('div'); strip.className='astrip';
    if(!aps.length){ const e=document.createElement('div'); e.className='empty1'; strip.appendChild(e); }
    for(const ap of aps){
      const p=PHOTOS.get(ap.photoId);
      const t=document.createElement('div'); t.className='tn'; t.dataset.ap=ap.id;
      if(p && p.small){ const im=document.createElement('img'); im.src=objURL(p.small); im.alt=''; im.draggable=false; t.appendChild(im); }
      else { t.classList.add('ph'); t.textContent = p ? '還沒下載' : '已不在'; }   // R-50 🟡-15
      if(p && !hasCloudOrig(p)){ const o=document.createElement('span'); o.className='origbar'; t.appendChild(o); }
      /* 🔴 v0.1.10 P6（§5）：首頁縮圖【短按＝進入那本相簿，那一張捲到畫面中並閃一下】、【長按 0.8 秒＝放大那一張】。
         原生橫捲：有滑動就不會發 click；一開始橫捲瀏覽器會發 pointercancel ⇒ bindLongPress 清掉計時器。
         🔴 iOS 慣性捲動中「點一下讓它停」可能發 click ⇒ 捲動停下 150 ms 內的 click 不算（_stripScrollAt）。
         長按觸發之後 _suppressClickUntil 擋掉緊接的 click（clickOk）。 */
      t.onclick=e=>{ if(!clickOk() || Date.now()-(strip._scrollAt||0) < 150) return;
        S.alb.flash={albumId:a.id, apId:ap.id}; openAlbum(a.id); };
      if(p && p.small) bindLongPress(t, ()=>openAlbumViewer(a.id, ap.id));
      strip.appendChild(t);
    }
    strip.addEventListener('scroll', ()=>{ strip._scrollAt=Date.now(); }, {passive:true});   // P6：慣性捲動點停不算點
    card.appendChild(strip);
    /* 🔴 v0.1.10 P5：拿掉「1 / N」（Ali：「這個是看容量不是看張數的」）⇒ 只放拖曳條；P8：滑塊＝相簿色 */
    if(aps.length){ const sc=scrubber(strip, aps.length, albColor(a)); card.appendChild(sc.el); }
    /* 🔴 v0.1.11.1 R9：短按範圍＝整張卡片。標頭（.ah）與縮圖（.tn）各有自己的 handler（縮圖＝進入＋閃），這裡只接「其他地方」：
       縮圖列的空白、卡片邊緣、空相簿的空格 ⇒ 只進入、不閃。🛑 進度條（.scrub）拖完放手也會發 click ⇒ 必須排除，否則拖完就誤進相簿。
       慣性捲動點停（_scrollAt 150 ms）與長按後緊接的 click（clickOk）照縮圖的規則不算。 */
    card.onclick=e=>{ if(e.target.closest('.ah,.tn,.scrub')) return;
      if(!clickOk() || Date.now()-(strip._scrollAt||0) < 150) return;
      openAlbum(a.id); };
    box.appendChild(card);
  }
  applyFlash(box);
}
/* ╔═ 🔴 §3｜可拖的進度條（v0.1.10 P5：「1 / N」不再放上畫面；label 仍回傳，沒有人接）（取代 ● ○ ○）═══════════════════════════════════════╗
   橫排本身用【原生】橫向捲動（手勢、慣性、pointercancel 都由瀏覽器處理，少一套自己的手勢）；
   進度條是自己的拖曳 ⇒ 🔴 R-39：pointerup／pointercancel／lostpointercapture 走同一支收尾。 ╚═══╝ */
function scrubber(strip, n, color){
  const el=document.createElement('div'); el.className='scrub';
  const tr=document.createElement('div'); tr.className='tr';
  const th=document.createElement('div'); th.className='th'+(color?' col':'');
  if(color) th.style.background=color;              // 🔴 v0.1.10 P8：滑塊＝該相簿的顏色
  el.appendChild(tr); el.appendChild(th);
  const label=document.createElement('div'); label.className='scrubt';
  const sync=()=>{
    const W=el.clientWidth||1, max=Math.max(0, strip.scrollWidth-strip.clientWidth);
    const ratio = strip.scrollWidth ? Math.min(1, strip.clientWidth/strip.scrollWidth) : 1;
    const tw=Math.max(14, W*ratio);
    th.style.width=tw+'px';
    th.style.left=(max? (strip.scrollLeft/max)*(W-tw) : 0)+'px';
    const tns=[...strip.querySelectorAll('.tn')];
    let idx=0;
    for(let i=0;i<tns.length;i++){ if(tns[i].offsetLeft+tns[i].offsetWidth/2 >= strip.scrollLeft){ idx=i; break; } }
    if(max && strip.scrollLeft>=max-1) idx=tns.length-1;
    label.textContent=`${idx+1} / ${n}`;
  };
  strip.addEventListener('scroll', sync, {passive:true});
  let drag=null;
  const setFromX=(x)=>{
    const r=el.getBoundingClientRect(), max=Math.max(0, strip.scrollWidth-strip.clientWidth);
    const f=Math.min(1, Math.max(0, (x-r.left)/Math.max(1,r.width)));
    strip.scrollLeft=f*max;
  };
  el.addEventListener('pointerdown', e=>{
    e.stopPropagation();
    try{ el.setPointerCapture(e.pointerId); }catch(err){}
    drag={id:e.pointerId}; setFromX(e.clientX);
  });
  el.addEventListener('pointermove', e=>{ if(drag && drag.id===e.pointerId) setFromX(e.clientX); });
  const end=e=>{ if(drag && drag.id===e.pointerId){ drag=null; sync(); } };
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>el.addEventListener(ev,end));
  label.textContent=`1 / ${n}`;                   // 先給字（量不到寬度時也不會是一片空白）
  nextFrame(sync);                                // O-1：排版之後才量得到寬度
  return {el, label};
}
function applyFlash(box){
  const f=S.alb.flash; if(!f) return;
  S.alb.flash=null;
  nextFrame(()=>{
    if(S.alb.open){
      const cards=[...box.querySelectorAll('.apc')];
      /* 🔴 v0.1.10 P2：一次上傳多張 ⇒ 這一批每一張都閃（同一次），畫面捲到這一批的【第一張】 */
      if(f.apIds && f.apIds.length){
        const cs=f.apIds.map(id=>box.querySelector(`.apc[data-ap="${id}"]`)).filter(Boolean);
        if(cs.length){ try{ cs[0].scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){} cs.forEach(c=>c.classList.add('flash')); }
        return;
      }
      const c = f.apId ? box.querySelector(`.apc[data-ap="${f.apId}"]`) : (f.last ? cards[cards.length-1] : null);
      if(c){ try{ c.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){} c.classList.add('flash'); }
    }else{
      const c=box.querySelector(`.alb[data-album="${f.albumId}"]`);
      if(c){
        try{ c.scrollIntoView({block:'nearest', behavior:'smooth'}); }catch(e){}
        const st=c.querySelector('.astrip'); if(st && f.last) st.scrollLeft=st.scrollWidth;   // 新照片在最後 ⇒ 滑過去
        c.classList.add('flash');
      }
    }
  });
}

/* ── 打開／離開一本相簿 ── */
function openAlbum(id){
  commitAlbumEdits();
  S.alb.open=id; S.alb.multi=null;
  renderAlbums().then(()=>{ try{ $('photoPage').scrollTop=0; }catch(e){} });
}
function closeAlbum(){
  commitAlbumEdits();
  S.alb.open=null; S.alb.multi=null;
  renderAlbums();
}

/* ── 就地編輯（名字／備註／相簿名）：存檔顆粒度沿用 cardInput（即時改記憶體、blur／Enter 才存）──
   🔴 同時只會有一個編輯中的欄位；commitAlbumEdits() 是唯一的收尾（blur、Enter、切分頁、
      visibilitychange、進多選、開放大、離開相簿 —— 七條入口都走它，比照 commitAngEdit 的做法）。 */
let _albEdit=null;
function commitAlbumEdits(){
  if(!_albEdit) return;
  const f=_albEdit; _albEdit=null;
  return f();
}
function startEdit(host, opts){
  /* 🔴 v0.1.11.1 R7：同時只有一個編輯框。前一個（若還開著）就地收尾——存下目前內容、【不重畫】——再開這一個；
     這一個的存檔等前一個存完（兩個 save 不搶同一筆）。
     （舊寫法：commitAlbumEdits() 回傳的 Promise 沒人等；前一個 finish 在 await save 之後才 renderAlbums()，
       那時新編輯框已登記成 _albEdit ⇒ 被「打字中不重畫」守衛吃掉 ⇒ 前一個輸入框留在畫面上。） */
  const prev=_albEdit; _albEdit=null;
  const prevP = prev ? prev({quiet:true}) : null;
  const ta = opts.multiline;
  const ed=document.createElement(ta ? 'textarea' : 'input');
  ed.className='ed'; ed.value=opts.value||'';
  if(opts.placeholder) ed.placeholder=opts.placeholder;
  host.replaceWith(ed);
  let done=false;
  const finish=async(save, o)=>{
    if(done) return; done=true;
    if(_albEdit===commit) _albEdit=null;
    if(prevP){ try{ await prevP; }catch(e){} }
    if(save) await opts.save(ed.value);
    if(opts.onClose) opts.onClose();
    /* 有別的編輯框接手了（_albEdit 有值）或被要求安靜收尾 ⇒ 不能 renderAlbums()（會被守衛擋掉，或把接手的框換掉）：
       把這個輸入框就地換回原本的顯示元素；接手的那個存完時會整頁重畫一次。 */
    if((o && o.quiet) || _albEdit){
      if(ed.isConnected){ const v=ed.value.trim(); if(save && v) host.textContent=v; ed.replaceWith(host); }
      return;
    }
    await reloadObjects(); renderAlbums();
  };
  const commit=(o)=>finish(true, o);
  _albEdit=commit;
  ed.addEventListener('blur', ()=>finish(true));
  ed.addEventListener('keydown', e=>{
    /* 單行（名稱、相簿名）：Enter ⇒ 直接存（不靠 blur：視窗沒有焦點時 blur 不會發，O-17 ②）。
       🔴 R5：備註（textarea）Enter＝換行，不存；存檔走〔儲存〕、blur、切分頁／鎖屏、開別的編輯框。 */
    if(e.key==='Enter' && !ta){ e.preventDefault(); finish(true); }
    if(e.key==='Escape'){ e.preventDefault(); finish(false); }
  });
  ed.onclick=e=>e.stopPropagation();
  setTimeout(()=>{ ed.focus(); try{ ed.select && !ta && ed.select(); }catch(e){} }, 20);
  return ed;
}

/* ── 內頁（圖 2）＋ 多選（圖 3）── */
function renderAlbumInner(box, sorted){
  const a=albumOf(S.alb.open);
  if(!a){
    /* 🔴 R-34：開著的時候被刪（含另一台同步刪）⇒ 講出來，給一個回去的路 */
    const g=document.createElement('div'); g.className='gonebox';
    g.innerHTML='這本相簿已被刪除（可能是另一台刪的，可以到垃圾桶還原）。<br><br>';
    const b=document.createElement('button'); b.className='abtn'; b.textContent='← 相簿'; b.onclick=closeAlbum;
    g.appendChild(b); box.appendChild(g); S.alb.multi=null; return;
  }
  const aps=apsOf(a.id);
  const multi=S.alb.multi;
  if(multi){ for(const id of [...multi]) if(!aps.some(x=>x.id===id)) multi.delete(id); }
  box.appendChild(albNotes());
  /* 第一排 */
  const top=document.createElement('div'); top.className='atop';
  if(multi){
    const c=document.createElement('button'); c.className='abtn'; c.textContent='取消';
    c.onclick=()=>{ S.alb.multi=null; renderAlbums(); };
    const t=document.createElement('span'); t.className='ttl2'; t.textContent=`已選 ${multi.size} 張`;
    const all=document.createElement('button'); all.className='abtn'; all.textContent='全選';
    all.onclick=()=>{ aps.forEach(x=>multi.add(x.id)); renderAlbums(); };
    top.appendChild(c); top.appendChild(t); top.appendChild(all);
  }else{
    const back=document.createElement('button'); back.className='abtn'; back.textContent='← 相簿'; back.onclick=closeAlbum;
    const tno=document.createElement('span'); tno.className='ano'; tno.textContent=albNoText(a);   // 🔴 v0.1.10 P9：另一個 span（startEdit 只動 t）
    const t=document.createElement('span'); t.className='ttl2 edit'; t.textContent=albName(a);
    t.title='點一下改名稱';
    const rename=(el)=>startEdit(el||t, {value:a.name||'', placeholder:'相簿名稱',
      save: async v=>{ a.name=String(v).trim(); await saveAlbum(a); }});
    t.onclick=()=>rename(t);
    const more=document.createElement('button'); more.className='abtn'; more.textContent='⋯';
    more.onclick=()=>openMenu(albName(a), [
      {label:'改相簿名稱', onClick:()=>{ const tt=box.querySelector('.ttl2.edit'); if(tt) rename(tt); }},
      {label:'多選', disabled:!aps.length, onClick:()=>enterMulti(null)},
      {label:'刪除這本相簿（進垃圾桶）', cls:'danger', onClick:()=>confirmDeleteAlbum(a)}
    ]);
    top.appendChild(back); top.appendChild(tno); top.appendChild(t); top.appendChild(more);
  }
  box.appendChild(top);
  /* 🔴 v0.1.10 P9：標題下一條細色線（內頁沒有拖曳條）；還沒拿到顏色就不畫 */
  if(a.color!=null){ const ln=document.createElement('div'); ln.className='acline'; ln.style.background=albColor(a); box.appendChild(ln); }
  /* 第二排 */
  if(!multi){
    const row=uploadRow(a.id, sorted);
    const located=(a.locX!=null && a.locY!=null);
    const loc=document.createElement('button'); loc.className='abtn';
    loc.textContent = located ? '📍 顯示位置' : '📍 指定位置';
    loc.onclick=()=>albumLocateEntry(a, located);
    const zip=document.createElement('button'); zip.className='abtn'; zip.textContent='匯出 zip';
    zip.onclick=()=>albumExportEntry(a);
    row.appendChild(loc); row.appendChild(zip);
    box.appendChild(row);
    const u=usageBox(true); if(u) box.appendChild(u);
  }
  if(!aps.length){
    const e=document.createElement('div'); e.className='empty'; e.textContent='空相簿';
    box.appendChild(e);
  }
  const list=document.createElement('div'); list.className='aplist';
  for(const ap of aps) list.appendChild(photoCard(a, ap, multi));
  box.appendChild(list);
  if(multi){
    const tool=document.createElement('div'); tool.className='atool';
    const mk=(t,fn)=>{ const b=document.createElement('button'); b.className='abtn'; b.textContent=t;
      b.disabled=!multi.size; b.onclick=fn; tool.appendChild(b); };
    mk('➡️ 轉移', ()=>openTargetMenu('move', [...multi], a.id, ()=>{ S.alb.multi=null; }));
    mk('⧉ 複製', ()=>openTargetMenu('copy', [...multi], a.id, ()=>{ S.alb.multi=null; }));
    mk('🗑 刪除', ()=>multiDelete(a, [...multi]));
    box.appendChild(tool);
  }
  applyFlash(box);
}
function enterMulti(firstId){
  commitAlbumEdits();
  S.alb.multi=new Set(firstId ? [firstId] : []);
  renderAlbums();
}
/* 長按進多選（🔴 ✋1：≡ 只做排序，卡片其他地方長按才進多選） */
let _suppressClickUntil=0;
const LONG_PRESS_MS = 800;       // 🔴 v0.1.10 P4：500 → 800 ms（內頁進多選、首頁縮圖長按＝放大，共用這一支）
function bindLongPress(el, onLong){
  let t=null, sx=0, sy=0, pid=null;
  const clear=()=>{ if(t){ clearTimeout(t); t=null; } pid=null; };
  el.addEventListener('pointerdown', e=>{
    if(e.target.closest('.grip,button,input,textarea')) return;
    pid=e.pointerId; sx=e.clientX; sy=e.clientY;
    t=setTimeout(()=>{ t=null; _suppressClickUntil=Date.now()+600; onLong(); }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e=>{ if(e.pointerId===pid && Math.hypot(e.clientX-sx, e.clientY-sy)>8) clear(); });
  ['pointerup','pointercancel','lostpointercapture','pointerleave'].forEach(ev=>el.addEventListener(ev, clear));
  el.addEventListener('contextmenu', e=>e.preventDefault());   // Android 長按選單
}
const clickOk = ()=> Date.now() >= _suppressClickUntil;
function photoCard(a, ap, multi){
  const p=PHOTOS.get(ap.photoId);
  const c=document.createElement('div'); c.className='apc'+(multi?' multi':'')+(multi&&multi.has(ap.id)?' picked':'');
  c.dataset.ap=ap.id;
  if(multi){
    const ck=document.createElement('span'); ck.className='ck'+(multi.has(ap.id)?' on':''); c.appendChild(ck);
    c.onclick=()=>{ if(!clickOk()) return; multi.has(ap.id)? multi.delete(ap.id) : multi.add(ap.id); renderAlbums(); };
  }
  const tb=document.createElement('div'); tb.className='tbox';
  if(p && p.small){ const im=document.createElement('img'); im.src=objURL(p.small); im.alt=''; im.draggable=false; tb.appendChild(im); }
  else tb.textContent = p ? '還沒下載' : '已不在';
  if(p && !hasCloudOrig(p)){ const o=document.createElement('span'); o.className='origbar'; tb.appendChild(o); }
  if(!multi) tb.onclick=e=>{ e.stopPropagation(); if(!clickOk()) return; if(p && p.small) openAlbumViewer(a.id, ap.id); };
  c.appendChild(tb);
  const tx=document.createElement('div'); tx.className='tx';
  const l1=document.createElement('div'); l1.className='l1';
  const nm=document.createElement('span'); nm.className='nm2'+(ap.name?'':' ph'); nm.textContent=ap.name||'未命名';
  l1.appendChild(nm);
  const nt=document.createElement('div'); nt.className='nt'+(ap.note?'':' noval');
  nt.textContent = ap.note || '（沒有備註）';
  if(!multi){
    nm.onclick=e=>{ e.stopPropagation(); if(!clickOk()) return;
      startEdit(nm, {value:ap.name||'', placeholder:'照片名稱',
        save: async v=>{ ap.name=String(v).trim(); await saveAlbumPhoto(ap); }}); };
    const nb=document.createElement('button'); nb.className='nbtn'; nb.textContent='修改備註';
    /* 🔴 v0.1.11.1 R6：按〔修改備註〕⇒ 變成淡藍的〔儲存〕；按〔儲存〕存檔並變回〔修改備註〕。
       R6×blur：桌面／Android 按按鈕時 mousedown 會先讓 textarea 失焦（blur 已經存檔、可能先重畫）
       ⇒ ① mousedown 在編輯中 preventDefault（焦點不離開）② pointerdown 記下「按下去時是不是〔儲存〕」，
       click 照那個記號決定是存還是開始編輯（不看 click 當下的狀態）。 */
    let noteEditing=false, armSave=false;
    const noteClose=()=>{ noteEditing=false; nb.textContent='修改備註'; nb.classList.remove('on'); };
    nb.addEventListener('pointerdown', ()=>{ armSave=noteEditing; });
    nb.addEventListener('mousedown', e=>{ if(noteEditing) e.preventDefault(); });
    nb.onclick=e=>{ e.stopPropagation();
      if(armSave || noteEditing){ armSave=false; commitAlbumEdits(); return; }
      noteEditing=true; nb.textContent='儲存'; nb.classList.add('on');
      startEdit(nt, {value:ap.note||'', multiline:true, placeholder:'備註', onClose:noteClose,
        save: async v=>{ ap.note=String(v); await saveAlbumPhoto(ap); }}); };
    l1.appendChild(nb);
  }
  tx.appendChild(l1); tx.appendChild(nt);
  const st=statusLine(p);
  if(st) tx.appendChild(st);
  c.appendChild(tx);
  if(!multi){
    const g=document.createElement('span'); g.className='grip'; g.textContent='≡'; g.title='按住拖＝改順序';
    bindGrip(g, c, a, ap);
    c.appendChild(g);
    bindLongPress(c, ()=>enterMulti(ap.id));
  }
  return c;
}
/* §9-3：每張卡片的上傳狀態（排隊／上傳中／失敗（點一下重試））—— 外觀建造者定：一行小字 */
function statusLine(p){
  const d=document.createElement('div'); d.className='st';
  if(!p){ d.textContent='這張照片已不在（可能在另一台被永久刪除）'; return d; }
  const parts=[];
  if(!p.storagePath) parts.push(CLOUD.on ? '⏳ 排隊中（還沒上雲端）' : '只存在這台');
  if(p.origStatus==='pending' && p.orig) parts.push(CLOUD.on ? '⬆ 原檔排隊中' : '原檔等連線後上傳');
  if(p.origStatus==='skipped') parts.push('雲端已滿，只存壓縮版');
  if(!parts.length && p.origStatus!=='failed') return null;
  d.textContent=parts.join('　');
  if(p.origStatus==='failed'){
    const r=document.createElement('span'); r.className='retry';
    r.textContent=(parts.length?'　':'')+'⚠️ 原檔上傳失敗（點一下重試）';
    r.title=p.origErr||'';
    r.onclick=async e=>{ e.stopPropagation();
      const q=await lGet('photos',p.id); if(!q) return;
      q.origStatus = q.orig ? 'pending' : 'failed'; q.origErr = q.orig ? null : '這台沒有原檔';
      await savePhoto(q); await reloadObjects(); renderAlbums(); kickOrigQueue(); };
    d.appendChild(r);
  }
  return d;
}
/* ╔═ ≡ 按住拖＝改順序（§4；第一張＝封面）═══════════════════════════════════════════════╗
   🔴 R-39：放手三條路同一支收尾；排序拖到邊緣自動捲（requestAnimationFrame，收尾時一定取消）。
   只寫被拖的那一筆（sort 取前後兩筆的中間值，Q：「拖一次只改一列」）。 ╚═════════════════════════╝ */
let _grip=null;
function bindGrip(grip, card, a, ap){
  grip.addEventListener('pointerdown', e=>{
    e.preventDefault(); e.stopPropagation();
    commitAlbumEdits();
    try{ grip.setPointerCapture(e.pointerId); }catch(err){}
    const page=$('photoPage');
    const st={pid:e.pointerId, y0:e.clientY, lastY:e.clientY, st0:page.scrollTop, page,
              cards:[...card.parentNode.querySelectorAll('.apc')], raf:0};
    card.classList.add('dragging');
    st.apply=()=>{ card.style.transform=`translateY(${(st.lastY-st.y0)+(page.scrollTop-st.st0)}px)`; };
    const loop=()=>{
      const r=page.getBoundingClientRect(); let v=0;
      if(st.lastY < r.top+56) v=-9; else if(st.lastY > r.bottom-56) v=9;
      if(v){ page.scrollTop+=v; st.apply(); }
      st.raf=requestAnimationFrame(loop);
    };
    st.raf=requestAnimationFrame(loop);
    _grip=st;
  });
  grip.addEventListener('pointermove', e=>{ const st=_grip; if(!st || st.pid!==e.pointerId) return; st.lastY=e.clientY; st.apply(); });
  const end=async e=>{
    const st=_grip; if(!st || st.pid!==e.pointerId) return;
    _grip=null; cancelAnimationFrame(st.raf);
    const r=card.getBoundingClientRect(), cy=r.top+r.height/2;
    card.style.transform=''; card.classList.remove('dragging');
    const others=st.cards.filter(x=>x!==card);
    let ins=others.length;
    for(let i=0;i<others.length;i++){ const q=others[i].getBoundingClientRect(); if(cy < q.top+q.height/2){ ins=i; break; } }
    await moveApTo(a.id, ap.id, ins);
  };
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>grip.addEventListener(ev, end));
}
async function moveApTo(albumId, apId, ins){
  const all=apsOf(albumId), me=all.find(x=>x.id===apId); if(!me) return;
  const rest=all.filter(x=>x.id!==apId);
  if(ins===all.indexOf(me)){ renderAlbums(); return; }   // 放回原位 ⇒ 不存（拿掉自己之後，原位的插入點就是原索引）
  const prev=rest[ins-1], next=rest[ins];
  const ps=prev? Number(prev.sort)||0 : null, ns=next? Number(next.sort)||0 : null;
  me.sort = (ps!=null && ns!=null) ? (ps+ns)/2 : (ps!=null ? ps+1 : (ns!=null ? ns-1 : 1));
  await saveAlbumPhoto(me);
  await reloadObjects(); renderAlbums();
}

/* ╔═ §7｜轉移／複製 ════════════════════════════════════════════════════════════════════╗
   目標選單＝與「上傳到 ▾」同一份清單、同樣排序；🛑 不放〔＋ 新相簿〕（B5）。
   R-30：全部都已在 ⇒ 那本灰（寫「已在此相簿」）；部分已在 ⇒ 可選，已在的略過並說一句。
   轉移＝那筆 album_photo 改掛到目標（名字、備註跟著走），排到最後；複製＝目標多一筆，名字備註抄一份。
   §0c（🟠-10）：只有【轉入】那本跳到最上面（轉出那本沒有列變動，推算不到，接受）。 ╚═══════════╝ */
async function openTargetMenu(mode, apIds, fromAlbumId, after){
  const sorted=await sortedAlbums();
  const aps=apIds.map(id=>APHOTOS.find(x=>x.id===id)).filter(Boolean);
  const items=[];
  for(const t of targetOrder(sorted)){
    if(t.id===fromAlbumId) continue;
    const inT=new Set(apsOf(t.id).map(x=>x.photoId));
    const already=aps.filter(x=>inT.has(x.photoId)).length;
    items.push({ label:albName(t),
      sub: already===aps.length ? '已在此相簿' : (already ? `${already} 張已在，會略過` : ''),
      disabled: already===aps.length,
      onClick: ()=>doTransfer(mode, aps, t.id).then(()=>{ after && after(); renderAlbums(); }) });
  }
  if(!items.length) items.push({label:'沒有別的相簿可以選', disabled:true});
  openMenu(mode==='move' ? `轉移 ${aps.length} 張到哪一本？` : `複製 ${aps.length} 張到哪一本？`, items);
}
async function doTransfer(mode, aps, targetId){
  const t=albumOf(targetId); if(!t) return 0;
  const inT=new Set(apsOf(targetId).map(x=>x.photoId));
  let sort=Math.max(0, ...apsOf(targetId).map(x=>Number(x.sort)||0));
  let done=0, skip=0;
  for(const ap of aps){
    if(inT.has(ap.photoId)){ skip++; continue; }
    sort+=1;
    if(mode==='move'){ ap.albumId=targetId; ap.sort=sort; await saveAlbumPhoto(ap); }
    else{
      await saveAlbumPhoto(newObj({ id:uid(), albumId:targetId, photoId:ap.photoId,
        name:ap.name||'', note:ap.note||'', sort, deletedAt:null, batchId:null, restoredAt:null, purgedAt:null }));
    }
    inT.add(ap.photoId); done++;
  }
  touchRecentAlbum(targetId);
  await reloadObjects();
  S.photoMsg = (done ? `${mode==='move'?'轉移':'複製'}了 ${done} 張到「${albName(t)}」。` : '')
             + (skip ? `${skip} 張已經在「${albName(t)}」裡，略過。` : '');
  return done;
}

/* 內頁的兩顆：〔📍 指定位置／在平面圖上看位置〕（批 8）、〔匯出 zip〕（批 9） */
function albumLocateEntry(a, located){ return startAlbumLocate(a.id, located); }
function albumExportEntry(a){ return exportAlbumZip(a.id); }
