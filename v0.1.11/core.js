"use strict";
/* ══════════════════════════════════════════════════════════════
   幾何與手勢的計算邏輯（⭐ 未來會整段搬進正式 App 的部分）
   畫面部分是拋棄式的
   ══════════════════════════════════════════════════════════════ */

const APP_VER = 'v0.1.11'; /* 需求 40：版號。補釘也要跟著跳（診斷列與每筆資料的 appVer 都讀它）
                              🔴 v0.20_i 下-17：v0.1.7 交付時【忘了跳】，正本與線上都還寫著 v0.1.6，
                                 診斷列與每一筆資料的 appVer 都在說謊。本批起版號列進每一批的交付必講。 */

/* ╔═ 🔴 v0.22_i §0c R-45｜環境前綴（同網域與回退）═══════════════════════════════════════╗
   GitHub Pages 同一個網域共用 IndexedDB 與 localStorage ⇒ 在同一支手機上開的任何頁面
   都會碰到她的真實資料與專案代碼（deco_code）。
   ⇒ 所有 IndexedDB 名稱與 localStorage 鍵都加上這個前綴。
      正式版＝''（空字串）⇒ 名稱與 v0.1.8.1 完全相同（deco_probe／deco_code…），升級不搬任何東西。
      測試版＝改成例如 'T1_' ⇒ 另一套資料庫、另一組代碼與身分，碰不到她的東西。
   🔧 建造者自驗用：只有在 localhost／127.0.0.1 時，網址帶 ?env=xxx 才會覆寫（模擬兩台手機用）；
      正式網域上這個參數一律無效（不讓一個網址參數改變她的資料去哪裡）。 ╚═════════════════╝ */
const ENV_PREFIX = (()=>{
  const DEFAULT_PREFIX = '';
  try{
    const h=location.hostname;
    if(h==='localhost' || h==='127.0.0.1'){
      const v=new URLSearchParams(location.search).get('env');
      if(v && /^[A-Za-z0-9]{1,12}$/.test(v)) return v+'_';
    }
  }catch(e){}
  return DEFAULT_PREFIX;
})();

/* ── 需求 1／需求 4：三種物件不再是 const 字面值，改成執行時載入 ──
   🔴 記憶體側單位＝【公分、浮點】；資料庫側（IndexedDB ＋ 雲端）＝【公釐、整數】。
      換算只發生在資料層邊界（toDb/fromDb、toRow/fromRow）。 */
let ROOMS = [];
let WALLS = [];
let BEAMS = [];        // 需求 43：樑。v0.1.5 起【畫得出來】＋設定頁可填下垂量
/* 🔴 v0.12_i 需求 44 ＋ v0.13_i 修三：專案設定（一列）。
   單位：floorH 是【公分】（與 UI 一致），雲端 floor_h 是公釐。 */
/* 🔴 v0.17_i 修八 ＋ §0-6 A-2 ①：PROJECT 多一個 updatedAt。
   本機從來沒有留下過「我這台上次改是什麼時候」（cloudPushProject 是送出那一刻現造的）
   ⇒ 照字面寫 `if(new Date(PROJECT.updatedAt) <= ...) return;` 會是 Invalid Date
   ⇒ 任何比較都是 false ⇒ 【永遠都推】或【永遠都不推】二選一，而兩者在畫面上長得一模一樣。
   🔴 四個寫入點（缺一就白做）：① 這行宣告 ② saveProject ③ lPutProject ④ loadProject。 */
/* 🔴 v0.20_i §4-1（`_d` §13-48 戊案）：多一個 floorHUpdatedAt。
   🔬 根因：樓高卡住**不是**因為「應該 null 不送」，是因為它和專案名字
      **擠在同一列、共用同一個 updated_at** ⇒ 只改名字也會連帶決定樓高推不推。
      對照組：樑走 beams 表、一根一列一個 updatedAt ⇒ 樑的清空會傳播，也不會洗掉別人的。
   ⇒ 給樓高一個【自己的時間戳】，兩件事就能同時成立（§4-1c）：
      ① 手機只改名字 ⇒ 不動它 ⇒ 不會洗掉電腦的樓高
      ② B 清掉樓高 ⇒ 會動它 ⇒ 清空會傳播到 A
   🔴 **五個寫入點缺一就白做**（與 v0.17_i 修八 A-2 完全同形，那次就是漏了一個）：
      ① 這行宣告 ② saveProject ③ lPutProject 經過的 toDb ④ loadProject（**兩個分支**）
      ⑤ cloudPullProject 的 merged
   ⚠️ ③ 不必動碼：toDb('projects') 只換算 LEN_FIELDS.projects（floorH），
      字串欄位原樣帶過（updatedAt 已實證存得進也讀得回，floorHUpdatedAt 同形）。 */
let PROJECT = { code:null, name:'', floorH:null, updatedAt:null, floorHUpdatedAt:null };
let FURN  = [];

/* ── 常數 ───────────────────────────────────────────────
   _d 不可變方向 #11：人操作的精度用【螢幕距離】，房子的事實用【公分】
   ⚠️ 需求 4：這幾個全部不換算——它們是記憶體側的常數。 */
const SNAP_PX   = 30;   // 吸附觸發：螢幕距離（不是公分！）
const NUDGE_PX  = 3;    // 微調步進：螢幕距離
/* 🔴 v0.17_i 甲-2（修十五）：步進下限 1 → 0.5 公分（Ali 2026-09-18 改判：
   「0.5 是【取代】『1 公分是極限』那條裁決。我需要準確度 單位是 0.5。」）
   🔴 舊註解「（Ali：1 公分是極限）」必須一起改掉 —— 留著它，下一個人讀註解會以為
      下限還是 1（O-25 的預備役：函式／常數在，但內容已經不是那個意思了）。 */
const NUDGE_MIN = 0.5;  // 步進下限 0.5 公分（Ali 2026-09-18 改判：0.5）
const DRAG_PX   = 4;    // 點/拖判定門檻（技法筆記 §2）
const CLEAR_CM  = 60;   // 走道淨空預設值（_d §5-6，必須顯示在畫面上）
const GRAB_PAD_PX = 14; // 選中家具的命中緩衝（螢幕距離）
/* 🔴 v0.12_i 需求 45-c：吸附距離的【世界座標上限】。
   全屋 fit 之後 zoom 很小 ⇒ SNAP_PX/zoom 會換算成好幾公尺；
   以前只找同一間房的牆所以吸不遠，現在找全部 33 道 ⇒ 會吸到隔壁房甚至屋外那道。
   ⚠️ 與 _d 不可變方向 #11 不牴觸：#11 說「手的事用螢幕距離」，
      而這個上限管的是【房子的事】—— 不可能貼到三公尺外的牆。 */
const SNAP_MAX_CM = 50;
/* 🔴 v0.12_i 需求 42：thickness 為 NULL 時的預設牆厚（公分）。
   依據（v0.13_i 修八 F-16 實查）：匯入的 33 道裡 29 道是 12 公分，
   其餘 11.5／14.5／26／39 各一道（🔴 五種，不是四種）。
   🔴 不可以用 0 —— 那會讓整道牆消失。 */
const DEFAULT_WALL_CM = 12;

/* 需求 8：房間色盤（系統自動配，本輪不讓使用者選）。色盤用完循環使用。
   🔴 需求 48（v0.12_i）＋ v0.14_i 補六：6 色 → 20 色。
      6 色時第 7~10 間與第 1~4 間同色，而房間色是「哪幾筆是同一間」的唯一線索（§9-1d-1）。
   🔴 前 6 個 ＝ 現況的色盤，一個字不改 ⇒【前六個名次】的房間顏色不變；
      名次 ≥6 的一定會變，那正是本需求的目的。
   🔴 位置 6／7／8 已依 v0.14_i 補六換成洋紅／青／黃綠（原本的鋼藍、霧紫、暗橄欖金
      與前 6 個太近，12% 填色下分不出來）。
   🔴 全部避開 --warnB(#cf4444 紅) 與 --warnA(#e08b2a 橘) 的色相
      —— 那兩個在這個 App 裡是「撞到／警示」的語意。 */
const ROOM_PALETTE = [
  '#3a6ea5','#4a8f5e','#c98a2e','#8e5ba6','#2f8f8f','#b0553f',   /* 0~5：與現況相同 */
  '#c0508f','#3f9ec9','#7aa02f',                                  /* 6~8：洋紅／青／黃綠 */
  '#6b5b95','#4f8a6b','#a05a7a','#2f6f5f','#7a6aa0','#8f7a3a',
  '#4a7fa5','#6f8a4a','#9a5f5f','#3a8f7a','#7f5fa0'
];

/* 🔴 需求 39：gesture／mode 兩個欄位已移除（A1／A2 收斂成單一路徑＝原本的 A2）。
   拖曳＝先點選再拖；沒選中時拖背景＝平移畫面。不要再加回來。 */
/* ╔═ 🔴 v0.20_i §2-1｜圖層定義表（一層一列）＝【控制 icon】════════════════════════╗
   之後加燈具／弱電／電器 ＝【加一列資料】，不動 render()。
   kind  behavior（吸附＝要不要）／display（其餘＝有沒有）—— 視覺上要有最小差異（§1-1c）
   tabs  哪些分頁看得到這一列　def 預設值　title 中文全名　draw/pick 畫什麼、點了做什麼

   🔴🔴 **`key` 一個字都不准改**（§2-1a）：S.layers 是【存進 localStorage 的資料】
      （LAYERS_KEY='deco.layers'），而 loadLayers() 只收 layerDef(k) 認得的 key
      ⇒ 把 grid 改名成 corridor、photo 改成 album，會讓她存好的狀態**被靜靜丟掉**，
        而且畫面不會有任何訊息（她會發現「我關掉的走道又自己開了」）。
      ⇒ 本批**只改 label（改成 icon）與順序**。要改 key 等相簿那一批做資料遷移時一起。

   🔴🔴 **七列都要寫出 `tabs`／`draw`／`pick`，一欄都不可以省**：
      defaultLayers() 是 `LAYERS.forEach(l=>l.tabs.forEach(...))`、
      renderLayerBar() 是 `l.tabs.includes(S.tab)`
      ⇒ 少了 tabs ⇒ `undefined.forEach` ⇒ **啟動就白畫面**。

   🔴 **`z` 已經從這張表移走** —— 疊圖順序的唯一來源是 DRAW_ORDER（§2-3a）。
      理由：兩張表都放 z 一定會有一天不同步；而【家具本體不是圖層，卻也要參與排序】。
      ✅ 查證過：全檔沒有任何地方讀 `layerDef(k).z`，所以移走是安全的。

   ⚠️ 順序改了，她的肌肉記憶會被動到（§2-1c，已列進交付必講 ②）：
      舊　吸附 → 網格全顯 → 名稱 → 照片
      新　🧲 → 🅰 → ▦ → 📷　（＝ Ali 2026-09-20 給的：吸附 名稱 走道 相簿）
      ⇒ 第 2、3 格【互換】了。這是照她最新的指示做的，不是 bug。

   🔴 **三個佔位層的順序：`appl → wire → lamp`（🏠 🔌 💡）** ────────────────────
      **Ali 2026-09-26 裁決：電器在前。** 與 `_i` §2-1 的表一致。
      ⇒ 整排是 **🧲 🅰 ▦ 📷 🏠 🔌 💡**（N-501／N-508／§8 ④ 均已同步為此）。
      📌 渲染順序＝下面這個陣列的順序（renderLayerBar 依序跑）⇒ 要換順序就對調這三列，
         **不影響任何其他東西**（z 在 DRAW_ORDER、key 不變、行為不變）。 ╚═════════╝ */
const LAYERS = [
  // key       label(icon)  kind         tabs           def     title    draw      pick
  { key:'snap', label:'🧲', kind:'behavior', tabs:['plan'], def:true,  title:'吸附', draw:null,   pick:null },
  { key:'name', label:'🅰', kind:'display',  tabs:['plan'], def:true,  title:'名稱', draw:'name', pick:null },
  /* 🔴 v0.21_i 下-23（A 類，標紅）：▦ 從此也管房間名 ⇒ title／aria-label 改成「走道／房間名」，
     不然長按看說明時看不出它也管房間名。🔴 key 仍是 'grid'（存進 localStorage 的資料，不准改）。 */
  { key:'grid', label:'▦',  kind:'display',  tabs:['plan'], def:false, title:'走道／房間名', draw:'grid', pick:null },
  { key:'photo',label:'📷', kind:'display',  tabs:['plan'], def:true,  title:'相簿', draw:'mk',   pick:'mk' },
  /* ── 以下三列本批【佔位：不畫、不可點】，但欄位要齊（§0-3：本體不做）────────────
     🔴 draw 與 pick 都是 null ⇒ renderLayerBar 會把它們設成 disabled（判準見該函式）。 */
  { key:'appl', label:'🏠', kind:'display',  tabs:['plan'], def:false, title:'電器', draw:null,   pick:null },
  { key:'wire', label:'🔌', kind:'display',  tabs:['plan'], def:false, title:'弱電', draw:null,   pick:null },
  { key:'lamp', label:'💡', kind:'display',  tabs:['plan'], def:false, title:'燈具', draw:null,   pick:null },
];
const layerDef = k => LAYERS.find(l=>l.key===k);
/* 依 LAYERS 的 tabs 與 def 展開；🔴 §主-2：一個分頁一份，連預設值也是 */
function defaultLayers(){
  const o={};
  LAYERS.forEach(l=>l.tabs.forEach(t=>{ (o[t]=o[t]||{})[l.key]=l.def; }));
  return o;
}
/* ╔═ 🔴 L()：這一層在【目前這個分頁】亮著嗎 ════════════════════════════════════╗
   🔴 沒有的 key【回退 def，不可以當成 false】。
      §1-2b 已經替 localStorage 寫了這條規則（新的一層上線時會是關著的、而 Ali 不知道
      有這一層）—— 同一條規則對 L() 本身一樣成立，所以寫在這裡【一處】，
      持久化那邊就自動繼承，不會有兩套回退規則。
   ⚠️ A 類裁量（建造者，非 Ali 裁決）：`_i` §1-2 的字面寫法是
      `!!(S.layers[S.tab] && S.layers[S.tab][key])` ⇒ 在【非 plan 分頁】一律回 false，
      而 render()／syncSel() 每個分頁都會跑 ⇒ 2108 的〔🧲〕會在清單頁被設成 disabled。
      那是「一個看不到的分頁狀態正在改變一顆按鈕的可按性」，且與 v0.1.6（S.snap 全域 true）
      的行為不一致。此處取【保守解】＝回退 def ⇒ 行為與 v0.1.6 相同。 */
const L = (key)=>{
  const t = S.layers && S.layers[S.tab];
  if(t && Object.prototype.hasOwnProperty.call(t,key)) return !!t[key];
  const d = layerDef(key);
  return d ? !!d.def : false;
};
/* 🔴 §1-3：沒點亮 ⇒ 不畫 ⇒ 連帶不可點。畫與命中【共用這一個判斷】，
   不可以兩邊各寫一個條件（遲早出現「看不到卻點得到」）。 */
const shown = (key)=> L(key);

/* ╔═ 🔴 v0.19_i §下-10｜房間分組折疊 ══════════════════════════════════════════╗
   🔴 「未指定房間」那一組的 rid 是 **null** ⇒ 不能當 key
      ⇒ 用一個不會與任何 uuid 衝突的哨兵。⚠️ 全檔只能有這一個定義，
        不要在兩個地方各寫一次字面字串（它會進 localStorage ＝ 變成資料）。 */
const NOROOM_KEY='__noroom__';
const FOLD_KEY='deco.foldRooms';
const isFolded = key => !!S.foldRooms[key];
function toggleFold(key){
  if(S.foldRooms[key]) delete S.foldRooms[key];   // 只記【收合的】那些
  else S.foldRooms[key]=true;
  saveFold();
}
function saveFold(){ LS.set(FOLD_KEY, JSON.stringify(S.foldRooms)); }
function loadFold(){
  const raw=LS.get(FOLD_KEY); if(!raw) return;
  try{ const o=JSON.parse(raw);
    if(o && typeof o==='object'){
      S.foldRooms={};
      Object.keys(o).forEach(k=>{ if(o[k]) S.foldRooms[k]=true; });
    }
  }catch(e){}
}

const S = { layers: defaultLayers(),
            foldRooms:{},          // 🔴 §下-10：只記【收合的】房間，存 localStorage、不存雲端
            selId:null, zoom:1, panX:0, panY:0, tab:'plan',
            dragging:null, snapCand:null,
            /* 🔴 v0.1.9 批 8：舊的 pinPhoto（標到平面圖）整族拿掉（R-23），換成相簿釘子的三個狀態 */
            loc:null, pinSel:null, pinCard:false,
            prevTab:'plan',        // 🔴 需求 16：進專案頁之前停在哪一個分頁
            /* 🔴 v0.09_i 需求 30：守衛訊息。selNote 跟著選中狀態走、listNote 跟著清單頁走。 */
            selNote:'', listNote:'',
            /* 🔴 v0.17_i §0-5 A-6：selNote 每一幀被重算 ⇒ 想在面板上「說一句話」必須
               有一個【存得住的旗標】，由動作寫入、由 select() 與下一個動作清掉。
               selMsg    ＝ 一次性的動作結果（修五：附近沒有牆）
               roomGuessFailed ＝ 修六判不出房間的那一件的 id（第四批用） */
            selMsg:'', roomGuessFailed:null,
            sizeOpen:false,        // 需求 12：尺寸欄展開中？
            /* 🔴 v0.20_i §3-1g：旋轉模式展開中？（與 sizeOpen 互斥，由 openMode 維護）
               📌 **切分頁【不】清這兩個旗標 —— 這是刻意的**：
                  setTab 的九件事裡沒有它們，而 syncSel 只在非 plan 分頁把面板 hidden=true、
                  不清旗標 ⇒ 切走再切回來，模式仍然開著（N-556）。
                  ⚠️ 這是 sizeOpen 的既有行為，angOpen 照抄。
                  🔴 寫在這裡是為了讓下一個人**不要**看到「setTab 沒處理它」就順手清掉。
                  （同理〔🔍 檢視〕會 setTab('list') 但不動 sizeOpen，也是刻意的。） */
            angOpen:false,
            warnOpen:false,        // 需求 12：警示展開全部？
            /* 需求 8 §3-2 ＋ v0.05_i §4（修四）：卡片內的展開列在哪一筆。
               🔴 房間下拉與備註共用【同一個】展開狀態，不做兩個獨立展開。
               expandCause：'chip'（點〔已擺〕而 room=null 進來）／'manual'（點 ▾ 進來）
               —— 兩者對「選未指定」的處理不同，見 itemCard()。 */
            expandId:null, expandCause:null,
            /* 🔴 v0.12_i 需求 44-b2 ＋ v0.13_i 修九：設定頁按〔預覽〕時，哪一根樑亮著。
               清除時機＝setTab()【預設就清】，只有帶 {keepFocus:true} 才保留
               （v0.14_i 補四：v0.13_i 那句「setTab 本身不清」寫反了，
                 全檔切分頁只有 setTab 一條路 ⇒ 那樣等於沒有任何地方會清）。 */
            beamFocus:null,
            dataErr:'',            // 需求 15：pull 失敗時的錯誤（不可用種子蓋掉）
            /* 🔴 v0.13_i 修七 F-29：資料【格式】錯誤不可以放在「這次同步的錯誤」那個容器裡。
               S.dataErr 每次同步成功（cloudSync）與 boot 成功都會被清空
               ⇒ 分區 poly 壞掉的訊息會自己消失（又一個安靜）。
               ⇒ 用這個【不會被同步清掉】的欄位；它只在 reloadObjects() 重算。 */
            geomErr:'' };

const svg = document.getElementById('plan');
const NS  = 'http://www.w3.org/2000/svg';
const el  = (t,a)=>{const n=document.createElementNS(NS,t);
  for(const k in a) n.setAttribute(k,a[k]); return n;};
const $ = id=>document.getElementById(id);
const esc = s=>String(s==null?'':s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ══════════════════════════════════════════════════════════════
   幾何 helpers
   ⚠️ 需求 4 N-8：這一段的【本體】不准因為單位改變而改邏輯。
      本版只加了 null 尺寸與缺牆的守衛（需求 7／需求 9），沒有動運算。
   ══════════════════════════════════════════════════════════════ */
const wallById = id => WALLS.find(w=>w.id===id);
function wallAngle(w){ return Math.atan2(w.y2-w.y1, w.x2-w.x1); }
function wallLen(w){ return Math.hypot(w.x2-w.x1, w.y2-w.y1); }

/* 🔴 v0.12_i 需求 41｜分區幾何（poly）的三個 helper。
   poly ＝ 有序閉合多邊形（頭尾重合點已去除），記憶體側【公分】、資料庫側【公釐整數】。
   ⚠️ 換算共【六處】（v0.13_i 修五更正了 v0.12_i 那句「四處」）：
        ① fromRow('rooms') ② toRow('rooms') ③ toDb('rooms') ④ fromDb('rooms')
        ⑤ projects.floorH ⑥ items.zBase
      漏一處房子就差 10 倍，而且【不報錯】。 */
function validPoly(p){
  if(!Array.isArray(p) || p.length<3) return false;
  for(const q of p){
    if(!Array.isArray(q) || q.length<2 || !isFinite(q[0]) || !isFinite(q[1])) return false;
  }
  return true;
}
/* ⚠️ 格式壞掉時【原樣保留】，不要靜靜換成 null —— 那樣 S.geomErr 就再也偵測不到它。 */
function polyToMM(p){
  if(p==null) return null;
  if(!Array.isArray(p)) return p;
  try{ return p.map(q=>[Math.round(Number(q&&q[0])*10), Math.round(Number(q&&q[1])*10)]); }
  catch(e){ return p; }
}
function polyFromMM(p){
  if(p==null) return null;
  if(!Array.isArray(p)) return p;
  try{ return p.map(q=>[Number(q&&q[0])/10, Number(q&&q[1])/10]); }
  catch(e){ return p; }
}
/* 🔴 形心用【面積加權】（鞋帶公式），不可以用「所有點的平均」——
   房子是歪的、點分布不均，平均會偏。退化情況（面積為 0）才回退成點平均。 */
function polyCentroid(p){
  let a=0, cx=0, cy=0;
  for(let i=0;i<p.length;i++){
    const q1=p[i], q2=p[(i+1)%p.length];
    const f=q1[0]*q2[1]-q2[0]*q1[1];
    a+=f; cx+=(q1[0]+q2[0])*f; cy+=(q1[1]+q2[1])*f;
  }
  a*=0.5;
  if(!isFinite(a) || Math.abs(a)<1e-9){
    let sx=0, sy=0; p.forEach(q=>{ sx+=q[0]; sy+=q[1]; });
    return {x:sx/p.length, y:sy/p.length};
  }
  const c={x:cx/(6*a), y:cy/(6*a)};
  return (isFinite(c.x)&&isFinite(c.y)) ? c : null;
}
/* ╔═ 🔴 v0.17_i 六-c｜point-in-polygon（本批新增的底層，全檔原本 0 處）═══════════╗
   ⚠️ inRoomBBox 是【外接矩形】，不能代打（她的房子是歪的，矩形會嚴重高估）；
      overlap() 寫死四個角，吃不下 11 個房間的多邊形。
   單位：poly 在記憶體是【公分浮點】（fromDb 已換算），🔴 這裡不可以再換一次。
   🔴 邊界情況：點正好落在邊上 ⇒ 明確定義成【屬於】，不要讓它隨浮點誤差跳。
   ⚠️ 門窗（opening，_d §13-55）之後會用同一支【兩側各推一次】得到它連接的兩間；
      本批只做幾何底層，不做門窗 UI。 ╚═══════════════════════════════════════════╝ */
const _ON_EDGE_EPS = 1e-6;
function pointInPoly(poly, x, y){
  if(!validPoly(poly)) return false;
  let inside=false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
    /* 落在這條邊上 ⇒ 直接判「屬於」（先做，才不會被下面的射線奇偶性翻掉） */
    const cross=(xj-xi)*(y-yi)-(yj-yi)*(x-xi);
    if(Math.abs(cross)<=_ON_EDGE_EPS &&
       Math.min(xi,xj)-_ON_EDGE_EPS<=x && x<=Math.max(xi,xj)+_ON_EDGE_EPS &&
       Math.min(yi,yj)-_ON_EDGE_EPS<=y && y<=Math.max(yi,yj)+_ON_EDGE_EPS) return true;
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
/* ╔═ 🔴 v0.17_i 六-a｜家具現在屬於哪一間？（_d §13-61，已裁決）══════════════════╗
   anchor.type==='free' ⇒ 家具中心點落在哪個 poly
   anchor.type==='wall' ⇒ 🔴 用 side 指向的那一側（side 已經是使用者的表態，比中心點準：
                            貼牆家具的中心點很可能落在牆的另一側）
   🔴 丙-4：【不可以】直接讀 anchor.side —— 舊資料的 side 是 null
      （anchorFromMM 寫 side:(a.side ?? null)）
      · 寫成 n.x*null ⇒ 0 ⇒ 探針落在牆上 ⇒ 永遠「判不出來」⇒ 畫面完全安靜
      · 寫成 side||1 ⇒ 所有舊資料一律往基準法線正向探 ⇒ 一半的牆會判到隔壁房間，不報錯
      ⇒ 一律走 wallNormalFor(w, anchor)，它的三層 fallback【一行不改】。
        修六是它的【第四個讀取點】（前三個：place／nudge／previewMove）。
   🔴 §0-5 C-5：探針要沿法線往外走 δ = wallThick(w)/2 + 2 公分
      （先跨過牆體的一半到內側面，再多 2 公分容差吸收浮點縫與匯入誤差；
        上限 wallThick/2 + 8，再多會穿進薄隔間牆的另一間）。
   回傳：房間 id ／ null ＝【判不出來】（🔴 呼叫端必須把它與「沒有房間」分開處理）。╚═╝ */
function roomAtPoint(x,y){
  for(const r of ROOMS){ if(validPoly(r.poly) && pointInPoly(r.poly,x,y)) return r.id; }
  return null;
}
function roomOfAnchor(f, anchor){
  const a=anchor||f.anchor||{type:'free',x:0,y:0};
  if(a.type==='wall'){
    const w=wallById(a.wall);
    if(!w) return null;
    const n=wallNormalFor(w, a);                 // 🔴 不要直接讀 a.side
    const ang=wallAngle(w);
    const bx=w.x1+Math.cos(ang)*(a.along||0), by=w.y1+Math.sin(ang)*(a.along||0);
    const d=wallThick(w)/2 + 2;
    return roomAtPoint(bx+n.x*d, by+n.y*d);
  }
  return roomAtPoint(a.x||0, a.y||0);
}
/* 需求 9：房間不一定有牆（開放式廚房／打通）→ 沒有牆就回 null，不回 NaN
   🔴 需求 41：有 poly 就用 poly 的【形心】；沒有才回退舊算法（靠牆）。 */
function roomCenter(rid){
  const r=ROOMS.find(x=>x.id===rid);
  if(r && validPoly(r.poly)) return polyCentroid(r.poly);
  const ws=WALLS.filter(w=>w.room===rid);
  if(!ws.length) return null;
  let sx=0,sy=0; ws.forEach(w=>{sx+=w.x1;sy+=w.y1;});
  return {x:sx/ws.length, y:sy/ws.length};
}
/* 🔴 房間底的多邊形要靠【牆首尾相接】排出來，不可直接用陣列順序。
   ⚠️ 這是本版換掉假資料後才出現的：v0.1.3.1 的 WALLS 是寫死的 const，順序就是幾何順序；
      現在 WALLS 來自 IndexedDB.getAll()，順序是 UUID 順序（隨機）
      ⇒ 直接連起點會畫出【自交】的多邊形（畫面上是幾塊白色三角）。
   做法：從任一道牆出發，用端點配對往下接。接不完就畫接到的那一段（>=3 點才畫）。 */
function roomRing(rid){
  /* 🔴 需求 41：poly 本來就是有序閉合點列，不必再排。 */
  const r=ROOMS.find(x=>x.id===rid);
  if(r && validPoly(r.poly)) return r.poly.map(p=>({x:p[0], y:p[1]}));
  const ws=WALLS.filter(w=>w.room===rid);
  if(ws.length<3) return null;
  const k=(x,y)=>Math.round(x*10)+','+Math.round(y*10);
  const used=new Set([ws[0].id]);
  const pts=[{x:ws[0].x1,y:ws[0].y1},{x:ws[0].x2,y:ws[0].y2}];
  for(let i=1;i<ws.length;i++){
    const tail=pts[pts.length-1], tk=k(tail.x,tail.y);
    const nx=ws.find(w=>!used.has(w.id) && (k(w.x1,w.y1)===tk || k(w.x2,w.y2)===tk));
    if(!nx) break;
    used.add(nx.id);
    pts.push(k(nx.x1,nx.y1)===tk ? {x:nx.x2,y:nx.y2} : {x:nx.x1,y:nx.y1});
  }
  if(pts.length>3 && k(pts[0].x,pts[0].y)===k(pts[pts.length-1].x,pts[pts.length-1].y)) pts.pop();
  return pts.length>=3 ? pts : null;
}
/* ══ 🔴 v0.12_i 需求 45-b ＋ v0.13_i 修四 ＋ v0.14_i 補二／補三｜牆的內側方向 ══
   side 有【寫入端】與【讀取端】兩組，不是同一個函式：
     sideFromPoint  ＝ 從一個點【算出】side（寫入端，只在吸附成立那一次用）
     wallNormalFor  ＝ 從 anchor【讀出】方向（讀取端，三個地方：place／nudge／預示）
   ⚠️ 舊的 wallNormal(w) 已被這兩個取代。它原本靠 roomCenter(w.room) 判內側，
      而匯入的 33 道牆 room_id 全 NULL ⇒ 一律走進「取任一側」的防呆
      ⇒ 家具有一半機率貼到牆的另一面，而且【不報錯】（obs O-20 抽毯子）。 */
function wallBaseNormal(w){
  const a=wallAngle(w);
  return {x: Math.sin(a), y: -Math.cos(a)};
}
/* side ＝ +1 表示「往基準法線的方向」，-1 表示反向。
   🔴 參考點用【拖曳當下家具的中心】，不是牆上的投影點 ——
      她把床拖到牆的哪一側，那就是她的表態（obs O-8）。 */
function sideFromPoint(w, px, py){
  const n=wallBaseNormal(w);
  const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
  return ((px-mx)*n.x + (py-my)*n.y) >= 0 ? 1 : -1;
}
function wallNormalFor(w, anchor){
  const n=wallBaseNormal(w);
  /* 第一順位：使用者表態過的 side（新資料） */
  if(anchor && (anchor.side===1 || anchor.side===-1))
    return {x:n.x*anchor.side, y:n.y*anchor.side};
  /* 🔴 第二順位（v0.14_i 補三）：舊路徑 —— 這道牆屬於某個房間就朝房間中心。
     ⚠️ 【不可以刪掉】。種子房間的四道牆 room 有值，是今天線上唯一能成立的擺放情境；
        刪了會讓貼在種子牆上、已經擺好的家具【翻面跑到屋外】。 */
  const c=roomCenter(w.room);
  if(c){
    const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
    return ((c.x-mx)*n.x + (c.y-my)*n.y) >= 0 ? n : {x:-n.x, y:-n.y};
  }
  /* 第三順位：都沒有 ⇒ 基準法線（維持現況的防呆，不 NaN） */
  return n;
}
/* 🔴 v0.12_i 需求 42-a：牆的實際厚度（公分）。
   🔴 兩處（畫牆、貼牆位置）都必須用【同一個函式】，不可以一處用 12 一處用 0。 */
function wallThick(w){
  const t=+((w&&w.thickness));
  return (isFinite(t) && t>0) ? t : DEFAULT_WALL_CM;
}
/* 🔴 貼牆家具「離牆多遠」不能寫死用 深/2 —— 自訂旋轉 90° 後，貼著牆的那一邊變成【寬】。
   正解＝旋轉後的實際垂直半徑：|寬/2·sin| + |深/2·cos|
   ⚠️ 需求 7：尺寸未填（null）時這裡會拿到 null → 回 0，不產生 NaN。 */
function perpHalf(f){
  if(f.w==null || f.d==null) return 0;
  const t=(f.rot||0)*Math.PI/180;
  return Math.abs(f.w/2*Math.sin(t)) + Math.abs(f.d/2*Math.cos(t));
}
/* 世界座標＋角度：貼牆的由「牆＋偏移」算出來（_d §5-2 真相唯一） */
function place(f){
  const a0=f.anchor||{type:'free',x:0,y:0};
  if(a0.type==='free')
    return {x:a0.x??0, y:a0.y??0, ang:(f.rot||0)*Math.PI/180, wall:null};
  const w=wallById(a0.wall);
  /* 🔴 需求 9：牆不見了也不炸。⚠️ 這是防呆不是正解——
     正解是需求 6 的 anchor 重設（刪房間時就地轉絕對座標）。兩層都要。 */
  if(!w) return {x:a0.x??0, y:a0.y??0, ang:(f.rot||0)*Math.PI/180, wall:null};
  /* 🔴 需求 45-b：方向由 anchor.side 讀出（讀取點 ①／三），不再即時判斷。 */
  const a=wallAngle(w), n=wallNormalFor(w, a0);
  const ux=Math.cos(a), uy=Math.sin(a);
  const bx=w.x1+ux*(a0.along||0), by=w.y1+uy*(a0.along||0);
  /* 🔴 需求 42-b：貼牆位置改成【內側面】，不吃牆（§13-21 已定：分區邊界＝牆的內側面）。
     現況只有 perpHalf(f) ⇒ 家具中心離【牆的中心線】＝家具半深 ⇒ 壓進牆體 thickness/2。
     ⚠️ 既有存檔的 off 值【不動】：off 的語意不變（額外偏移），
        只是基準從中心線移到內側面 ⇒ 已貼牆的家具會整批往外跳 thickness/2（那是修正）。 */
  const dep=perpHalf(f) + wallThick(w)/2 + (a0.off||0);
  return {x:bx+n.x*dep, y:by+n.y*dep, ang:a+(f.rot||0)*Math.PI/180, wall:w};
}
/* 旋轉矩形的四角 */
function corners(cx,cy,w,d,ang,grow){
  const hw=w/2+(grow||0), hd=d/2+(grow||0);
  const c=Math.cos(ang), s=Math.sin(ang);
  return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]]
    .map(([x,y])=>({x:cx+x*c-y*s, y:cy+x*s+y*c}));
}
/* SAT：兩個旋轉矩形有沒有相交 */
function overlap(A,B){
  for(const poly of [A,B]){
    for(let i=0;i<4;i++){
      const p1=poly[i], p2=poly[(i+1)%4];
      const ax=-(p2.y-p1.y), ay=p2.x-p1.x;
      let a1=Infinity,a2=-Infinity,b1=Infinity,b2=-Infinity;
      A.forEach(p=>{const v=p.x*ax+p.y*ay; a1=Math.min(a1,v); a2=Math.max(a2,v);});
      B.forEach(p=>{const v=p.x*ax+p.y*ay; b1=Math.min(b1,v); b2=Math.max(b2,v);});
      if(a2<b1||b2<a1) return false;
    }
  }
  return true;
}
/* 拖曳中的「當下位置」——正在拖的那件用手指當下的位置畫，其餘照舊（O-7） */
function liveP(f){
  if(S.dragging && S.dragging.f.id===f.id)
    return {x:S.dragging.gx, y:S.dragging.gy, ang:S.dragging.ang, wall:null};
  return place(f);
}
function boxOf(f,grow){ const p=liveP(f);
  return corners(p.x,p.y,f.w,f.d,p.ang,grow); }
/* 斜擺＝角度不是 90 度倍數 */
function isSkew(f){ const p=place(f);
  const deg=((p.ang*180/Math.PI)%90+90)%90;
  return Math.min(deg,90-deg) > 1.5;
}
/* 需求 7：尺寸未填的物件【不參與碰撞】 */
const hasSize = f => f && f.w!=null && f.d!=null;
/* 需求 8：會出現在平面圖上的家具＝有房間 ＋ 已擺 ＋ 有尺寸 */
const onPlan  = f => hasSize(f) && f.isPlaced && f.room;
function collisions(f){
  const hit=[], near=[];
  if(!hasSize(f)) return {hit,near};
  const A=boxOf(f,0), Ac=boxOf(f,CLEAR_CM/2);
  /* ╔═ 🔴 v0.17_i 六-e（Ali 2026-09-14 裁決走【甲】）｜碰撞不再過濾房間 ═════════════╗
     舊的 `g.room!==f.room` 成立的前提是「f.room 是穩定標籤」，而修六讓它【每次放手都可能變】
     ⇒ 你把椅子從客廳推到餐廳，一放手，沙發被濾掉 ⇒ 警示列從紅變綠，而兩件東西還疊在一起。
     為什麼是甲（理由要留著，不然下一手會想改回去）：
       乙（維持過濾、改房間後強制重算）錯的地方剛好是她家最常用的【開放式客餐廳】——
       那裡兩件東西之間沒有牆卻分屬兩個分區 ⇒ 乙會在那裡【漏報】，而且無聲無息。
       甲錯的地方是「隔著牆的兩件會被算成走道不足」⇒ 那是【看得見的多報】。
       依不可變方向 #9「算給你看，不替你判斷」：🔴 一個沉默的漏報，比一個吵的多報危險。
     ⚠️ 已知代價（交付必講，不是 bug）：隔著一道 12cm 牆的兩個櫃子會顯示「走道不足」。
        完整解是【甲 ＋ 擋牆判定】（需要線段與矩形相交），本批不做，記在 _d §13-65。
     ⚠️ 效能：原本只比同房間 ⇒ 實際比對量小；改成全部比 ⇒ render() 對每一件算 collisions，
        而 collisions 又掃每一件 ⇒ O(N²) 且每次 render 都算。
        🔴 家具數上到數十件而畫面開始卡時，【第一個要看的就是這裡】。 ╚═══════════════╝ */
  FURN.forEach(g=>{ if(g.id===f.id) return;
    if(!onPlan(g)) return;
    if(overlap(A,boxOf(g,0))) hit.push(g);
    else if(overlap(Ac,boxOf(g,CLEAR_CM/2))) near.push(g);
  });
  return {hit,near};
}
/* 點到線段的距離 */
function distSeg(px,py,w){
  const dx=w.x2-w.x1, dy=w.y2-w.y1, L=dx*dx+dy*dy;
  let t=L? ((px-w.x1)*dx+(py-w.y1)*dy)/L : 0;
  t=Math.max(0,Math.min(1,t));
  return {d:Math.hypot(px-(w.x1+dx*t), py-(w.y1+dy*t)), t};
}
/* 螢幕↔世界 */
const w2s = (x,y)=>({x:x*S.zoom+S.panX, y:y*S.zoom+S.panY});
const s2w = (x,y)=>({x:(x-S.panX)/S.zoom, y:(y-S.panY)/S.zoom});
/* 🔴 需求 45-c：吸附距離要加世界座標上限（見 SNAP_MAX_CM 的註解）
   🔴 v0.17_i §0-5 C-7：本函式自 v0.1.6 起【不再用於吸附觸發】——
      觸發門檻改成 wallThick(w)/2（修七-a／甲-1）。保留它以備回退。
      ⚠️ 下面那段「為什麼需要 50cm 上限」的長註解講的是【舊的觸發路徑】，
         不要照著它去推現在的行為（SNAP_MAX_CM 本身仍在用：修五的〔貼到牆〕靠它當上限）。 */
const snapCm  = ()=> Math.min(SNAP_PX/S.zoom, SNAP_MAX_CM);
/* ╔═ 🔴 v0.17_i 甲-2（修十五）｜只把 NUDGE_MIN 改成 0.5 是【沒有效果】的 ══════════╗
   zoom 被 zoomAt 夾在 0.2–6 ⇒ Math.round(3/6)=Math.round(0.5)=1
   ⇒ 舊寫法 Math.round(...) 的輸出【恆 ≥ 1】⇒ Math.max(0.5, ≥1) 永遠等於後者
   ⇒ 症狀：常數改了、node --check 過、.padc 仍顯示「1 cm」、按鈕仍走 1 公分 —— 一句話都沒有。
   ⇒ 取整必須改成【半公分粒度】。
   📌 0.5 是【下限】不是固定值：步進仍隨縮放變動，全屋檢視下 .padc 仍會寫 3 cm／6 cm。
      （與 _d §10-1b「微調仍屬不可變方向 #11」一致；若要「一律 0.5」那是另一件事。）╚═╝ */
const nudgeCm = ()=> Math.max(NUDGE_MIN, Math.round(NUDGE_PX/S.zoom*2)/2);

/* ══════════════════════════════════════════════════════════════
   🔴 需求 20｜「給人讀的文字」一律畫在【畫面座標】，不隨 zoom／pan 跑出畫面
   來歷（Ali 手機截圖，zoom 192%）：房間只有 400×300 公分 ⇒ fit() 把它撐到滿寬
     ⇒ 用世界座標畫的文字被推出畫面左邊：
        「（可刪）」只剩右半／「單〕重來，或直接改它」左邊被切／「道寬 60 公分」的「走」被切
   做法：另開一個【不受 transform 影響】的圖層（直接掛在 <svg> 上，不進 g），
         字級用固定 px（不隨 zoom 變大變小），位置一律夾在可見範圍內。
   ⚠️ 家具名稱【仍然跟世界座標】（必須貼在物件上才有意義），但算出來的位置要夾回邊界。
   ══════════════════════════════════════════════════════════════ */
let _uiLayer=null;                     // 畫面座標圖層（每次 render 重建）
const SVG_PAD = 6;                     // 夾限留白
function svgSize(){
  const r=svg.getBoundingClientRect();
  /* ⚠️ O-1：版面未定案時 rect 是 0。回一個保底值，不要讓夾限算出 NaN／負數。 */
  return { w: r.width  || 360, h: r.height || 480 };
}
/* 在畫面座標圖層寫一行字，並把它夾回可見範圍內。
   🔴 夾限用【實際量出來的 getBBox()】，不用估寬。
      ⚠️ 這一條是 N-113 實測抓到的：第一版用 `字數 × px × 0.62` 估寬，
         但【中日韓字寬約 1em】，估出來只有實際的六成
         ⇒ 平移到角落時「範例房間（可刪）」與「走道寬 60 公分」照樣跑出畫面。
         ⇒ 估的東西會錯，量的東西不會。 */
/* 🔴 v0.09_i 需求 32：SVG 的字級也要跟著同一個知識來源走。
   ⚠️ 刻意【讀 CSS 變數】而不是在 JS 裡另外寫一個 1.2——
      兩個地方各寫一份就不是「單一來源」了，下次只改一邊就會不同步。 */
function fsScale(){
  const v=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs'));
  return (isFinite(v)&&v>0)?v:1;
}
/* 🔴 v0.13_i 修七 F-12：房間名改畫在形心之後【不可以】套那段螢幕座標夾限——
   夾限是為了「單一房間的名字不要跑出畫面」寫的；10 間房一起夾，會全部疊成一坨
   堆在畫面邊緣。⇒ 傳 {clamp:false}：畫面外就不畫。
   ⚠️ v0.14_i 補七 N-8c：本批【只改房間名】的夾限，家具名維持現有夾限，下一手不必重想。 */
function uiText(sx, sy, txt, opt){
  const o=opt||{};
  if(o.clamp===false){
    const {w,h}=svgSize();
    if(!isFinite(sx) || !isFinite(sy)) return null;
    if(sx < -SVG_PAD || sx > w+SVG_PAD || sy < -SVG_PAD || sy > h+SVG_PAD) return null;
  }
  const px=(o.size||13)*fsScale();
  const anchor=o.anchor||'start';
  const t=el('text',{x:sx, y:sy, 'text-anchor':anchor,
    fill:o.fill||'var(--sub)', 'font-size':px,
    'pointer-events':'none'});
  if(o.weight) t.setAttribute('font-weight',o.weight);
  if(o.opacity!=null) t.setAttribute('opacity',o.opacity);
  t.textContent=txt;
  _uiLayer.appendChild(t);
  if(o.clamp===false) return t;      // 🔴 F-12：房間名不夾限（畫面外就不畫，上面已擋）
  try{
    const {w,h}=svgSize();
    const b=t.getBBox();
    let dx=0, dy=0;
    if(b.width <= w-2*SVG_PAD){
      if(b.x < SVG_PAD) dx = SVG_PAD - b.x;
      else if(b.x+b.width > w-SVG_PAD) dx = (w-SVG_PAD) - (b.x+b.width);
    }else{
      dx = SVG_PAD - b.x;          // 比畫面還寬 → 至少讓【開頭】看得到，不要左邊被切
    }
    if(b.y < SVG_PAD) dy = SVG_PAD - b.y;
    else if(b.y+b.height > h-SVG_PAD) dy = (h-SVG_PAD) - (b.y+b.height);
    if(dx||dy){ t.setAttribute('x', sx+dx); t.setAttribute('y', sy+dy); }
  }catch(e){ /* getBBox 在版面未定案時會丟 → 這一幀不夾，下一幀 render 會再來一次 */ }
  return t;
}

/* 需求 8／需求 11：房間色。
   🔴 v0.05_i §3（修三）：依【createdAt（建立順序）】排序取色，不是陣列順序。
      ⚠️ 原因：WALLS/ROOMS 來自 IndexedDB.getAll()，順序是 UUID 順序（隨機），
         「陣列順序」跨裝置一致但【不是建立順序】⇒ 新增房間 UI 一落地就會顯形。
   邊界：
     · 舊資料沒有 createdAt → localeCompare 讓空字串排最前面（它們本來就是最早的）。
       🔴 不補寫假的 createdAt（obs O-13）。
     · createdAt 完全相同 → 用 id 當第二順位，保證兩台裝置排出同一個順序。
     · 🔴 排序用的是 ROOMS_ALL（**含軟刪除的墓碑**），不是只有活的。
       依據＝v0.05_i §3 自己的兩條驗收：
         N-93「刪中間那一間 → 另外兩間的顏色【不變】（不是重新編號）」
         邊界「房間被刪（軟刪）再還原 → 順序不變 ⇒ 顏色不會跳」
       ⚠️ 兩條都只有在【墓碑仍然佔著它的名次】時才成立。
       （v0.05_i §3 貼的 pseudocode 寫 `ROOMS.filter(r=>!r.deletedAt)`，
         那會重新編號、與它自己的 N-93 相反 ⇒ 已回報，碼取 N-93 那一邊。）
   ⚠️ room 為 null → 中性灰，與清單「未擺放」分組同一個灰。 */
let ROOMS_ALL = [];        // 含墓碑，只給 roomOrder() 用
function roomOrder(){
  return ROOMS_ALL.slice().sort((a,b)=>{
    const c=String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    return c!==0 ? c : String(a.id).localeCompare(String(b.id));
  });
}
/* 🔴 需求 43 ＋ v0.13_i 修十 F-21：樑的【穩定】排序。
   平面圖上的「樑 3」與設定頁的「樑 3」必須是同一根，重新載入後編號也不可以變。
   ⚠️ createdAt 相同（同一次 SQL 插入，六根幾乎必然相同）→ 用 id 字串比大小當第二鍵
      ⇒ 穩定且跨裝置一致。 */
function beamOrder(){
  return BEAMS.slice().sort((a,b)=>{
    const c=String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    return c!==0 ? c : String(a.id).localeCompare(String(b.id));
  });
}
function roomColor(roomId){
  if(!roomId) return 'var(--dim)';
  const i=roomOrder().findIndex(r=>r.id===roomId);
  if(i<0) return 'var(--dim)';
  return ROOM_PALETTE[i % ROOM_PALETTE.length];
}
function roomName(roomId){
  const r=ROOMS.find(x=>x.id===roomId);
  return r ? (r.name||'未命名') : '未指定房間';
}
/* 🔴 v0.09_i 需求 33：這一筆的 room 還指得到一間【存活】的房間嗎？
   ⚠️ 「指不到」有兩種來源：
        · room 本來就是 null（使用者還沒指定）
        · room 有值，但那間房間已經被軟刪 ⇒ 【孤兒】
      以前碰不到孤兒，是因為 UI 刪房間走 deleteRoomCascade()，它會把 room 設成 null；
      而需求 31 之後【雲端可以直接送來房間墓碑】，本機沒有經過那條路。
   🔴 這個函式只給【顯示層】用——不可以拿它去把 f.room 改寫成 null。
      理由：房間墓碑之後若被還原（或另一台推回活的版本），這筆家具要能自己回去。 */
function roomAlive(roomId){ return !!roomId && ROOMS.some(r=>r.id===roomId); }

/* ══════════════════════════════════════════════════════════════
   需求 14｜比例尺：拆成兩個元件
   ① 走道寬度示意帶（既有，保留）——標籤指的是【厚度】
   ② 長度比例尺（🆕）——長度由當前 zoom 實算
   🔴 O-9：「標示」與「比例尺」是兩種東西。不可共用標籤。
   ══════════════════════════════════════════════════════════════ */
let _scaleCm = null;                    // 需求 14：遲滯用，記住上一次回傳的候選
function niceScaleCm(zoom){             // zoom = 每公分幾個螢幕 px
  const CAND=[10,20,50,100,200,500];
  const TARGET=90;                      // 目標螢幕長度（60~120 的中點）
  /* 🔴 遲滯：上一次的候選若仍落在 50~140px（比 60~120 寬的容忍帶）就沿用，
     一次縮放手勢裡最多換一次，不會在兩個候選之間來回跳。 */
  if(_scaleCm!=null){
    const px=_scaleCm*zoom;
    if(px>=50 && px<=140) return _scaleCm;
  }
  let best=CAND[0], bestErr=Infinity;
  for(const c of CAND){
    const err=Math.abs(c*zoom-TARGET);
    if(err<bestErr){ bestErr=err; best=c; }
  }
  _scaleCm=best;
  return best;
}
/* 分區多邊形的所有頂點（planBounds 用）。 */
function polyPoints(){
  const out=[];
  ROOMS.forEach(r=>{ if(validPoly(r.poly)) r.poly.forEach(q=>out.push(q)); });
  return out;
}
/* 🗂 v0.21_i 下-22：這裡原本有 dataLeft()／dataBottom()／barY()／scaleY()／corridorHint(g)／lengthScale(g)
   —— 示意帶與比例尺畫在【世界座標】（跟著平面圖走），只有文字在畫面座標並夾在畫面內
   ⇒ 平面圖一拖開，圖形與文字就分家（Ali 2026-09-28 看到的正是這個；不是 v0.1.8 改壞的）。
   ⇒ 整組搬進畫面座標的 HUD（見下方 drawHUD）。六支舊函式搬家之後**全部沒有人讀**
     ⇒ 一併刪除（讀坑 ⚠️9；留著會讓下一個人以為示意帶還在世界座標，O-25）。 */

/* ╔═ 🔴🔴 v0.21_i §1-3 ⑤｜「家具面板現在有沒有顯示」的【判準】（讀坑 🔴1）═══════════════╗
   🔴 HUD **不可以**讀 `!$('sel').hidden` 來決定藏不藏：
      全檔慣例是 `render(); syncSel();` —— render 先跑、syncSel 才去改 #sel.hidden
      ⇒ render 讀到的 #sel 永遠是【上一個狀態】
      ⇒ 取消選取後左下角是空的，要等下一次拖或縮放才出現 ⇒ N-606 必敗，而且不報錯。
   ✅ 把 syncSel() 用來決定面板顯示的那個判準抽成一支，**兩邊共用**。
   🔑 仍然是「綁在蓋住它的那個東西上」—— 只是綁它的【判準】，不綁它的【DOM 狀態】
      （O-20：DOM 是結果，不是來源）。 ╚═══════════════════════════════════════════════╝ */
const selPanelShown = ()=> !!FURN.find(x=>x.id===S.selId) && S.tab==='plan';
/* 🔴 v0.21_i B-4（Ali 2026-09-28 照建議）：同一塊地方還有兩條提示列會蓋住 HUD ——
   〔👆 點平面圖上要標記的位置〕（#pinning）與〔‹ 返回設定〕（#beamBack），
   兩者都是 `position:fixed; bottom:56px`，正好壓在 svg 底部。
   ⇒ 照同一個原理，也用它們的【判準】（S.beamFocus），不讀 DOM 的 hidden。
   🗂 v0.1.9：#pinning 與 S.pinPhoto 已拿掉（R-23）；改成定位面板與預覽卡的判準（見下一行）。 */
const hudCovered = ()=> selPanelShown()
                     || pinPanelShown() || pinCardShown()     // 🔴 v0.1.9 R-20：定位面板與預覽卡也壓在同一塊
                     || (S.tab==='plan' && !!S.beamFocus);

/* ╔═ 🔴 v0.21_i 下-22｜走道示意＋比例尺 → 固定在畫面左下（HUD）═══════════════════════╗
   Ali 定的版面（2026-09-28，已看過介面預覽並同意）：
                左欄                         右欄（從畫面中線開始）
     圖示列　［走道圖示］　　　　　　　　　［比例尺］　 ← 隨縮放改變，往【上】長
     文字列　 走道寬度 60 cm　　　　　　　　 200 cm　　 ← 🔴 固定不動
   🔑 她的原理：「不會隨著畫面放大的資訊固定在下方，上方放會隨畫面改變的。」
      ⇒ 圖示的【底邊】對齊文字列上緣，放大時只往上長 ⇒ 文字永遠不動（N-602）。

   ① 全部畫進 _uiLayer（畫面座標，不進世界座標的 g）⇒ 平面圖拖到哪裡都不動（N-601）。
      每次 render 跟著 _uiLayer 一起重建 ⇒ 縮放時即時更新。
   ② 走道示意帶：長 **75 cm**（原本 150 的一半，Ali：「剩下目前長度的一半」）、厚 60 cm（CLEAR_CM），
      螢幕尺寸＝公分 × S.zoom（仍然是真實比例）；人形跟著縮放。
      🔴 **引線與刻度用畫面 px**（帶子右緣 +8 px、刻度 ±4 px）—— 照預覽（O-27：預覽＝規格）。
         理由：舊碼的引線是 +14 cm、刻度 ±5 cm 都跟著縮放 ⇒ 門檻附近會伸進右欄壓到比例尺。
      🔴 B-2（Ali 照建議）：填色用**平塗**（照預覽），不用舊的斜線 `url(#clr)` ——
         那個 pattern 是 userSpaceOnUse 7×7，搬進沒有 scale 的 _uiLayer 後花紋固定 7 px、
         不隨縮放，會與地板上的走道網格長得不一樣。
      文案「走道寬度 60 cm」照 Ali 寫的（原本是「👤 走道寬 60 公分」）。
   ③ 🔴 放大超過尺寸 ⇒ 走道先隱藏（**圖示與文字一起**）。門檻（Ali 看過預覽同意）：
         75 × zoom ＋ 8 px（引線）＞ 左欄可用寬（svg 寬 / 2 − 24 px）
         或 60 × zoom ＞ svg 高 × 0.25
      📌 真機 417×709（svg 高＝innerHeight − 138）：**寬度條件先到**，約每公分 2.35 px
         （含引線的 8 px；只算帶子本身是 2.46）。
   ④ 比例尺**永遠不隱藏**；長度仍由 niceScaleCm 決定（含遲滯）。
      超出畫面時線畫到右緣 − 6 px、**右端刻度不畫**（＝這條線沒有另一邊的邊界）。
      📌 這是防呆：線長最多約 140 px（遲滯帶上限）、右欄約 202 px ⇒ 真機縮放全範圍都觸發不到
         （B-5：Ali 照建議，留作防呆、改由建造者驗）。
   ⑤ 🔴 家具面板或兩條提示列顯示中 ⇒ 整組隱藏（hudCovered，見上方）。 ╚══════════════════╝ */
const HUD_BAND_CM = 75;          // 走道示意帶的長度（公分）
function hudGeom(){
  const {w:W, h:H}=svgSize();
  const fs=fsScale();
  const txtBase = H - 12;                 // 文字列基線
  const txtTop  = txtBase - 13*fs;        // 文字列上緣（字級 13 × --fs）
  const iconBot = txtTop - 6;             // 圖示列底邊
  return {W, H, fs, txtBase, iconBot};
}
/* 走道示意要不要因為放大而隱藏（③）。抽出來是為了讓 fit() 的預留計算與畫的時候用同一條規則。 */
function hudBandHidden(z){
  const {W,H}=hudGeom();
  return (HUD_BAND_CM*z + 8 > W/2 - 24) || (CLEAR_CM*z > H*0.25);
}
function drawHUD(){
  if(hudCovered()) return;                               // ⑤
  const G=hudGeom(), z=S.zoom;
  const hud=el('g',{'data-hud':'1','pointer-events':'none'});
  const txt=(x,s,opt)=>{ const t=el('text',{x, y:G.txtBase, 'font-size':13*G.fs,
      fill:(opt&&opt.fill)||'var(--sub)', 'pointer-events':'none'});
    if(opt&&opt.weight) t.setAttribute('font-weight',opt.weight);
    t.textContent=s; hud.appendChild(t); };
  /* ── 左欄：走道示意帶（②③）── */
  if(!hudBandHidden(z)){
    const bw=HUD_BAND_CM*z, bh=CLEAR_CM*z;
    const x0=12, y0=G.iconBot-bh;
    hud.appendChild(el('rect',{x:x0, y:y0, width:bw, height:bh,
      fill:'var(--sub)','fill-opacity':.14, stroke:'var(--line)','stroke-width':1.5}));   // 🔴 B-2 平塗
    // 人形（肩軸橫跨通道）：肩寬 45、身厚 18、頭直徑 18（真實公分）⇒ 跟著縮放
    const pcx=x0+bw/2, pcy=y0+bh/2;
    hud.appendChild(el('ellipse',{cx:pcx, cy:pcy, rx:9*z, ry:22.5*z,
      fill:'var(--accent)','fill-opacity':.30, stroke:'var(--accent)','stroke-width':1.5}));
    hud.appendChild(el('circle',{cx:pcx, cy:pcy, r:9*z,
      fill:'var(--accent)','fill-opacity':.55, stroke:'var(--accent)','stroke-width':1.5}));
    /* 🔴 需求 14：引線必須指向【厚度】方向（垂直），不可讓人讀成長度。
       🔴 v0.21_i：引線與刻度用畫面 px（+8／±4），不跟著縮放。 */
    const lx=x0+bw+8;
    [[lx,y0,lx,y0+bh],[lx-4,y0,lx+4,y0],[lx-4,y0+bh,lx+4,y0+bh]].forEach(a=>
      hud.appendChild(el('line',{x1:a[0],y1:a[1],x2:a[2],y2:a[3],
        stroke:'var(--sub)','stroke-width':1.6})));
    txt(x0, `走道寬度 ${CLEAR_CM} cm`);
  }
  /* ── 右欄：長度比例尺（④）——從畫面中線開始 ── */
  const cm=niceScaleCm(z), sx=G.W/2, len=cm*z, ly=G.iconBot-8;
  const xEnd=Math.min(sx+len, G.W-6), full=(sx+len)<=G.W-6;
  hud.appendChild(el('line',{x1:sx,y1:ly,x2:xEnd,y2:ly, stroke:'var(--ink)','stroke-width':2.4}));
  hud.appendChild(el('line',{x1:sx,y1:ly-8,x2:sx,y2:ly+8, stroke:'var(--ink)','stroke-width':2.4}));
  if(full)   // 🔴 超出畫面時右端刻度不畫（防呆，見 ④）
    hud.appendChild(el('line',{x1:xEnd,y1:ly-8,x2:xEnd,y2:ly+8, stroke:'var(--ink)','stroke-width':2.4}));
  txt(sx, `${cm} cm`, {fill:'var(--ink)', weight:600});
  _uiLayer.appendChild(hud);
}
/* 🔴 v0.21_i B-1（Ali 照建議）：〔全圖〕時畫面底部要留一個 HUD 的高度。
   理由：拿掉示意帶的世界座標預留（舊的 160 公分）之後，fit 的留白只剩 FIT_PAD（她家全屋約 10 px），
   而 HUD 高約 50 px ⇒ **房子最下面會被 HUD 壓住**。
   ⇒ 預留的是【畫面 px】（HUD 實際多高就留多高），不是舊的那一大塊世界座標空白（N-607）。
   高度＝ 12（基線到底）＋ 文字列 ＋ 6 ＋ max(比例尺刻度 16, 走道圖示高) */
function hudReservePx(z){
  const G=hudGeom();
  const iconH = hudBandHidden(z) ? 16 : Math.max(16, CLEAR_CM*z);
  return 12 + 13*G.fs + 6 + iconH;
}

/* ══════════════════════════════════════════════════════════════
   繪圖
   ══════════════════════════════════════════════════════════════ */

/* ╔══ 🔴 v0.20_i §2-3｜疊圖順序改成【一張表】 ═══════════════════════════════════╗
   Ali 問的是：「這個是**活方向**，如果之後要改好改嗎？」（`_d` §13-71）
   ⇒ 現在的答案：**改 DRAW_ORDER 裡的一個數字就換順序。**
     而且下一批（弱電／燈具真的要畫）時，只要把空函式填上內容，**順序已經是對的**。

   ── 🔴🔴 為什麼每一支都要吃 `ctx` ────────────────────────────────────────────
   `g`（render 裡的 `const g=el('g',…)`）與 `sel`（`const sel=FURN.find(…)`）
   **都是 render() 的區域 const**，抽出去的函式看不到它們。
   ⇒ 寫成零參數的 `d.fn()` ⇒ `ReferenceError: g is not defined`
     而 render() 在 boot() 的 try 之外 ⇒ 🔴 **啟動就白畫面**。
   🛑 **不要**把 g／sel 提升成模組層 let —— 那是隱形全域，下一個人不知道它何時有效（O-20）。

   ── 🔴 各支「自己判斷要不要畫」，不要在排序那一行過濾 ──────────────────────
   否則 §1-1b 的「走道三檔」會被一刀切掉（見 drawGrid 內的說明）。 ╚══════════════╝ */

/* 走道網格（常駐視覺，_d §5-6 方向 #7）—— 內容從 render() 原樣搬家，一行未改。 */
function drawGrid(ctx){
  const {g, sel}=ctx;
  FURN.forEach(f=>{
    if(!onPlan(f)) return;
    const isDrag = S.dragging && S.dragging.f.id===f.id;
    /* 🔴 §1-1b：走道網格是【三檔】不是布林 —— 全關時，選中的那一件與正在拖的那一件
       仍然要畫（Ali 平常不開這個勾，她看到的就是那個狀態）。
       🔴🔴 這一行的判斷式【一個字不改】。
       ⚠️ 若把整段用 if(L('grid')) 包起來，會連那個一起關掉（_d 死規則 #7）
          —— 而且**壞了完全安靜**：▦ 平常就是暗的，她要到下一次想看走道夠不夠時才發現。 */
    if(!L('grid') && !isDrag && (!sel || sel.id!==f.id)) return;
    const p=liveP(f), pts=corners(p.x,p.y,f.w,f.d,p.ang,CLEAR_CM/2);
    const n=collisions(f);
    g.appendChild(el('polygon',{points:pts.map(q=>`${q.x},${q.y}`).join(' '),
      fill:'url(#clr)', color: n.near.length?'var(--warnA)':'var(--sub)',
      stroke: n.near.length?'var(--warnA)':'var(--line)',
      'stroke-width':2,'stroke-dasharray':'8 6', opacity:.9}));
  });
}
/* ── 家具本體 ──
   🔴 需求 11（v0.04_i §4）三個視覺通道，取代原本的優先權表：
      填色     ← 自訂色（color 為 null 用系統預設）。唯一例外：撞到 → 紅
      外框顏色 ← 所屬房間的顏色。唯一例外：走道不足 → 橙
      外框粗細 ← 選中：2px → 4px（🔴 只改粗細，不改顏色）
   🔴 v0.20_i §2-3c 地雷一：本支與 drawName() 原本是【同一個 forEach】，拆開之後
      `p`／`n`／`on`／`isDrag` **各自重算**，不可以共用閉包或暫存陣列
      （下一個人不知道那個暫存何時失效）。 */
function drawFurn(ctx){
  const {g, sel}=ctx;
  FURN.forEach(f=>{
    if(!onPlan(f)) return;
    const p=liveP(f), pts=corners(p.x,p.y,f.w,f.d,p.ang,0);
    const n=collisions(f), on=sel&&sel.id===f.id;
    const isDrag = S.dragging && S.dragging.f.id===f.id;
    const fillCol   = n.hit.length ? 'var(--warnB)' : (f.color || 'var(--furn)');
    const strokeCol = n.near.length? 'var(--warnA)' : roomColor(f.room);
    const strokeW   = on ? 4 : 2;
    g.appendChild(el('polygon',{points:pts.map(q=>`${q.x},${q.y}`).join(' '),
      fill: fillCol,
      'fill-opacity': n.hit.length?.55:(isDrag?.75:(on?.92:.8)),
      stroke: strokeCol,
      'stroke-width': strokeW,
      'data-f':f.id}));
    if(isDrag){   // 拖曳中額外給一個「浮起來」的外框，讓「它正在被拖」看得出來
      g.appendChild(el('polygon',{points:pts.map(q=>`${q.x},${q.y}`).join(' '),
        fill:'none',stroke:'var(--furnSel)','stroke-width':6,opacity:.45}));
    }
  });
}
/* ── 家具名稱 ──
   🔴🔴 **本支不在 DRAW_ORDER 裡**，由 render() 在排序迴圈【結束之後】單獨呼叫。
      理由：它走 uiText() → `_uiLayer`，而 `_uiLayer` 是 `g` 的【兄弟且排在後面】
      ⇒ **所有 uiText 畫的字永遠蓋在 g 的一切之上**，與呼叫順序無關
      ⇒ 給它一個 z 是假的（改成 1 或 99 畫面都不會變）⇒ 它結構上就不參與疊圖。
      🛑 不要為了讓它參與而把它改畫進 g —— 那會推翻【需求 20】
         （給人讀的文字用畫面座標，不隨 zoom 跑出畫面）。
   🔴 §2-3c：本支**不要算 collisions()** —— 名稱不看碰撞，而 collisions 是 O(N²)。
   🔴 §2-3c 地雷二：下面那個條件【一個字不准改】。 */
function drawName(ctx){
  FURN.forEach(f=>{
    if(!onPlan(f)) return;
    const p=liveP(f);
    /* 🔴 v0.17_i 修十一：家具名稱【畫面外就不畫】（clamp:false），不要被夾在畫面邊緣。
       🔴 就這樣，一個參數。【不要】順手改 uiText 的預設值——它還有房間名、樑編號、
          走道數字、比例尺、三行左上提示共 8 個呼叫點，改預設值會一次影響全部。 */
    const ps=w2s(p.x, p.y);
    /* 🔴🔴 v0.19_i §1-3e：關掉「名稱」時，有名字的不畫；
       **f.name 是空的照樣畫「未命名」** —— 那一層同時扛著「這一件還沒取名字」的
       資料完整度訊號，關掉它 ＝ 連帶關掉那個訊號（_d 死規則 #7 ／ obs O-13）。
       Ali 2026-09-19：「留。（目前測試階段我還真的這樣做）」
       ⚠️ 一個條件，不是兩個分支。 */
    if(shown('name') || !f.name)
      uiText(ps.x, ps.y+4, f.name||'未命名',
        {size:12, anchor:'middle', fill:'var(--ink)', clamp:false});
  });
}
/* 🗂 v0.1.9 R-23：舊的照片標記 drawMk（世界座標、r=17 公分、跟著縮放）整支拿掉，
   換成相簿釘子 drawPins（畫面座標、固定大小；在 render 的 drawName 之後呼叫，見下方）。 */
/* 🛑 本批【佔位，不畫】（§0-3：三層的本體不做）。
   下一批要畫時，內容填進來就好 —— 順序已經在 DRAW_ORDER 裡排好了。
   🔴 各支自己判斷要不要畫：填內容時第一行請寫 `if(!shown('appl')) return;`。 */
function drawAppl(ctx){ /* 電器：本批空 */ }
function drawWire(ctx){ /* 弱電：本批空 */ }
function drawLamp(ctx){ /* 燈具：本批空 */ }

/* 🔴 疊圖順序的【唯一來源】。LAYERS 不再放 z —— 兩張表都放一定會有一天不同步，
   而且【家具本體不是圖層，卻也要參與排序】，所以它必須是獨立的一張表。
   🔴 方向：**數字大 ＝ 畫在上面**。
   🔴 `layer` 欄只是給人看的對照（哪一段對應哪一個圖層開關）；
      **render 不讀它** —— 過濾一律由各支函式自己做（見上方說明）。
   定序依 `_d` §13-71：照片（相簿）＞ 燈具／弱電 ＞ 電器 ＞ 家具
   （Ali：「照片預設在最上方好了。」）；走道網格壓在家具【之下】維持現況視覺。 */
const DRAW_ORDER = [
  { z:5,  fn:drawGrid, layer:'grid'  },   // 走道網格（壓在家具之下）
  { z:20, fn:drawFurn, layer:null    },   // 🔴 家具本體：永遠畫，不受圖層控制
  { z:30, fn:drawAppl, layer:'appl'  },   // 電器（本批空）
  { z:50, fn:drawWire, layer:'wire'  },   // 弱電（本批空）
  { z:51, fn:drawLamp, layer:'lamp'  },   // 燈具（本批空）
  /* 🗂 v0.1.9：z:70 的照片標記移出這張表 —— 相簿釘子畫在畫面座標（_uiLayer），
     與世界座標的一切沒有前後關係（永遠在上面），給它 z 是假的（同 drawName 的理由）。 */
];

/* ╔═ 🔴 v0.21_i 下-23｜活方向（`_d` §13-102）：拖曳時房間名要不要暫時出現 ═══════════╗
   Ali 2026-09-28：「要：拖曳時就算 ▦ 關著，房間名也暫時出現。……
                    請幫我把這個決定列為活方向，讓他好修改，我想要以之後的操作情況去調整。」
   ⇒ **改這一個常數就換行為**（true＝拖曳時出現／false＝只看 ▦）。判斷式在 render() 裡只有一處。
   📌 A 類保守解（標紅）：目前是【所有】房間名一起出現（照她的字面）。
      之後可能要調的兩個旋鈕（🛑 本批不做，只記在這裡，讓下一個人知道往哪裡調）：
        ① 只顯示【落點那一間】的名字 —— render() 裡已經有 predRoom（預判落點）可以直接用，
           條件改成 `showRoomName || (拖曳中 && r.id===predRoom)` 即可；畫面會比較乾淨。
        ② 名字畫在手指碰不到的地方 —— Ali 自己提到「手指頭可能會把房間名稱給遮住」；
           可從 S.dragging.gx/gy 的螢幕座標反推，把名字往上偏移一個手指的高度。 ╚═══╝ */
const ROOM_NAME_ON_DRAG = true;
