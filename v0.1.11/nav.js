"use strict";

/* ══════════════════════════════════════════════════════════════
   需求 13｜分頁（_d §10-0c：最多 5 格，前 4 格永遠不動）
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.13_i 修九 ＋ v0.14_i 補四｜setTab 多一個 opt。
   🔴 opt【一定要有預設值】：現有 8 個呼叫點全部是單參數，
      有預設值就完全不受影響；沒有預設值則每一個都會 TypeError。
   🔴 清除規則是「預設清 beamFocus，帶旗標才不清」——
      v0.13_i 修九那句「setTab 本身不清」寫反了：全檔切分頁只有 setTab 一條路，
      那樣寫等於【沒有任何地方會清】⇒ 樑會永遠亮著（obs O-12 宣告≠生效）。 */
/* ╔═ 🔴 v0.19_i §1-4｜分頁定義表（五顆分頁改表驅動）═══════════════════════════╗
   🔴 目標：資料結構換掉，**畫面與行為一模一樣**（這是已驗收、Ali 每天在用的東西）。
   🔴 `el` ＝ 那顆按鈕的現有 id（963-967）。沒有這一欄就得自己發明命名慣例，
      而之後加第六、第七顆的人不會知道有那個隱形規則。
   ⚠️ `proj`（⚙️ 專案頁）**不在分頁列上** ⇒ 不進這張表，它的 hidden 那一行獨立寫。
   🛑 本批不做〔⋯更多〕內收。 */
const TABS = [
  // key        label     ic     el          page          soon
  /* 🔴 v0.20_i §2-2（§13-78）：分頁 icon 只改 plan 這一格的 `ic`：🏠 → 🧩。
     🔴 label（平面圖／清單／估價／照片／格局）**一個字不改** —— 分頁列有文字，本來就看得懂。
     📌 🏠 讓出來給圖層列的「電器」用（Ali 2026-09-19 就是為了這個才換的）。 */
  { key:'plan',  label:'平面圖', ic:'🧩', el:'tabPlan',   page:null,        soon:false },
  { key:'list',  label:'清單',   ic:'📋', el:'tabList',   page:'listPage',  soon:false },
  { key:'cost',  label:'估價',   ic:'💰', el:'tabCost',   page:'soonPage',  soon:true  },
  { key:'photo', label:'相簿',   ic:'📷', el:'tabPhoto',  page:'photoPage', soon:false },
  { key:'layout',label:'格局',   ic:'📐', el:'tabLayout', page:'soonPage',  soon:true  },
];
/* ╔═ 🔴 setTab 的【九件事】，改成迴圈時一件都不可以掉 ═══════════════════════════╗
   ① opt ＋ beamFocus 的清除（🔴 opt 這個參數不可以拿掉：帶 {keepFocus:true} 的呼叫靠它）
   ② 🔴🔴 離開清單頁要 commitNameEdits()（掉了會【安靜吃掉她打的字】）
   ③ listPage／photoPage／projPage／soonPage 的 hidden（proj 獨立寫）
   ④ zoombtns 只在 plan 顯示
   ⑤ fabAdd 只在 list 顯示
   ⑥ soon 頁的 icon 與文字（cost ＝ 💰／layout ＝ 📐）
   ⑦ 進 photo 要 renderPhotos()、進 proj 要 refreshProj()、進 list 要 buildList()
   ⑧ localStorage 只存 plan/list/photo 三種
   ⑨ 收尾四件 refreshTop → refreshBeamBar → render → syncSel，🔴 順序不可換
   ⑩ （v0.1.7 新增）renderLayerBar：圖層列依 LAYERS.tabs 重畫
   ⑪ （v0.1.9 新增）離開平面圖 ⇒ 定位中視同定位完成、收掉預覽卡（leavePlanPinState）
   ⑫ （v0.1.9 新增）離開專案頁 ⇒ 垃圾桶子畫面收起 */
function setTab(t, opt){
  opt = opt || {};                                            // ①
  if(!opt.keepFocus) S.beamFocus = null;                      // ①
  if(S.tab==='list' && t!=='list'){ commitNameEdits(); }      // ② 🔴🔴
  if(S.tab==='photo' && t!=='photo'){ commitAlbumEdits(); }   // ②-b 🔴 v0.1.9：相簿的就地編輯也一樣（掉了會吃掉她打的字）
  /* ⑪ 🔴 v0.1.9 R-25／R-26：定位中切到別的分頁 ⇒ 視同〔定位完成〕（還沒點過 ⇒ 什麼都不存）；
     預覽卡／選中的釘子一起收掉。分頁 key 'photo'、deco.tab 不動。 */
  if(t!=='plan' && (S.loc || S.pinSel || S.pinCard)) leavePlanPinState();
  /* ⑫ 🔴 v0.1.9 批 7：離開專案頁 ⇒ 垃圾桶子畫面收起（下次進專案頁回到設定本頁） */
  if(t!=='proj' && S.trash && S.trash.open){ S.trash.open=false; $('trashView').hidden=true; $('projMain').hidden=false; }
  S.tab=t;
  const cur = TABS.find(x=>x.key===t);
  // ③ TABS 驅動的頁面；proj 不在表上 ⇒ 照舊獨立寫
  new Set(TABS.map(x=>x.page).filter(Boolean)).forEach(id=>{
    $(id).hidden = !(cur && cur.page===id);
  });
  $('projPage').hidden  = (t!=='proj');                       // ③
  $('zoombtns').hidden  = (t!=='plan');                       // ④
  $('fabAdd').hidden    = (t!=='list');                       // ⑤
  if(cur && cur.soon){                                        // ⑥
    /* 🔴 依 _d §10-0b 不寫「這裡以後會有…」——只給狀態 */
    $('soonIc').textContent  = cur.ic;
    $('soonTxt').textContent = '之後';
  }
  if(t==='photo') renderPhotos();                             // ⑦
  if(t==='proj')  refreshProj();                              // ⑦
  TABS.forEach(x=>$(x.el).classList.toggle('on', x.key===t));
  if(t==='list') buildList();                                 // ⑦
  if(t==='plan'||t==='list'||t==='photo') LS.set('deco.tab',t);   // ⑧（R-45：走 LS ⇒ 帶前綴）
  renderLayerBar();                                           // ⑩
  refreshTop();                                               // ⑨
  refreshBeamBar();          // 🔴 修九：返回列跟著 beamFocus 與分頁走
  render(); syncSel();
}
/* 🔴 v0.13_i 修九：〔‹ 返回設定〕只在「平面圖 ＋ 有樑亮著」時出現。
   落點沿用 .pinning，不新造版位。 */
function refreshBeamBar(){
  const b=$('beamBack'); if(!b) return;
  b.hidden = !(S.tab==='plan' && S.beamFocus);
}
/* 🔴 v0.19_i §1-4：五個繫結改成迴圈（id 由 TABS 的 el 欄提供，不靠命名慣例猜）。 */
TABS.forEach(x=>{ $(x.el).onclick = ()=>setTab(x.key); });

/* 🔴 需求 39：手勢 A1／A2 切換與 A1 的模式列（segGesture／segMode／modebar／modeHint／
   applyModeClass）已整組移除——元素、CSS、狀態欄位、事件繫結、啟動時的初始化全部一起刪。
   ⚠️ 教訓（v0.11_i 修一）：只刪元素、留下讀它的那幾行，node --check 會過而畫面是白的。 */
/* ── 縮放：三種入口（雙指 / 滾輪 / 按鈕）——O-5 ── */
function zoomAt(cx,cy,factor){
  const r=svg.getBoundingClientRect();
  const mx=cx-r.left, my=cy-r.top;
  const z=Math.max(.2,Math.min(6, S.zoom*factor));
  S.panX = mx-(mx-S.panX)*(z/S.zoom);
  S.panY = my-(my-S.panY)*(z/S.zoom);
  S.zoom = z; render(); syncSel(); zLbl();
}
function zLbl(){ $('zLabel').textContent = Math.round(S.zoom*100)+'%'; }
svg.addEventListener('wheel',e=>{        // 電腦：滾輪縮放
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY<0 ? 1.12 : 1/1.12);
},{passive:false});
function zoomCenter(f){ const r=svg.getBoundingClientRect();
  zoomAt(r.left+r.width/2, r.top+r.height/2, f); }
$('zIn').onclick =()=>zoomCenter(1.25);
$('zOut').onclick=()=>zoomCenter(1/1.25);
$('zFit').onclick=()=>{ fit(); zLbl(); };

/* ╔═ 🔴 v0.19_i §1-1d／§1-2b｜圖層列（點亮式）＋ 記得住 ══════════════════════╗
   舊的 $('snapOn').onchange／$('gridAll').onchange 兩個繫結已隨元素一起移除。 */
const LAYERS_KEY='deco.layers';
/* 🔴 §1-2b：這是【這台裝置的檢視偏好】，不是專案的事實 ⇒ 只進 localStorage，不推雲端。
   ⚠️ 用既有的 LS（2949 一帶，本來就包了 try/catch），不另寫一套。 */
function saveLayers(){ LS.set(LAYERS_KEY, JSON.stringify(S.layers)); }
function loadLayers(){
  const raw=LS.get(LAYERS_KEY); if(!raw) return;
  try{
    const o=JSON.parse(raw);
    if(!o || typeof o!=='object') return;
    Object.keys(o).forEach(t=>{
      if(!o[t] || typeof o[t]!=='object') return;
      if(!S.layers[t]) S.layers[t]={};
      /* 🔴 只收 LAYERS 認得的 key；存檔裡【沒有】的 key 不碰
         ⇒ 自動留在 defaultLayers() 給的 def（新長出來的一層不會是關著的）。 */
      Object.keys(o[t]).forEach(k=>{ if(layerDef(k)) S.layers[t][k]=!!o[t][k]; });
    });
  }catch(e){}
}
/* ╔═ 🔴 v0.20_i §10-3｜「這一層只是佔位」的判準（一行，但不寫就一定錯）═══════════╗
   🔴🔴 **不可以只看 `draw === null`**：碼裡 `snap` 那一列就是 `draw:null, pick:null`
      （它是 behavior、本來就不畫東西）
      ⇒ 照「draw 是 null 就 disabled」做 ⇒ **〔🧲 吸附〕開關直接變成不可按**，
        而 syncSel 又靠 `L('snap')` 決定〔🧲 已貼牆〕鈕能不能按
        ⇒ 她會**失去吸附開關而且找不到原因**。
   ✅ 正確判準＝「不是 behavior」且「畫不出東西」且「點不到東西」。 ╚═══════════════╝ */
const isPlaceholderLayer = l => (l.kind !== 'behavior') && l.draw == null && l.pick == null;
/* 依 LAYERS 生成這一頁的圖層列。🔴 只列 tabs 含目前分頁的 ⇒ 其他分頁自然是空的（§1-4a）。 */
function renderLayerBar(){
  const bar=$('layerBar'); if(!bar) return;
  bar.innerHTML='';
  let prevKind=null;
  LAYERS.filter(l=>l.tabs.includes(S.tab)).forEach(l=>{
    if(prevKind && prevKind!==l.kind)
      bar.appendChild(Object.assign(document.createElement('span'),{className:'lsep'}));
    prevKind=l.kind;
    const b=document.createElement('button');
    b.type='button';
    b.className='chip'+(L(l.key)?' on':'');
    b.id='lay_'+l.key;
    b.dataset.layer=l.key;
    b.textContent=l.label;                       // 🔴 v0.20_i §2-1：label 現在是【控制 icon】
    /* 🔴 §2-1b：icon 化之後「這顆是什麼」要有一個【零成本】的答案 ——
       title（桌機 hover）＋ aria-label（無障礙）。
       🛑 本批**不做**長按提示、不做一次性導覽、不做設定頁的〔使用說明〕——
          Ali 裁決：「在設定的介面開一個按鈕寫『使用說明』…**這個現階段不用做，
          累積到一定程度再做**。」
       ⚠️ 已知代價（已列進交付必講）：本批上線後 🅰 ▦ 📷 對她以外的人是不可解的；
          而這個 App 目前只有她一個使用者 ⇒ 可接受。 */
    b.title=l.title||'';
    b.setAttribute('aria-label', l.title||'');
    b.setAttribute('aria-pressed', L(l.key)?'true':'false');
    /* 🔴 §10-3（Ali 裁決【乙】）：佔位層＝**設成不可按**。
       理由：規格說「佔位、不畫」，但 toggleLayer 仍然會寫 S.layers 並 saveLayers()
       ⇒ 按了會亮、但畫面完全沒反應 ⇒ obs O-18「什麼都沒發生不可以是一種回答」。 */
    b.disabled = isPlaceholderLayer(l);
    b.onclick=()=>toggleLayer(l.key);
    bar.appendChild(b);
  });
  /* ╔═ 🔴 v0.1.9 §3（Ali 2026-09-30 裁 b）｜相簿清單頁：搜尋框【畫出來】但不做功能 ═══════╗
     位置＝平面圖圖層 icon 列【同一個元素】#layerBar（v0.1.8.1 起照片分頁這一條就是空的、透明、38px）
     ⇒ 高度與平面圖那條天生一致，切分頁不跳。只在清單頁（相簿內頁不畫）。
     🛑 不吃焦點、不跳手機鍵盤：disabled ＋ readonly ＋ tabindex -1 ＋ pointer-events:none；沒有任何事件。 ╚═╝ */
  if(S.tab==='photo' && !S.alb.open){
    const s=document.createElement('input');
    s.type='search'; s.className='srchph'; s.id='albSearchPh';
    s.placeholder='搜尋（之後開放）'; s.setAttribute('aria-label','搜尋（之後開放）');
    s.disabled=true; s.readOnly=true; s.tabIndex=-1;
    bar.appendChild(s);
  }
  bar.scrollLeft=0; nextFrame(syncLayerFade);     // 🔴 v0.1.10 P11：換頁／重畫之後重算漸層（O-1：排版後才量得到寬度）
}
/* 🔴 v0.1.10 P11：右邊還有東西 ⇒ 右漸層；左邊有被捲走的 ⇒ 左漸層 */
function syncLayerFade(){
  const b=$('layerBar'), w=$('layerBarWrap'); if(!b || !w) return;
  const max=b.scrollWidth-b.clientWidth;
  w.classList.toggle('more-r', max>1 && b.scrollLeft < max-1);
  w.classList.toggle('more-l', max>1 && b.scrollLeft > 1);
}
$('layerBar').addEventListener('scroll', syncLayerFade, {passive:true});
window.addEventListener('resize', syncLayerFade);
function toggleLayer(key){
  /* 🔴 §10-3：佔位層擋在這裡。
     ⚠️ **理由不是「localStorage 會長出三個沒用的 key」** —— 那個理由是假的：
        defaultLayers() 只要那三列的 tabs 含 'plan'，**就一定**會把三個 key 放進
        S.layers.plan，而 saveLayers() 是【整包序列化】
        ⇒ 她點任何一顆圖層，那三個 key 都會進存檔，**與擋不擋這裡完全無關**。
        📌 三個 key 出現在 localStorage 是【預期的】，不是缺陷 —— 寫在這裡，
           否則下一個人會拿它當成「這一條沒做」而重寫一次。
     ✅ **真正的理由**：`b.disabled` 只擋 UI，**擋不住程式呼叫** ——
        toggleLayer 是具名函式，之後任何一個新入口都叫得到它。 */
  const def=layerDef(key);
  if(def && isPlaceholderLayer(def)) return;
  const t=S.tab;
  if(!S.layers[t]) S.layers[t]={};
  S.layers[t][key] = !L(key);
  saveLayers();
  renderLayerBar();
  render(); syncSel();          // 舊 snapOn 是 render+syncSel、gridAll 是 render ⇒ 取聯集
}

/* ── 啟動 ── */
/* 資料變了（種子只有 400×300，不再是舊假資料的 900×400）⇒ fit() 改成依實際資料算範圍。
   ⚠️ 這不是 _i 指定的改動，是換掉假資料後 fit() 的必要適配（見交付報告）。 */
function planBounds(){
  /* 🔴 需求 41：現況只看 WALLS ⇒ 凸出牆線的分區（例如「大門外」）會被切掉
     ⇒ 把 poly 的點一起納入。
     🔴 v0.21_i 下-22：示意帶與比例尺搬進畫面座標的 HUD 之後，這裡**不再替它們預留世界座標空間**
        （舊版 `y1=Math.max(y1, barY()+80)` ＝ 房子下方多留 160 公分）
        ⇒ 〔全圖〕的縮放會變（平面圖變大，已列交付必講）。
        HUD 需要的空間改由 fit() 用【畫面 px】預留（B-1，見 hudReservePx）。 */
  const pp=polyPoints();
  if(!WALLS.length && !pp.length) return {x0:0, y0:0, x1:400, y1:300};   // 🔴 原本是 barY()+80（已刪）
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  WALLS.forEach(w=>{x0=Math.min(x0,w.x1,w.x2);x1=Math.max(x1,w.x1,w.x2);
                    y0=Math.min(y0,w.y1,w.y2);y1=Math.max(y1,w.y1,w.y2);});
  pp.forEach(q=>{x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]);
                 y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]);});
  x1=Math.max(x1, x0+340);
  return {x0,y0,x1,y1};
}
function fit(){
  const r=svg.getBoundingClientRect();
  /* ⚠️ O-1：版面還沒定案時 rect 是 0 → 算出 zoom=0 → 整張圖縮成一個點、畫面全白。
     語法檢查對這種完全瞎眼（實際踩到）。等下一幀再試。 */
  if(!r.width || !r.height){ requestAnimationFrame(fit); return; }
  const b=planBounds();
  /* 🔴 需求 21：Ali 的兩句話是同一件事——
     「平面圖下方一大片空白」＋「現在的手機畫面超級小，其實我不太好操作」
     實測（真實 375×812）：容器本身沒問題（見 _debug：壞例不壞），
     空白來自 fit() 的留白太大 ⇒ 房間被縮小、剩下的高度變成空白。
     留白 90 → 36 世界單位：房間畫得更大，空白同時變小。
     ⚠️ 沒有動任何元件的尺寸與位置（需求 21 明訂只修空白）。 */
  const FIT_PAD = 36;
  const W=Math.max(1,(b.x1-b.x0)+FIT_PAD), H=Math.max(1,(b.y1-b.y0)+FIT_PAD);
  /* 🔴 v0.21_i B-1：畫面底部留一個 HUD 的高度（畫面 px），房子才不會被左下角那一組壓住。
     HUD 高度與 zoom 有關（走道圖示＝60 × zoom），而 zoom 又要看扣掉 HUD 之後剩多少
     ⇒ 算兩次：第一次用整個高度估 zoom，第二次扣掉那個 zoom 下的 HUD 高度再算一次。
     （兩次就夠：HUD 高在全屋檢視下被「比例尺刻度 16 px」墊住，不太隨 zoom 變。） */
  let z=Math.min(r.width/W, r.height/H);
  const reserve = hudReservePx(z);
  z=Math.min(r.width/W, Math.max(1, r.height-reserve)/H);
  S.zoom = (z>0 && isFinite(z)) ? z : 1;      // ← isFinite 那一層不能省（O-1）
  S.panX = (r.width  - (b.x1-b.x0)*S.zoom)/2 - b.x0*S.zoom;
  S.panY = (r.height - hudReservePx(S.zoom) - (b.y1-b.y0)*S.zoom)/2 - b.y0*S.zoom;   // 在 HUD 上方置中
  render(); syncSel(); zLbl();
}
