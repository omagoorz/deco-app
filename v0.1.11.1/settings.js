"use strict";
async function refreshProj(){
  try{ $('btnTrash').textContent='垃圾桶 '+(await trashSize())+' 行 ›'; }
  catch(e){ $('btnTrash').textContent='垃圾桶 — 行 ›'; }
  if(S.trash && S.trash.open) renderTrash();        // 🔴 v0.1.9 批 7：同步完／清清單完，垃圾桶頁開著就重畫
  refreshSettings();
  buildBeamRows();
  refreshDiag();
}

/* ══════════════════════════════════════════════════════════════
   🔴 v0.12_i 需求 44-b／44-c｜設定頁：專案名字／全域樓高／逐根樑的下垂量
   存檔顆粒度沿用需求 7：即時改記憶體、blur／Enter 才存；無效值加紅框、失焦還原。
   🔴 44-c：存檔【成功與失敗都要】在欄位旁邊看得到（v0.13_i 修十一 F-17）——
      不可以只寫在同步對話框裡（她不會為了確認一個欄位去開同步對話框）。
   ══════════════════════════════════════════════════════════════ */
function setSaveNote(id, txt, cls){
  const b=$(id); if(!b) return;
  b.className='savenote'+(cls?' '+cls:'');
  b.textContent=txt||'';
}
/* ╔═ 🔴 v0.20_i §4-1a ②｜「這一次有沒有動到樓高」的快照 ═══════════════════════════╗
   🔴🔴 **不可以在 blur 時才記舊值**（前刀 A-9，obs O-24 在同一個檔案的第二次）：
      pjFloorH 的 **input handler 早就把新值寫進 PROJECT.floorH 了**
      ⇒ 到 blur 時 PROJECT.floorH **已經是新值** ⇒ 任何「比對舊值」必定相等
      ⇒ hChanged 恆為 false ⇒ floor_h_updated_at 永遠不寫 ⇒ 畫面完全安靜。
   ✅ 所以快照要在 **focus**（她還沒開始打字）時拍。
   ⚠️ 也要在 refreshSettings() 填值時同步記一份 —— 因為她可能**沒有 focus 過就同步了**。 */
let _hSnapshot = null;
function refreshSettings(){
  const n=$('pjName'), h=$('pjFloorH');
  if(n && document.activeElement!==n) n.value = PROJECT.name||'';
  if(h && document.activeElement!==h){
    h.value = PROJECT.floorH==null ? '' : String(Math.round(PROJECT.floorH*10)/10);
    h.classList.remove('bad');
    _hSnapshot = PROJECT.floorH;      // 🔴 §4-1a ②：沒 focus 過就同步的那條路
  }
}
/* 存這一列（本機必存；已連線就順便推雲端）。回饋一律落在欄位旁邊。
   ╔═ 🔴 v0.20_i §4-1a ②｜`touchH` 由【呼叫端】給，不要用共用的模組變數 ═══════════╗
   🔴🔴 理由（前刀 A-10）：saveProject 是【名字與樓高共用】的存檔路徑
      （pjName 的 blur 也呼叫它）。若用一個模組變數 `_floorHBefore` 當判斷，
      它沒被初始化時是 undefined ⇒ `280 !== undefined` ⇒ hChanged=true
      ⇒ **只改名字也會蓋掉 floor_h_updated_at** ⇒ N-532（修八的目標）當場退步。
   ⇒ 誰動了樓高，誰自己說。 ╚═══════════════════════════════════════════════════╝ */
async function saveProject(opt){
  const touchH = !!(opt && opt.touchH);
  PROJECT.code = projKey();
  /* 🔴 v0.17_i §0-6 A-2 ①：這是【使用者改名字／改樓高】的那條路 ⇒ 在這裡蓋時間章。
     ⚠️ lPutProject 走 toDb('projects',…)，LEN_FIELDS.projects 只換算 floorH，
        字串欄位原樣帶過（建造者已實查：updatedAt 存得進 IndexedDB 也讀得回來）。 */
  PROJECT.updatedAt = nowISO();
  if(touchH) PROJECT.floorHUpdatedAt = nowISO();   // 🔴 §4-1a ②：只有真的動到樓高才蓋
  try{ await lPutProject(PROJECT); }
  catch(e){ setSaveNote('pjSaveNote','⚠️ 這台存不進去：'+((e&&e.message)||e),'er'); return; }
  if(CLOUD.on && CLOUD.code){
    try{
      await cloudPushProject();
      setSaveNote('pjSaveNote',`✅ 已存（這台＋雲端）　${hhmm()}`,'ok');
    }catch(e){
      /* 🔴 需求 44-c：失敗是【安靜的】(cloudErr 只寫進 CLOUD.msg) ⇒ 這裡一定要講出來。 */
      cloudErr(e);
      setSaveNote('pjSaveNote','⚠️ 還沒存上去（只存在這台）：'+((e&&e.message)||e),'er');
    }
  }else{
    setSaveNote('pjSaveNote',`✅ 已存這台　${hhmm()}　（未連線，不會上雲端）`,'ok');
  }
}
if($('pjName')){
  $('pjName').addEventListener('input',()=>{ PROJECT.name=$('pjName').value; });
  $('pjName').addEventListener('blur',()=>saveProject());
  $('pjName').addEventListener('keydown',e=>{ if(e.key==='Enter') $('pjName').blur(); });
}
if($('pjFloorH')){
  /* 🔴 v0.20_i §4-1a ②：快照在 **focus** 時拍（不是 blur，理由見 _hSnapshot 上方）。 */
  $('pjFloorH').addEventListener('focus',()=>{ _hSnapshot = PROJECT.floorH; });
  $('pjFloorH').addEventListener('input',()=>{
    const raw=$('pjFloorH').value.trim();
    if(raw===''){ PROJECT.floorH=null; $('pjFloorH').classList.remove('bad'); return; }
    const v=parseFloat(raw);
    /* 需求 7：打字中不阻止、不還原、不寫入，但無效就加紅框 */
    if(!isFinite(v)||v<=0){ $('pjFloorH').classList.add('bad'); return; }
    $('pjFloorH').classList.remove('bad');
    PROJECT.floorH=v;
  });
  $('pjFloorH').addEventListener('blur',()=>{
    const raw=$('pjFloorH').value.trim();
    const v=raw===''? null : parseFloat(raw);
    if(raw!=='' && (!isFinite(v)||v<=0)){
      // 無效 → 還原成上一個有效值，移除紅框，不存
      $('pjFloorH').value = PROJECT.floorH==null ? '' : String(Math.round(PROJECT.floorH*10)/10);
      $('pjFloorH').classList.remove('bad');
      return;
    }
    $('pjFloorH').classList.remove('bad');
    /* 🔴 v0.20_i §4-1a ②：先比對【focus 當下的快照】，再寫新值、再呼叫。
       ⚠️ 順序不可換：_hSnapshot 必須在 `PROJECT.floorH = v` 之前讀走。 */
    const before = _hSnapshot;
    PROJECT.floorH = v;                 // 🔴 留空存 null，不是 0
    _hSnapshot = v;                     // 連續編輯：下一次的基準就是這一次的結果
    saveProject({ touchH: (before !== v) });
  });
  $('pjFloorH').addEventListener('keydown',e=>{ if(e.key==='Enter') $('pjFloorH').blur(); });
}

/* 🔴 需求 44-b：樑的下垂量，一根一列，【編號與平面圖一致】（共用 beamOrder()）。 */
function beamLabel(b,i){
  const L=Math.hypot(b.x2-b.x1, b.y2-b.y1);
  return `樑${i+1}（長 ${Math.round(L)}cm × 寬 ${Math.round(b.width||20)}cm）`;
}
/* ⚠️ 宣告要在 buildBeamRows 之前：let 沒有 hoist 到可用狀態（TDZ），
   放在下面會讓「先跑到 buildBeamRows」的路徑丟 ReferenceError。 */
let _beamReturnId=null;
function buildBeamRows(){
  const box=$('beamRows'); if(!box) return;
  box.innerHTML='';
  const list=beamOrder();
  if(!list.length){
    const d=document.createElement('div'); d.className='savenote';
    d.textContent='目前沒有樑。';
    box.appendChild(d); return;
  }
  list.forEach((b,i)=>{
    const row=document.createElement('div'); row.className='setrow';
    row.dataset.beam=b.id;
    const k=document.createElement('div'); k.className='k'; k.textContent=beamLabel(b,i);
    const ip=document.createElement('input');
    ip.setAttribute('inputmode','decimal');
    ip.placeholder='（未填）';
    ip.value = b.drop==null ? '' : String(Math.round(b.drop*10)/10);
    ip.addEventListener('input',()=>{
      const raw=ip.value.trim();
      if(raw===''){ ip.classList.remove('bad'); return; }
      const v=parseFloat(raw);
      ip.classList.toggle('bad', !isFinite(v)||v<=0);
    });
    ip.addEventListener('blur',async()=>{
      const raw=ip.value.trim();
      const v=raw===''? null : parseFloat(raw);
      if(raw!=='' && (!isFinite(v)||v<=0)){
        ip.value = b.drop==null ? '' : String(Math.round(b.drop*10)/10);
        ip.classList.remove('bad'); return;
      }
      ip.classList.remove('bad');
      if(b.drop===v) return;
      b.drop=v;                        // 🔴 留空存 null ⇒ 平面圖那根變回灰色虛線
      try{
        await saveBeam(b);
        setSaveNote('beamSaveNote',`✅ ${beamLabel(b,i)} 已存　${hhmm()}`,'ok');
      }catch(e){
        cloudErr(e);
        setSaveNote('beamSaveNote',`⚠️ ${beamLabel(b,i)} 還沒存上去：`+((e&&e.message)||e),'er');
      }
      await reloadObjects();
      render(); buildBeamRows();
    });
    ip.addEventListener('keydown',e=>{ if(e.key==='Enter') ip.blur(); });
    const pv=document.createElement('button'); pv.className='btn'; pv.textContent='預覽';
    /* 🔴 v0.13_i 修九 ＋ v0.14_i 補四／補五：
         ① 先設 S.beamFocus，【再】setTab('plan',{keepFocus:true})（否則剛設的立刻被清掉）
         ② 一併 select(null)：這次進平面圖是【來看樑的】，
            否則選中家具面板（.sel）會跟返回列（.pinning）搶同一個 bottom:56px
         ③ 把鏡頭帶到那根樑，否則亮了也看不到 */
    pv.onclick=()=>{
      select(null);
      S.beamFocus=b.id;
      setTab('plan',{keepFocus:true});
      centerOnBeam(b);
      refreshBeamBar();
      render(); syncSel();
    };
    row.appendChild(k); row.appendChild(ip); row.appendChild(pv);
    box.appendChild(row);
  });
  /* 從平面圖按〔返回設定〕回來時，捲回原本那一列 */
  if(_beamReturnId){
    const el2=box.querySelector(`[data-beam="${_beamReturnId}"]`);
    _beamReturnId=null;
    if(el2) try{ el2.scrollIntoView({block:'center'}); }catch(e){}
  }
}
/* 🔴 修九：樑在畫面外時要把鏡頭帶過去（只平移、不動 zoom，沿用 ensureVisible 的原則：
   zoom 是使用者剛剛自己調的，而長度比例尺由 zoom 實算）。 */
function centerOnBeam(b){
  const {w,h}=svgSize();
  if(!(w>0&&h>0)) return;
  const cx=(b.x1+b.x2)/2, cy=(b.y1+b.y2)/2;
  const s=w2s(cx,cy);
  if(s.x>=SVG_PAD && s.y>=SVG_PAD && s.x<=w-SVG_PAD && s.y<=h-SVG_PAD) return;  // 看得到就不動
  S.panX = w/2 - cx*S.zoom;
  S.panY = h/2 - cy*S.zoom;
}
if($('beamBack')) $('beamBack').onclick=()=>{
  _beamReturnId = S.beamFocus;          // 記住要捲回哪一列
  S.beamFocus = null;                   // 離開平面圖 ⇒ 樑不再亮
  setTab('proj');                       // setTab 內會呼叫 refreshProj → buildBeamRows
  refreshBeamBar();
};
/* 🔴 v0.07_i 需求 25：診斷列。
   ⚠️ 畫面尺寸是 window.innerWidth×innerHeight（【CSS 像素】），不是螢幕解析度——
      Ali 要判斷的是「版面在她那台上有多少空間」，不是硬體規格。
   ⚠️ userAgent 認不出來 → 印「未知」，不要印空白（_d §10-0b：狀態必須看得出來）。 */
function uaShort(){
  const u=navigator.userAgent||'';
  let eng='未知', plat='未知';
  if(/Edg\//.test(u)) eng='Edge';
  else if(/OPR\//.test(u)) eng='Opera';
  else if(/SamsungBrowser/.test(u)) eng='Samsung';
  else if(/Firefox\//.test(u)) eng='Firefox';
  else if(/Chrome\//.test(u)) eng='Chrome';
  else if(/Safari\//.test(u)) eng='Safari';
  if(/Android/.test(u)) plat='Android';
  else if(/iPhone|iPad|iPod/.test(u)) plat='iOS';
  else if(/Windows/.test(u)) plat='Windows';
  else if(/Mac OS X|Macintosh/.test(u)) plat='macOS';
  else if(/Linux/.test(u)) plat='Linux';
  return eng+'/'+plat;
}
function refreshDiag(){
  const b=$('diagRow'); if(!b) return;
  b.textContent = `${APP_VER}　畫面 ${window.innerWidth}×${window.innerHeight}`
    + `　縮放 ${Math.round(S.zoom*100)}%　${uaShort()}`
    + (ENV_PREFIX ? `　環境前綴 ${ENV_PREFIX}` : '')
    + ((S.usage && S.usage.fake) ? `　⚠️ 用量＝測試值 ${fmtBytes(S.usage.total)}` : '')   // 🔴 v0.1.9：測試狀態不可以長得跟真的一樣
    + (nowFakeOn() ? `　⚠️ 現在時間＝測試值 ${LS.get('deco.nowFake')}` : '')              // 🔴 批 7：到期測試開關
    + (pendingDelList().length ? `　待刪雲端檔 ${pendingDelList().length}` : '');
}
