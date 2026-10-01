"use strict";

/* ══════════════════════════════════════════════════════════════
   🔴🔴 v0.1.9 批 6｜刪除（_i §8-1／§8-2／§8-3；_d §13-104）
   🔴 照片從「物理刪除」改成「軟刪進垃圾桶」—— 刪除一律發生在【album_photo 層】（R-05）：
      「整張照片進垃圾桶」＝它所有 album_photo 都在垃圾桶（推算，照片層不加 deletedAt）。
      同一次刪除＝同一個 batch_id（垃圾桶裡合成一行，批 7）。本機 small／orig 留到永久刪除（R-19）。
   🔴 現行照片〔刪除〕沒有確認框 ⇒ 一律走下面的框。
   ══════════════════════════════════════════════════════════════ */
async function deleteAps(aps, batchId){
  const now=nowISO();
  for(const ap of aps){ ap.deletedAt=now; ap.batchId=batchId; await saveAlbumPhoto(ap); }
}
/* ╔═ 勾選清單框（新元件；🛑 不是 askDialog 的第四種模式，R-21）═══════════════════════════╗
   rows:[{html, on}]　actions:[{text|textFn(n), cls, value, needAny, kind:'all'}]
   · needAny：一個都沒勾 ⇒ 灰（R-31／J-4）
   · kind:'all'：把每一列都勾起來，框不關（〔這張全選〕）
   回傳 {value, checked:[布林…]}。z 52 ⇒ 蓋得過放大畫面（47），相-34。 ╚══════════════════════╝ */
let _pickRes=null;
function pickDialog(o){
  $('pickTitle').textContent=o.title||'';
  $('pickBody').innerHTML=o.body||''; $('pickBody').hidden=!o.body;
  const rowsBox=$('pickRows'), acts=$('pickActs');
  const checked=(o.rows||[]).map(r=>!!r.on);
  const paint=()=>{
    rowsBox.innerHTML='';
    (o.rows||[]).forEach((r,i)=>{
      const d=document.createElement('div'); d.className='prow';
      d.innerHTML=`<span class="box${checked[i]?' on':''}"></span><div>${r.html}</div>`;
      d.onclick=()=>{ checked[i]=!checked[i]; paint(); };
      rowsBox.appendChild(d);
    });
    acts.innerHTML='';
    const n=checked.filter(Boolean).length;
    for(const a of (o.actions||[])){
      const b=document.createElement('button'); b.className='btn'+(a.cls?' '+a.cls:'');
      b.textContent = a.textFn ? a.textFn(n) : a.text;
      b.disabled = !!(a.needAny && !n);
      b.onclick=()=>{
        if(a.kind==='all'){ checked.fill(true); paint(); return; }
        $('ovPick').hidden=true;
        const r=_pickRes; _pickRes=null; r && r({value:a.value, checked:checked.slice()});
      };
      acts.appendChild(b);
    }
  };
  paint();
  $('ovPick').hidden=false;
  return new Promise(res=>{ _pickRes=res; });
}
/* 一列＝一本含這張照片的相簿：相簿名＋「這本的備註：…」（圖 5） */
function apRowHtml(ap, curAlbumId){
  const a=albumOf(ap.albumId);
  return `${esc(albName(a))}${ap.albumId===curAlbumId?' <span class="sub">（現在這本）</span>':''}`
       + `<div class="sub">這本的備註：${esc(ap.note||'—')}</div>`;
}
/* §8-1 單張刪除。回傳刪掉了幾筆（0＝取消）。 */
async function confirmDeletePhotoFrom(curAp){
  const list=albumsOfPhoto(curAp.photoId);
  if(!list.some(x=>x.id===curAp.id)) list.unshift(curAp);
  const r=await pickDialog({ title:'要從哪幾本相簿刪掉這張？',
    body: list.length>1 ? '全部勾 ＝ 整張照片進垃圾桶。半年內可以在垃圾桶救回來。'
                        : '這張只在這本 ⇒ 會整張進垃圾桶。半年內可以在垃圾桶救回來。',
    rows: list.map(ap=>({html:apRowHtml(ap, curAp.albumId), on:ap.id===curAp.id})),
    actions:[ {text:'取消', value:'no'},
              {textFn:n=>`刪除（${n} 本）`, cls:'dangerfill', value:'del', needAny:true} ]});
  if(r.value!=='del') return 0;
  const pick=list.filter((x,i)=>r.checked[i]);
  await deleteAps(pick, uid());
  return pick.length;
}
/* §8-2 多選刪除：總結框 →〔照這樣刪〕或〔逐張確認…〕；一次多選刪除＝同一個 batch_id */
async function multiDelete(a, apIds){
  const aps=apIds.map(id=>APHOTOS.find(x=>x.id===id)).filter(Boolean);
  if(!aps.length) return;
  const only=aps.filter(ap=>albumsOfPhoto(ap.photoId).length<=1).length;
  const r=await pickDialog({ title:`刪除 ${aps.length} 張照片？`,
    body:`其中 <b>${only} 張只在這本</b>，會整張進垃圾桶；<br>另外 <b>${aps.length-only} 張只從這本拿掉</b>，其他相簿還看得到。`
        +`<br>半年內可以在垃圾桶救回來。`,
    rows:[], actions:[ {text:'取消', value:'no'}, {text:'逐張確認…', value:'each'},
                       {text:'照這樣刪', cls:'dangerfill', value:'all'} ]});
  if(r.value==='no') return;
  const batch=uid();
  if(r.value==='all'){ await deleteAps(aps, batch); }
  else{
    for(let i=0;i<aps.length;i++){
      const ap=aps[i];
      const list=albumsOfPhoto(ap.photoId);
      const p=await pickDialog({ title:`第 ${i+1} / ${aps.length} 張：${ap.name||'未命名'}`,
        body:'要從哪幾本相簿刪掉這張？',
        rows:list.map(x=>({html:apRowHtml(x, a.id), on:x.id===ap.id})),
        actions:[ {text:'這張全選', kind:'all'}, {text:'跳過這張', value:'skip'},
                  {textFn:n=>`刪除（${n} 本）`, cls:'dangerfill', value:'del', needAny:true},
                  {text:'停止', value:'stop'} ]});
      if(p.value==='stop') break;
      if(p.value==='del') await deleteAps(list.filter((x,j)=>p.checked[j]), batch);
      await reloadObjects();
    }
  }
  S.alb.multi=null;
  await reloadObjects(); renderAlbums();
}
/* §8-3 刪整本相簿：相簿進垃圾桶；它名下的每一筆 album_photo 同一批進去
   （只在這本的照片 ⇒ 整張進垃圾桶；也在別本的 ⇒ 別本不受影響）。釘子跟著相簿消失，還原時回來。 */
async function confirmDeleteAlbum(a){
  const aps=apsOf(a.id);
  const only=aps.filter(ap=>albumsOfPhoto(ap.photoId).length<=1).length;
  const ok=await askDialog({ title:`刪除「${albName(a)}」？`,
    body: aps.length
      ? `${aps.length} 張照片裡，<b>${only} 張只在這本</b>，會一起進垃圾桶；<br>另外 ${aps.length-only} 張在別的相簿還看得到。<br>半年內可以在垃圾桶整本救回來。`
      : '這是空相簿。半年內可以在垃圾桶救回來。',
    okText:'刪除相簿' });
  if(!ok) return;
  const batch=uid(), now=nowISO();
  a.deletedAt=now; a.batchId=batch; await saveAlbum(a);
  await deleteAps(aps, batch);
  S.alb.open=null; S.alb.multi=null;
  await reloadObjects(); renderAlbums(); render();
}

/* ══════════════════════════════════════════════════════════════
   🔴🔴 v0.1.9 批 6｜放大畫面（_i §5、§0b R-21／R-29／R-32／R-34、Q-A3）
   左右滑＝換張；雙指縮放（原檔、壓縮檔都能縮）；縮放後單指滑＝移動畫面；往下滑＝關閉；
   電腦：滾輪縮放、←／→ 換張、Esc 關閉（O-5：只做雙指的話電腦上沒有入口）。
   🔴 R-39：放手三條路（pointerup／pointercancel／lostpointercapture）走同一支收尾 vEnd。
   ══════════════════════════════════════════════════════════════ */
const V={ albumId:null, list:[], idx:0, url:null, origUrl:null, s:1, tx:0, ty:0 };
async function openAlbumViewer(albumId, apId){
  commitAlbumEdits();
  V.albumId=albumId;
  V.list=apsOf(albumId).map(x=>x.id);
  V.idx=Math.max(0, V.list.indexOf(apId));
  $('viewer').hidden=false;
  showViewerItem();
}
/* 用照片 id 開放大畫面：找一本有這張照片的相簿（v0.1.9 批 8 之後沒有畫面入口在叫它，留著當工具函式） */
async function openViewer(photoId){
  const ap=APHOTOS.find(x=>x.photoId===photoId);
  if(ap) return openAlbumViewer(ap.albumId, ap.id);
  V.albumId=null; V.list=[]; V.idx=0;
  $('viewer').hidden=false; showViewerItem();
}
function vRevoke(){
  if(V.url){ URL.revokeObjectURL(V.url); V.url=null; }
  if(V.origUrl){ URL.revokeObjectURL(V.origUrl); V.origUrl=null; }
}
function vApply(){ $('vImg').style.transform=`translate(${V.tx}px,${V.ty}px) scale(${V.s})`; }
function vReset(){ V.s=1; V.tx=0; V.ty=0; $('vImg').style.opacity=''; vApply(); }
async function showViewerItem(){
  vRevoke(); vReset();
  $('vLoad').textContent='';
  const im=$('vImg');
  const apId=V.list[V.idx];
  const ap=apId ? APHOTOS.find(x=>x.id===apId) : null;
  const p=ap ? PHOTOS.get(ap.photoId) : null;
  const dis=(on)=>{ ['vOrig','vMove','vDel'].forEach(id=>{ $(id).disabled=!on; }); };
  if(!ap || !p){
    /* 🔴 R-34：開著的時候被刪了（含另一台同步刪） */
    im.removeAttribute('src'); $('vPos').textContent='';
    $('vInfo').innerHTML='<b>這張照片已被刪除</b>（可能是另一台刪的，可以到垃圾桶還原）';
    $('vDiag').textContent=''; dis(false); $('vOrig').textContent='查看原檔';
    return;
  }
  dis(true);
  if(p.small){ V.url=URL.createObjectURL(p.small); im.src=V.url; } else im.removeAttribute('src');
  $('vPos').textContent = V.list.length>1 ? `${V.idx+1} / ${V.list.length}` : '';
  const others=albumsOfPhoto(ap.photoId).filter(x=>x.albumId!==ap.albumId).map(x=>albName(albumOf(x.albumId)));
  const has=hasCloudOrig(p);
  $('vInfo').innerHTML =
      `<b>${esc(ap.name||'未命名')}</b><br>`
    + (ap.note ? esc(ap.note).split(String.fromCharCode(10)).join('<br>') : '<span style="color:#777">（沒有備註）</span>')+'<br>'
    + `拍攝 ${esc(shotAtOf(p)||'—')}<br>`
    + `雲端儲存：<span class="${has?'on2':'off2'}">原檔</span>／<span class="${has?'off2':'on2 w'}">壓縮檔</span>`
    + `　<span style="color:#999">${esc(origStatusText(p))}</span>`
    + (others.length ? `<br>📎 此照片也在 ${others.length} 本相簿：${esc(others.join('、'))}` : '');
  /* 〔查看原檔（X MB）〕：這台有乾淨的原檔就用這台的；否則雲端有才可按（沒有 ⇒ 灰）。 */
  const canOrig = !!((p.orig && p.origClean) || (has && p.origPath && CLOUD.on));
  $('vOrig').disabled=!canOrig;
  $('vOrig').textContent = canOrig ? `查看原檔（${fmtBytes(p.origSize||0)}）` : '查看原檔（沒有）';
  /* 🔴 R-40：卡片上的診斷資訊保留到這裡（格式、尺寸、EXIF 方向、誰轉正、存於哪一版）＋ 本機儲存配額（pstat） */
  let est='（此瀏覽器不支援容量查詢）';
  try{ const e=await navigator.storage.estimate(); est=`本機已用 ${fmtBytes(e.usage||0)} / 上限約 ${fmtBytes(e.quota||0)}`; }catch(e){}
  if(V.list[V.idx]!==apId) return;               // 期間已換張
  $('vDiag').textContent =
      `來源 ${p.source||'—'}｜格式 ${p.mime||'—'}｜原始 ${fmtBytes(p.origSize||0)}`
    + (p.decoded ? `（${p.rawW??p.w}×${p.rawH??p.h}）` : '')
    + (p.smallSize ? `→ 壓縮 ${fmtBytes(p.smallSize)}` + ((!isLegacy(p) && p.w) ? `（${p.w}×${p.h}）` : '') : '')
    + `｜EXIF 方向 ${p.orientation ?? '無'}`
    + (isLegacy(p) ? '｜⚠️ 舊版存的，方向未處理' : (p.rotated ? `｜已轉正（${p.oriBy||'?'}）` : ''))
    + (p.err ? `｜⚠️ ${p.err}` : '')
    + `｜存於 ${verOf(p)}｜${est}`;
}
function closeViewer(){
  $('viewer').hidden=true;
  $('vImg').removeAttribute('src');
  vRevoke(); vReset();
  if(S.tab==='photo') renderAlbums();
}
$('vClose').onclick=closeViewer;
/* R-32：〔查看原檔〕⇒ 換成原檔（顯示載入中）；失敗（沒網路）⇒ 一行錯誤、維持顯示壓縮檔 */
$('vOrig').onclick=async()=>{
  const ap=APHOTOS.find(x=>x.id===V.list[V.idx]); const p=ap && PHOTOS.get(ap.photoId); if(!p) return;
  const apId=ap.id;
  $('vLoad').textContent='載入原檔中…'; $('vOrig').disabled=true;
  let blob=null;
  try{
    if(p.orig && p.origClean) blob=p.orig;
    else{
      const r=await sbFetch('/storage/v1/object/photos/'+p.origPath);
      if(!r.ok) throw new Error('HTTP '+r.status);
      blob=await r.blob();
    }
  }catch(e){
    if(V.list[V.idx]===apId){ $('vLoad').textContent='讀不到原檔（沒有網路？），先顯示壓縮檔'; $('vOrig').disabled=false; }
    return;
  }
  if(V.list[V.idx]!==apId) return;
  if(V.origUrl) URL.revokeObjectURL(V.origUrl);
  V.origUrl=URL.createObjectURL(blob);
  $('vImg').src=V.origUrl; vReset();
  $('vLoad').textContent = p.origShrunk ? '原檔（已縮小）' : '原檔';   // 🔴 Q-A2 甲
  $('vOrig').textContent = p.origShrunk ? '正在看原檔（已縮小）' : '正在看原檔';
};
/* R-29：刪除／轉移之後 ⇒ 跳到下一張；沒有下一張 ⇒ 關閉回內頁 */
async function viewerAfterRemoval(apId){
  await reloadObjects();
  const alive=new Set(apsOf(V.albumId).map(x=>x.id));
  V.list=V.list.filter(id=>alive.has(id));
  if(!V.list.length){ closeViewer(); return; }
  V.idx=Math.min(V.idx, V.list.length-1);
  showViewerItem();
}
$('vDel').onclick=async()=>{
  const ap=APHOTOS.find(x=>x.id===V.list[V.idx]); if(!ap) return;
  const n=await confirmDeletePhotoFrom(ap);
  if(n) await viewerAfterRemoval(ap.id);
};
$('vMove').onclick=()=>{
  const ap=APHOTOS.find(x=>x.id===V.list[V.idx]); if(!ap) return;
  openMenu('這張要…', [
    {label:'轉移到別本（這本就沒有了）', onClick:()=>openTargetMenu('move',[ap.id],ap.albumId,
        ()=>viewerAfterRemoval(ap.id))},
    {label:'複製到別本（這本也留著）', onClick:()=>openTargetMenu('copy',[ap.id],ap.albumId,
        ()=>{ reloadObjects().then(showViewerItem); })}
  ]);
};
function vStep(d){
  const j=V.idx+d;
  if(j<0 || j>=V.list.length){ vReset(); return; }
  V.idx=j; showViewerItem();
}
/* ── 手勢 ── */
const VP=new Map(); let VG=null;
const vStage=$('vStage');
function vCenter(){ const r=vStage.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; }
vStage.addEventListener('pointerdown', e=>{
  try{ vStage.setPointerCapture(e.pointerId); }catch(err){}
  VP.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(VP.size===2){
    const [a,b]=[...VP.values()], c=vCenter();
    VG={type:'pinch', d0:Math.hypot(a.x-b.x,a.y-b.y)||1, s0:V.s, tx0:V.tx, ty0:V.ty,
        mx:(a.x+b.x)/2-c.x, my:(a.y+b.y)/2-c.y};
  }else if(VP.size===1){
    VG={type:'one', id:e.pointerId, x0:e.clientX, y0:e.clientY, tx0:V.tx, ty0:V.ty, dx:0, dy:0};
  }
});
vStage.addEventListener('pointermove', e=>{
  if(!VP.has(e.pointerId)) return;
  VP.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(!VG) return;
  if(VG.type==='pinch' && VP.size>=2){
    const [a,b]=[...VP.values()];
    const s=Math.max(1, Math.min(6, VG.s0*(Math.hypot(a.x-b.x,a.y-b.y)/VG.d0)));
    /* 以兩指中點為不動點縮放（transform-origin 在圖片中心） */
    V.tx = VG.mx - (VG.mx - VG.tx0)*(s/VG.s0);
    V.ty = VG.my - (VG.my - VG.ty0)*(s/VG.s0);
    V.s=s; vApply(); return;
  }
  if(VG.type==='one' && VG.id===e.pointerId){
    VG.dx=e.clientX-VG.x0; VG.dy=e.clientY-VG.y0;
    if(V.s>1.02){ V.tx=VG.tx0+VG.dx; V.ty=VG.ty0+VG.dy; vApply(); return; }   // 縮放後：滑＝移動畫面
    if(Math.abs(VG.dx)>=Math.abs(VG.dy)){ V.tx=VG.dx; V.ty=0; }
    else if(VG.dy>0){ V.tx=0; V.ty=VG.dy; $('vImg').style.opacity=String(Math.max(.35, 1-VG.dy/400)); }
    vApply();
  }
});
function vEnd(e){
  if(!VP.has(e.pointerId)) return;
  VP.delete(e.pointerId);
  const g=VG;
  if(!g) return;
  if(g.type==='pinch'){
    if(VP.size<2){ VG=null; if(V.s<1.02) vReset(); }
    return;
  }
  if(g.type==='one' && g.id===e.pointerId){
    VG=null;
    if(V.s>1.02) return;                               // 縮放中放手：停在原處
    if(e.type==='pointerup'){
      if(g.dx<-60 && Math.abs(g.dx)>Math.abs(g.dy)) return vStep(+1);
      if(g.dx> 60 && Math.abs(g.dx)>Math.abs(g.dy)) return vStep(-1);
      if(g.dy> 90 && g.dy>Math.abs(g.dx)) return closeViewer();
    }
    vReset();                                          // 被系統取消／搶走 ⇒ 一律回原位（不換張、不關閉）
  }
}
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>vStage.addEventListener(ev, vEnd));
vStage.addEventListener('wheel', e=>{
  e.preventDefault();
  const c=vCenter(), s0=V.s, s=Math.max(1, Math.min(6, s0*(e.deltaY<0?1.15:1/1.15)));
  const mx=e.clientX-c.x, my=e.clientY-c.y;
  V.tx = mx-(mx-V.tx)*(s/s0); V.ty = my-(my-V.ty)*(s/s0); V.s=s;
  if(s<1.02) vReset(); else vApply();
},{passive:false});
document.addEventListener('keydown', e=>{
  if($('viewer').hidden || !$('ovPick').hidden || !$('ovMenu').hidden || !$('ovAsk').hidden) return;
  if(e.key==='ArrowRight') vStep(+1);
  else if(e.key==='ArrowLeft') vStep(-1);
  else if(e.key==='Escape') closeViewer();
});
