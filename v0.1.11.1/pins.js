"use strict";

/* 🗂 v0.1.9 R-23：舊的〔標到平面圖〕整族（startPin／#pinning 的繫結／dropMarker／MARKERS／loadMarkers／showMarker）拿掉。
   markers 表 v0.1.9 只讀（搬家用，直接讀 IndexedDB），平面圖不再畫它。 */
/* ══════════════════════════════════════════════════════════════
   🔴🔴 v0.1.9 批 8｜平面圖上的相簿釘子＋預覽卡＋定位模式（_i §10、§0b R-20～R-28、R-34、R-35、§0c R-50）
   狀態（三個，互斥由呼叫端維護）：
     S.loc     ＝ 定位模式 {albumId, phase:'locating'|'done', x, y}（x／y 公分；第一次進來還沒點 ⇒ null）
     S.pinSel  ＝ 選中的那根釘子（相簿 id）　S.pinCard ＝ 預覽卡開著
   🔴 R-20：家具選取（S.selId）與釘子【互斥】—— 進定位、點釘子都先 select(null)；select(有值) 會清掉釘子。
   🔴 R-20：定位面板是【另一個元素】#pinSel（共用 .sel 的 CSS，不共用 #sel）；判準 pinPanelShown()。
   ══════════════════════════════════════════════════════════════ */
function pinPanelShown(){ return !!(S.loc && S.tab==='plan' && S.loc.x!=null && albumOf(S.loc.albumId)); }
function pinCardShown(){ return !!(S.pinCard && S.pinSel && !S.loc && S.tab==='plan' && albumOf(S.pinSel)); }
/* 清掉釘子這一邊的狀態（家具被選中、點空白處、換分頁時） */
function clearPinState(){
  S.loc=null; S.pinSel=null; S.pinCard=false;
}
/* 🔴 R-24：兩個入口都自動點亮平面圖的 📷 層 —— 🔴 寫 S.layers.plan，不可用 L()（O-30：L() 相對於目前分頁）；
   key 'photo' 不改（改了會把她存的圖層狀態丟掉，A-11）。 */
function lightPhotoLayer(){
  if(!S.layers.plan) S.layers.plan = {};
  if(S.layers.plan.photo !== true){ S.layers.plan.photo = true; saveLayers(); }
}
/* 釘子的世界座標：定位中的那一根用暫存位置 */
function pinWorld(a){
  if(S.loc && S.loc.albumId===a.id) return (S.loc.x!=null) ? {x:S.loc.x, y:S.loc.y} : null;
  return (a.locX!=null && a.locY!=null) ? {x:a.locX, y:a.locY} : null;
}
/* ╔═ §10-1｜畫釘子（R-22：畫在畫面座標 _uiLayer；尺寸固定、不隨縮放）══════════════════════╗
   圖示＝相機（方框＋快門鈕＋白色鏡頭）。🔄 v0.1.10 P9：機身＝相簿色（淡色＋深框）、鏡頭裡＝序號；選中＝粗框＋白光環（見下方）。
   📷 層管釘子、🅰 層管相簿名稱；🔴 定位中那一根不受 📷 控制（R-50 🟡-8）。
   錯開：兩根太近（螢幕距離 < PIN_GAP_PX）⇒ 畫面上錯開、細線連回真正位置；
         🔴 定位中／選中的那一根不參與錯開（固定在真位置），定位中時它附近的其他釘子變淡。
   _uiLayer 內順序（R-22）：房間名 → 家具名 → 釘子 → HUD。 ╚═══════════════════════════════════╝ */
const PIN_HIT_PX = 22, PIN_GAP_PX = 30;
let _pinScreen = [];           // 最近一次畫出來的位置（相對 svg 的畫面座標）＝命中判斷的唯一來源
function drawPins(){
  _pinScreen=[];
  const locId = S.loc ? S.loc.albumId : null;
  const all = shown('photo');
  const list=[];
  for(const a of ALBUMS){
    const w=pinWorld(a); if(!w) continue;
    if(!all && a.id!==locId) continue;
    const s=w2s(w.x, w.y);
    list.push({a, rx:s.x, ry:s.y, fixed:(a.id===locId || a.id===S.pinSel)});
  }
  list.sort((p,q)=> (q.fixed-p.fixed) || String(p.a.id).localeCompare(String(q.a.id)));   // 決定性：兩台畫法一樣
  const placed=[];
  const clash=(x,y)=>placed.some(q=>Math.hypot(q.x-x, q.y-y) < PIN_GAP_PX);
  for(const p of list){
    let x=p.rx, y=p.ry;
    if(!p.fixed && clash(x,y)){
      for(let k=0;k<18;k++){
        const r=PIN_GAP_PX*(1+Math.floor(k/6)), ang=(k%6)*Math.PI/3 - Math.PI/2;
        const nx=p.rx+Math.cos(ang)*r, ny=p.ry+Math.sin(ang)*r;
        if(!clash(nx,ny)){ x=nx; y=ny; break; }
      }
    }
    p.x=x; p.y=y; placed.push(p);
  }
  const {w:W,h:H}=svgSize();
  const locP = locId ? placed.find(p=>p.a.id===locId) : null;
  for(const p of placed){
    if(p.x<-30 || p.y<-30 || p.x>W+30 || p.y>H+30) continue;       // 畫面外：不畫、也點不到
    const sel = (p.a.id===locId || p.a.id===S.pinSel);
    const dim = !!(locP && p!==locP && Math.hypot(p.x-locP.x, p.y-locP.y) < 70);
    const g=el('g',{'data-pin':p.a.id, 'pointer-events':'none', opacity: dim ? .35 : 1});
    if(Math.abs(p.x-p.rx)>0.5 || Math.abs(p.y-p.ry)>0.5){
      g.appendChild(el('line',{x1:p.rx,y1:p.ry,x2:p.x,y2:p.y, stroke:'var(--sub)','stroke-width':1}));
      g.appendChild(el('circle',{cx:p.rx,cy:p.ry,r:2.5, fill:'var(--sub)'}));
    }
    /* ╔═ 🔴 v0.1.10 P9｜相機＝淡色機身＋深色外框；白鏡頭裡是【序號】（不再是張數；v0.22 R-33「空相簿寫 0」作廢）═╗
       選中（定位中／預覽卡那一根，同一個 sel）：不靠顏色 ⇒ 外框加粗＋外圈白光環＋深色細圈（藍色系相簿也看得出來）。 ╚═╝ */
    const col=albColor(p.a);
    const b=el('g',{transform:`translate(${p.x},${p.y})`});
    if(sel){
      b.appendChild(el('rect',{x:-21,y:-16,width:42,height:33,rx:8, fill:'none', stroke:PIN_OUTLINE, 'stroke-width':1.5, opacity:.55}));
      b.appendChild(el('rect',{x:-19.5,y:-14.5,width:39,height:30,rx:7, fill:'none', stroke:'#fff', 'stroke-width':3}));
    }
    b.appendChild(el('rect',{x:-16,y:-11,width:32,height:23,rx:4, fill:col,
      stroke:PIN_OUTLINE, 'stroke-width': sel ? 3 : 1.5}));
    b.appendChild(el('rect',{x:6,y:-16,width:7,height:5,rx:1.5, fill:col, stroke:PIN_OUTLINE, 'stroke-width':1}));
    b.appendChild(el('circle',{cx:0,cy:1,r:8, fill:'#fff', stroke:PIN_OUTLINE, 'stroke-width':1}));
    const ns = p.a.no!=null ? String(p.a.no) : '—';
    const t=el('text',{x:0,y:5,'text-anchor':'middle','font-size': ns.length>=3 ? 8.5 : 11,'font-weight':700, fill:PIN_TEXT});
    t.textContent=ns; b.appendChild(t);
    g.appendChild(b);
    _uiLayer.appendChild(g);
    if(shown('name')) uiText(p.x+20, p.y+4, albName(p.a), {size:11, fill:'var(--ink)', clamp:false});
    _pinScreen.push({albumId:p.a.id, x:p.x, y:p.y});
  }
}
/* 🔴 R-22：命中【收集全部】（舊碼的 .find 只回第一根） */
function pinsAt(sx, sy){
  return _pinScreen.filter(p=>Math.hypot(p.x-sx, p.y-sy) <= PIN_HIT_PX);
}

/* ── 預覽卡（§10-2）── */
let _cardFor=null, _cardUrls=[];
function buildPinCard(albumId){
  _cardUrls.forEach(u=>URL.revokeObjectURL(u)); _cardUrls=[];
  _cardFor=albumId;
  const a=albumOf(albumId); if(!a) return;
  /* 🔴 v0.1.10 P9：名稱旁放同色小方塊＋序號（顏色一路對得起來） */
  $('pcName').innerHTML=`<span class="csw" style="background:${albColor(a)}"></span>${esc(albNoText(a))} ${esc(albName(a))}`;
  const st=$('pcStrip'); st.innerHTML='';
  const aps=apsOf(albumId);
  if(!aps.length){ const e=document.createElement('div'); e.className='empty1'; st.appendChild(e); }
  for(const ap of aps){
    const p=PHOTOS.get(ap.photoId);
    const t=document.createElement('div'); t.className='tn';
    if(p && p.small){ const u=URL.createObjectURL(p.small); _cardUrls.push(u);
      const im=document.createElement('img'); im.src=u; im.alt=''; im.draggable=false; t.appendChild(im);
      /* §10-2：手指【沒滑動就放開】＝點一下 ⇒ 放大那一張（原生橫捲：有滑動就不會發 click） */
      t.onclick=()=>openAlbumViewer(albumId, ap.id);
    }else{ t.classList.add('ph'); t.textContent = p ? '還沒下載' : '已不在'; }
    if(p && !hasCloudOrig(p)){ const o=document.createElement('span'); o.className='origbar'; t.appendChild(o); }
    st.appendChild(t);
  }
}
function openPinCard(albumId){
  select(null);
  S.loc=null; S.pinSel=albumId; S.pinCard=true;
  buildPinCard(albumId);
  render(); syncSel();
  ensurePinVisible(albumId, true);
}
/* §10-1：按下去手指範圍裡仍有 ≥ 2 根 ⇒ 清單；R-35：每列加封面小縮圖（同名分得出來） */
function openPinList(ids){
  const items=ids.map(id=>{
    const a=albumOf(id), aps=apsOf(id), p=aps.length ? PHOTOS.get(aps[0].photoId) : null;
    return {label:`${albNoText(a)} ${albName(a)}`, sub:`${aps.length} 張`, thumb:(p && p.small) || null, swatch:albColor(a), onClick:()=>openPinCard(id)};
  });
  openMenu(`這裡有 ${ids.length} 本，要看哪一本？`, items);
}
/* ╔═ §4／§10-2（Q-11）：釘子在畫面外 ⇒ 捲到中央；預覽卡蓋住它 ⇒ 往上推到卡片上方 ════════════╗
   只平移、不動 zoom（centerOnBeam／ensureVisible 的原則）。卡片高度要在它顯示之後的下一幀量（O-1）。 ╚═╝ */
function ensurePinVisible(albumId, withCard){
  const a=albumOf(albumId); if(!a) return;
  const w=pinWorld(a); if(!w) return;
  const {w:W,h:H}=svgSize(); if(!(W>0 && H>0)) return;
  const s=w2s(w.x, w.y);
  if(s.x<SVG_PAD || s.y<SVG_PAD || s.x>W-SVG_PAD || s.y>H-SVG_PAD){
    S.panX = W/2 - w.x*S.zoom; S.panY = H/2 - w.y*S.zoom;
    render(); syncSel();
  }
  const cover=()=>{
    const card = withCard ? $('pinCard') : $('pinSel');
    if(!card || card.hidden) return;
    const cr=card.getBoundingClientRect(), sr=svg.getBoundingClientRect();
    if(!cr.height) return;
    const s2=w2s(w.x, w.y), pinY=sr.top+s2.y, limit=cr.top-40;
    if(pinY>limit){ S.panY -= (pinY-limit); render(); syncSel(); }
  };
  nextFrame(cover);
}

/* ── 定位模式（§10-3、_d §13-109）── */
/* 入口：內頁〔📍 指定位置〕（未定位）／〔📍 在平面圖上看位置〕（已定位 ⇒ 選中＋預覽卡） */
function startAlbumLocate(albumId, located){
  commitAlbumEdits();
  lightPhotoLayer();
  setTab('plan');
  if(located){ openPinCard(albumId); return; }
  select(null);
  S.pinSel=null; S.pinCard=false;
  S.loc={albumId, phase:'locating', x:null, y:null};      // 🔴 R-26：還沒點任何地方 ⇒ 什麼都沒存
  renderLayerBar(); render(); syncSel();                    // 🔴 R-28：第一次定位畫面不動
}
/* 預覽卡〔修正定位位置〕⇒ 回到定位中（R-28：把釘子捲進可見範圍） */
function startFixLocate(albumId){
  const a=albumOf(albumId); if(!a) return;
  select(null);
  S.pinSel=null; S.pinCard=false;
  S.loc={albumId, phase:'locating', x:a.locX, y:a.locY};
  render(); syncSel();
  ensurePinVisible(albumId, false);
}
/* 定位中「點＝移過去」（接在 endPointer 同一個分支，R-23）。第一次點下去釘子出現、面板立刻出現（相-20）。 */
function locMoveTo(x, y){
  if(!S.loc || S.loc.phase!=='locating') return;
  S.loc.x=x; S.loc.y=y;
  render(); syncSel();
}
/* 方向鍵：步長與家具同一個 nudgeCm（隨縮放變）；🔴 R-50：定位完成後不能移（面板上的方向鍵變灰） */
function locNudge(dir){
  const L2=S.loc; if(!L2 || L2.phase!=='locating' || L2.x==null) return;
  const st=nudgeCm();
  if(dir==='u') L2.y-=st; if(dir==='d') L2.y+=st;
  if(dir==='l') L2.x-=st; if(dir==='r') L2.x+=st;
  render(); syncSel();
}
/* 〔定位完成〕＝存下【當下】的位置，不管有沒有改（Ali：「不管有沒有修改都要儲存當下的狀態」） */
async function locSave(){
  const L2=S.loc; if(!L2 || L2.x==null) return;
  const a=albumOf(L2.albumId); if(!a) return;
  a.locX=L2.x; a.locY=L2.y;
  await saveAlbum(a);
  await reloadObjects();
}
async function locDone(){
  const L2=S.loc; if(!L2) return;
  if(L2.phase==='locating'){ await locSave(); if(S.loc) S.loc.phase='done'; }
  else S.loc.phase='locating';                              // 〔重新定位〕⇒ 回到定位中（不需要確認框）
  render(); syncSel();
}
/* 〔取消定位〕⇒ 先問 ⇒ 定位點清成空（🔑 與家具〔收回清單〕記住座標刻意不同） */
async function locCancel(){
  const L2=S.loc; if(!L2) return;
  const ok=await askDialog({title:'取消這本相簿的定位？', body:'位置不會被記住。之後要重新指定位置。<br>相簿和裡面的照片都不受影響。', okText:'取消定位'});
  if(!ok) return;
  const a=albumOf(L2.albumId);
  if(a){ a.locX=null; a.locY=null; await saveAlbum(a); await reloadObjects(); }
  S.loc=null;
  render(); syncSel();
}
/* 🔴 R-25：定位中切到別的分頁 ⇒ 視同〔定位完成〕（setTab 的第 11 件事）；R-26：還沒點過 ⇒ 什麼都不存 */
function leavePlanPinState(){
  const L2=S.loc;
  if(L2 && L2.phase==='locating' && L2.x!=null) locSave().catch(e=>cloudErr(e));
  clearPinState();
}
function openAlbumFromPlan(albumId){
  clearPinState();
  S.alb.open=albumId; S.alb.multi=null;
  setTab('photo');
}
/* 每一幀：面板、預覽卡、提示條的顯示（syncSel 第一行呼叫；#sel 本身的行為一行不改） */
function syncPinUI(){
  if(S.loc && !albumOf(S.loc.albumId)) S.loc=null;                       // 🔴 R-34：定位中那本被刪（含同步刪）
  if(S.pinSel && !albumOf(S.pinSel)){ S.pinSel=null; S.pinCard=false; }
  const hint=$('locHint');
  if(hint) hint.hidden = !(S.loc && S.loc.phase==='locating' && S.tab==='plan');
  const pan=$('pinSel');
  if(pan){
    pan.hidden=!pinPanelShown();
    if(!pan.hidden){
      const a=albumOf(S.loc.albumId), locating=(S.loc.phase==='locating');
      $('pinName').textContent=albName(a);
      const d=$('pinDone'); d.textContent = locating ? '定位完成' : '重新定位';
      d.classList.toggle('pri', locating);
      $('pinOpen').disabled = locating;                                  // 相-21：定位中〔打開相簿〕是灰的
      [...$('pinPad').querySelectorAll('button')].forEach(b=>{ b.disabled=!locating; });
      $('pinPadc').textContent = nudgeCm()+' cm';
    }
  }
  const card=$('pinCard');
  if(card){
    const show=pinCardShown();
    card.hidden=!show;
    if(show && _cardFor!==S.pinSel) buildPinCard(S.pinSel);
  }
}
/* 面板與預覽卡的按鈕 */
$('pinBack').onclick=()=>locCancel();
$('pinDone').onclick=()=>locDone();
$('pinOpen').onclick=()=>{ if(S.loc && S.loc.phase==='done') openAlbumFromPlan(S.loc.albumId); };
$('pinFold').onclick=()=>{ const s=$('pinSel'); s.classList.toggle('mini');
  $('pinFold').textContent = s.classList.contains('mini') ? '▴' : '▾'; };
[...$('pinPad').querySelectorAll('button')].forEach(b=> bindRepeat(b, ()=>locNudge(b.dataset.d)));
$('pcFix').onclick=()=>{ if(S.pinSel) startFixLocate(S.pinSel); };
$('pcOpen').onclick=()=>{ if(S.pinSel) openAlbumFromPlan(S.pinSel); };
/* 預覽卡往下滑＝收起（🔴 R-39：放手三條路同一支收尾；只在卡片的把手／標題那一帶起手，照片橫排是原生捲動） */
{
  const card=$('pinCard'); let g=null;
  card.addEventListener('pointerdown', e=>{
    if(e.target.closest('button') || e.target.closest('.astrip')) return;
    try{ card.setPointerCapture(e.pointerId); }catch(err){}
    g={id:e.pointerId, y0:e.clientY, dy:0};
  });
  card.addEventListener('pointermove', e=>{
    if(!g || g.id!==e.pointerId) return;
    g.dy=Math.max(0, e.clientY-g.y0);
    card.style.transform = g.dy ? `translateY(${g.dy}px)` : '';
  });
  const end=e=>{
    if(!g || g.id!==e.pointerId) return;
    const dy=g.dy; g=null; card.style.transform='';
    if(e.type==='pointerup' && dy>50){ S.pinSel=null; S.pinCard=false; render(); syncSel(); }
  };
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>card.addEventListener(ev, end));
}
