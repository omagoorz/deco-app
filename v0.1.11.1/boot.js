"use strict";
window.addEventListener('resize',()=>{
  /* 🔴 需求 25 邊界：轉向或網址列收起造成高度變化時，診斷列要跟著現況（它是狀態）。 */
  refreshDiag();
  if(!(S.zoom>0)) { fit(); return; }
  render(); syncSel();
});

let t0 = LS.get('deco.tab') || 'plan';   // R-45：走 LS ⇒ 帶前綴
if(t0!=='plan' && t0!=='list' && t0!=='photo') t0='plan';

/* 🔴 啟動序列（需求 15 的順序寫死）：
     cloudInit（可能連上）→ loadAll（lAll → pull → 搬家 → seed → purge）（v0.1.9：loadMarkers 已拿掉）
     → render → buildList → setTab
   ⚠️ pull 丟錯 → 不跑 seed、把錯誤留在畫面上（不可用「本機全空」當成「專案是空的」）。 */
(async function boot(){
  loadLayers();               // 🔴 §1-2b：先把上次點亮／熄掉的狀態讀回來，再畫第一幀
  loadFold();                 // 🔴 §下-10：收合狀態也要記得住（N-433）
  await cloudInit();
  try{
    await loadAll();
    S.dataErr='';
  }catch(e){
    cloudErr(e);
    S.dataErr=(e&&e.message)||String(e);
    await reloadObjects();          // 至少把本機已有的畫出來，但【不產生種子】
  }
  fit();
  render();
  buildList();
  setTab(t0);
  refreshTop();
})();
