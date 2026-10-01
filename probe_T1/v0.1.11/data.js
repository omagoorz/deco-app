"use strict";

/* ══════════════════════════════════════════════════════════════
   需求 2｜本機持久化（IndexedDB）
   🔴 DB_VER 升到 2：加 rooms / walls / beams / items 四個 store。
   🔴 R-6：onblocked 沒掛 → Promise 永不 resolve 也永不 reject → 畫面停在「讀取中…」
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.13_i 修三：DB_VER 2 → 3（新增 projects store，keyPath 用 code）。
   ⚠️ 升級後第一次打開若另一個分頁還開著舊版本 ⇒ onblocked 會說話（只發生一次）。 */
/* 🔴 v0.22_i §0c R-45（主代理裁定甲）：deco_probe【維持 DB_VER 3，一行不升】。
   理由：v0.1.8.1 開一個版本比現存低的 IndexedDB 會丟 VersionError ⇒ 開過 v0.1.9 的手機就回不去。
   相簿的兩個新 store 放【另一個資料庫】ALBUM_DB_NAME（見下方 openAlbumDB）；
   photos store 的新欄位（origPath／origStatus／albumVer…）不需要升版（IndexedDB 不管欄位）。
   🔴 名稱一律帶 ENV_PREFIX（正式版＝'' ⇒ 仍是 'deco_probe'）。 */
const DB_NAME=ENV_PREFIX+'deco_probe', DB_VER=3;
let _db=null;
function openDB(){
  return new Promise((res,rej)=>{
    if(_db) return res(_db);
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{const d=e.target.result;
      ['photos','markers','rooms','walls','beams','items'].forEach(st=>{
        if(!d.objectStoreNames.contains(st)) d.createObjectStore(st,{keyPath:'id'});
      });
      /* 🔴 v0.13_i 修三：projects 的 keyPath 是 code（它沒有 id，也沒有 deleted_at
         ⇒ 不可以套 stampObj／softDelete，走一條專屬的小函式）。 */
      if(!d.objectStoreNames.contains('projects'))
        d.createObjectStore('projects',{keyPath:'code'});
    };
    r.onsuccess=e=>{
      _db=e.target.result;
      /* 另一個分頁要升級時，這一邊要主動讓位，否則那一邊會被 blocked 卡住 */
      _db.onversionchange=()=>{ try{_db.close();}catch(err){} _db=null;
        showDbNotice('資料庫版本被另一個分頁更新了。請重新載入這一頁。'); };
      res(_db);
    };
    r.onerror=e=>rej(e.target.error);
    /* 🔴 這一條不做會【靜默卡死】：另一個分頁還開著舊版本 ⇒ 升級被擋 */
    r.onblocked=()=>rej(new Error(
      '另一個分頁還開著舊版本，資料庫升級被擋住。請把其他分頁關掉再重新載入。'));
  });
}
function showDbNotice(msg){
  S.dataErr=msg;
  try{ render(); }catch(e){}
  /* 🔴 v0.1.9 R-50（🟡-11）：pstat 搬走了 ⇒ 資料庫錯誤改畫在相簿清單頁最上面 */
  S.dbNote=msg;
  try{ renderAlbums(); }catch(e){}
}
/* ╔═ 🔴 v0.22_i §0c R-45｜相簿的資料庫（另一個 IndexedDB）════════════════════════════╗
   兩個 store：albums（相簿）、album_photos（相簿裡的一張；名字／備註／排序各本一份）。
   「照片本身」仍在 deco_probe 的 photos（R-01）。
   ⚠️ 兩個資料庫之間【沒有交易】：一次寫相簿＋照片是兩個請求。寫的順序由呼叫端決定
      （搬家：先相簿 → 再 album_photo → 最後才在照片上蓋 albumVer，中途斷了下次會接著做）。
   onblocked／onversionchange 與 deco_probe 同一套說法（這一個資料庫之後升版時才會用到）。 ╚═╝ */
const ALBUM_DB_NAME=ENV_PREFIX+'deco_album', ALBUM_DB_VER=1;
const ALBUM_STORES=['albums','album_photos'];
let _adb=null;
function openAlbumDB(){
  return new Promise((res,rej)=>{
    if(_adb) return res(_adb);
    const r=indexedDB.open(ALBUM_DB_NAME,ALBUM_DB_VER);
    r.onupgradeneeded=e=>{const d=e.target.result;
      ALBUM_STORES.forEach(st=>{
        if(!d.objectStoreNames.contains(st)) d.createObjectStore(st,{keyPath:'id'});
      });
    };
    r.onsuccess=e=>{
      _adb=e.target.result;
      _adb.onversionchange=()=>{ try{_adb.close();}catch(err){} _adb=null;
        showDbNotice('相簿資料庫版本被另一個分頁更新了。請重新載入這一頁。'); };
      res(_adb);
    };
    r.onerror=e=>rej(e.target.error);
    r.onblocked=()=>rej(new Error(
      '另一個分頁還開著舊版本，相簿資料庫升級被擋住。請把其他分頁關掉再重新載入。'));
  });
}
/* 🔴 tx() 依 store 名稱選資料庫 ⇒ lPut／lGet／lAll／lDel／lPutObj…所有既有低階函式【一行不改】就能用在新 store。 */
function tx(store,mode,fn){
  const open = ALBUM_STORES.includes(store) ? openAlbumDB() : openDB();
  return open.then(d=>new Promise((res,rej)=>{
    const t=d.transaction(store,mode), s=t.objectStore(store);
    const req=fn(s);
    t.oncomplete=()=>res(req&&req.result);
    t.onerror=()=>rej(t.error);
  }));
}
/* ⚠️ id 必須是【合法 UUID】——雲端的 id 是 uuid 型別，非 UUID 會被拒，
   而錯誤訊息看不出是 id 的問題（研究員 R-5）。🔴 種子資料也一律走這裡。 */
function uid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));
  b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/* ── 本機（IndexedDB）低階：只在資料層內部使用，畫面層不呼叫 ── */
async function lPut(st,rec){ rec.id=rec.id||uid(); await tx(st,'readwrite',s=>s.put(rec)); return rec.id; }
async function lGet(st,id){ return tx(st,'readonly',s=>s.get(id)); }
async function lAll(st){ return tx(st,'readonly',s=>s.getAll()); }
async function lDel(st,id){ return tx(st,'readwrite',s=>s.delete(id)); }

/* ══════════════════════════════════════════════════════════════
   需求 4｜單位換算（_d §3-6b）
     資料庫（IndexedDB ＋ 雲端）→ 公釐、整數
     記憶體與幾何運算            → 公分、浮點
     換算【只發生在資料層邊界】
   🔴 含 anchor 內的 along / off / x / y —— 唯一一個「嵌在 JSON 裡的長度」，最容易漏。
   ══════════════════════════════════════════════════════════════ */
const toMM   = v => (v==null || v==='') ? null : Math.round(Number(v)*10);
const fromMM = v => (v==null) ? null : Number(v)/10;

/* 要換算的長度欄位（逐一列出，不可漏）。
   ❌ 不換算：rot（度）、price（元）、color、name、note、所有布林、所有時間 */
const LEN_FIELDS = {
  rooms:['slabH'],
  walls:['x1','y1','x2','y2','thickness','height'],
  beams:['x1','y1','x2','y2','width','drop'],
  /* 🔴 需求 46：zBase（離地高度）＝ 六處換算的第六處。記憶體欄位名沿用 slabH 的 camelCase。 */
  items:['w','d','h','zBase'],
  /* 🔴 v0.13_i 修三：第五處。floorH 記憶體是公分、雲端 floor_h 是公釐。 */
  projects:['floorH'],
  /* 🔴 v0.22_i R-11：第七處。相簿定位點 locX／locY：記憶體【公分浮點】、IndexedDB 與雲端【公釐整數】。
     ⚠️ 搬家時 markers 的 x／y（公分 double、不經換算）直接指定給 locX／locY（記憶體單位相同），
        「×10」由這裡的 toDb 做 —— 🛑 搬家那一段【不可以】自己再乘 10（會變成 100 倍）。 */
  albums:['locX','locY']
  /* album_photos：沒有長度欄位（sort 是排序值，不是長度） */
};
function anchorToMM(a){
  if(!a) return null;
  /* 🔴 v0.13_i 修四 4-a：這兩個函式不是 Object.assign，是【重建物件】
     ⇒ 沒有列出來的欄位會被安靜吃掉（side 存進記憶體 → 第一次 saveItem → 欄位消失）。
     🔴 side 不是長度，【不可以乘 10】。 */
  if(a.type==='wall') return {type:'wall', wall:a.wall,
    along:toMM(a.along), off:toMM(a.off||0), side:(a.side ?? null)};
  return {type:'free', x:toMM(a.x), y:toMM(a.y)};
}
function anchorFromMM(a){
  if(!a) return {type:'free', x:0, y:0};
  if(a.type==='wall') return {type:'wall', wall:a.wall,
    along:fromMM(a.along)||0, off:fromMM(a.off)||0, side:(a.side ?? null)};
  return {type:'free', x:fromMM(a.x)||0, y:fromMM(a.y)||0};
}
/* 記憶體物件（公分） → IndexedDB 紀錄（公釐整數） */
function toDb(store,obj){
  const o=Object.assign({},obj);
  (LEN_FIELDS[store]||[]).forEach(k=>{ o[k]=toMM(obj[k]); });
  if(store==='items') o.anchor=anchorToMM(obj.anchor);
  /* 🔴 六處換算之三（v0.13_i 修五）：LEN_FIELDS 是【逐欄位純量】換算，吃不下陣列
     ⇒ poly 必須比照 anchorToMM 另外寫一對。 */
  if(store==='rooms') o.poly=polyToMM(obj.poly);
  return o;
}
/* IndexedDB 紀錄（公釐整數） → 記憶體物件（公分浮點） */
function fromDb(store,rec){
  const o=Object.assign({},rec);
  (LEN_FIELDS[store]||[]).forEach(k=>{ o[k]=fromMM(rec[k]); });
  if(store==='items') o.anchor=anchorFromMM(rec.anchor);
  /* 🔴 六處換算之四 —— v0.13_i 修五明寫這是【最容易漏的一格】。
     漏了它，cloudJoin 的認領迴圈（lAllObj → lPutObj 原地來回）每跑一次就差 10 倍。 */
  if(store==='rooms') o.poly=polyFromMM(rec.poly);
  return o;
}
/* 🔴 需求 4｜時區：一律存 ISO（UTC），顯示時才轉本地。
   現況 W1（寫 '2026-09-08 10:30' 無時區）／W2（把 UTC 當本地印）各偏 8 小時。 */
const nowISO = ()=> new Date().toISOString();
function fmtLocal(iso){
  if(!iso) return '';
  const s=String(iso);
  /* ⚠️ 舊紀錄的 addedAt 是無時區字串 → new Date() 會得到 Invalid Date。
     邊界處理：沒有 T 也沒有 Z → 原樣輸出（那是舊紀錄，isLegacy() 已經會標它）。 */
  if(s.indexOf('T')<0 && s.indexOf('Z')<0) return s;
  const d=new Date(s);
  if(isNaN(d.getTime())) return s;
  const z=x=>String(x).padStart(2,'0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} `+
         `${z(d.getHours())}:${z(d.getMinutes())}`;
}

/* ── 物件資料層（與照片線同構）──
   🔴 save* 與 savePhoto() 同一個模式：① 寫本機 ② 標 pending ③ 背景推雲端（失敗不擋畫面）
   🔴 delete* 【不是】。delete* 一律走軟刪除（需求 5 / 6 / 7），
      不可抄照片線的 lDel()。（v0.04_i §6；🗂 v0.1.9 起照片線也不物理刪除了，舊的 deletePhoto 已拿掉） */
async function lAllObj(st){ return (await lAll(st)).map(r=>fromDb(st,r)); }
async function lAllLive(st){ return (await lAllObj(st)).filter(x=>!x.deletedAt); }
async function lGetObj(st,id){ const r=await lGet(st,id); return r? fromDb(st,r) : null; }
async function lPutObj(st,obj){ return lPut(st, toDb(st,obj)); }

function stampObj(o){
  o.id = o.id || uid();
  /* 🔴 需求 36（obs O-19）：只有【還沒歸屬】的才蓋章。
     「認領」只能由 cloudJoin 明確做，不可以靠「順便存檔」偷偷改變一筆資料屬於誰。
     ⚠️ 判斷用 == null（同時涵蓋 null 與 undefined）；不可用 !o.projectCode，
        空字串也會被當成「沒歸屬」而被蓋掉。 */
  if(o.projectCode == null) o.projectCode = CLOUD.code || null;
  o.updatedAt   = nowISO();
  o.appVer      = APP_VER;
  if(o.deletedAt===undefined) o.deletedAt=null;
  /* 🔴 v0.05_i §3（修三）：createdAt 只在【新建】時寫入（見 newObj()），
     這裡【一個字都不准動它】——之後任何更新、pull 覆蓋都要保留。
     🔴 也【不准】在這裡幫舊資料補一個假的 createdAt（obs O-13：偽裝成有資料）。 */
  /* ⚠️ 與 savePhoto 的一點差異（刻意）：物件【會被反覆修改】，
     每次存都要重新標 pending，否則改過的值永遠推不上去（N-59）。 */
  if(CLOUD.code){ o.pending=true; o.synced=false; }
  return o;
}
/* 🔴 v0.05_i §3（修三）：唯一可以寫 createdAt 的地方。
   四種物件（Room/Wall/Beam/Item）新建時都要經過這裡。
   ⚠️ 只有「這一筆真的是現在被造出來的」才准蓋這個章——
      從雲端 pull 回來的那條路不走這裡（它帶著雲端的 created_at，見 fromRow）。 */
function newObj(o){
  o.id = o.id || uid();
  o.createdAt = nowISO();
  return o;
}
async function saveRoom(r){ stampObj(r); await lPutObj('rooms',r);
  if(CLOUD.on) cloudPushObj('rooms',r.id).catch(e=>cloudErr(e)); return r.id; }
async function saveWall(w){ stampObj(w); await lPutObj('walls',w);
  if(CLOUD.on) cloudPushObj('walls',w.id).catch(e=>cloudErr(e)); return w.id; }
async function saveBeam(b){ stampObj(b); await lPutObj('beams',b);
  if(CLOUD.on) cloudPushObj('beams',b.id).catch(e=>cloudErr(e)); return b.id; }
async function saveItem(i){ stampObj(i); await lPutObj('items',i);
  if(CLOUD.on) cloudPushObj('items',i.id).catch(e=>cloudErr(e)); return i.id; }

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9｜相簿資料層（_i v0.22 §1、§0b R-04／R-05／R-10／R-11、§0c）
   三層：相簿 album ─ 相簿裡的一張 album_photo（名字／備註／排序，各本一份）─ 照片本身 photo（deco_probe.photos）
   · albums、album_photos 走【物件那一套】：stampObj（歸屬只蓋沒歸屬的、updatedAt、pending）＋ lPutObj（toDb 換算）
   · 三態刪除（R-05）：deletedAt（垃圾桶）／purgedAt（永久刪除，墓碑）／restoredAt（還原表態）＋ batchId
     🔴 照片本身【不加】deletedAt／batchId：「照片在不在垃圾桶」＝它所有 album_photo 是否都在垃圾桶（推算，O-40）
   · 「最近變動時間」不存（R-16）：推算＝max(相簿 updatedAt, 其 album_photo 的 updatedAt)
   ══════════════════════════════════════════════════════════════ */
let ALBUMS  = [];      // 活的相簿（不含垃圾桶與墓碑）
let APHOTOS = [];      // 活的 album_photo（不含垃圾桶與墓碑）
/* 🔴 兩張新表的雲端推送開關。批 2 時是 false（雲端還沒有這兩張表）；
   Ali 2026-09-30 貼完 v0.1.9 SQL、批 3 接上 push／pull ⇒ 打開。 */
const ALBUM_CLOUD = true;
/* 🔴 v0.1.10 P1（§0d #5）：opt.noPush＝只寫本機、先不推（uploadFiles 要「三筆都寫進本機才推」）。 */
async function saveAlbum(a, opt){ stampObj(a); await lPutObj('albums',a);
  if(CLOUD.on && ALBUM_CLOUD && !(opt && opt.noPush)) cloudPushObj('albums',a.id).catch(e=>cloudErr(e)); return a.id; }
async function saveAlbumPhoto(ap, opt){ stampObj(ap); await lPutObj('album_photos',ap);
  if(CLOUD.on && ALBUM_CLOUD && !(opt && opt.noPush)) cloudPushObj('album_photos',ap.id).catch(e=>cloudErr(e)); return ap.id; }
/* 最近變動時間（R-16，推算、不存）。ap 含垃圾桶裡的（「從這本拿掉」也算這本有變動）。 */
async function albumRecency(){
  const m=new Map();
  for(const a of await lAllObj('albums')) m.set(a.id, String(a.updatedAt||''));
  for(const ap of await lAllObj('album_photos')){
    const t=String(ap.updatedAt||'');
    if(m.has(ap.albumId) && t > m.get(ap.albumId)) m.set(ap.albumId, t);
  }
  return m;
}

/* ╔═ 🔴 v0.22_i §0b R-10｜推算 id：UUIDv5（RFC 4122 §4.3，SHA-1）═══════════════════════╗
   兩台同時搬家、或搬到一半斷掉重來，都會推出【同一個】相簿 id 與 album_photo id
   ⇒ 只會寫到同一列，不會變兩本（相-03 的反面）。
   🔴 命名空間常數【寫死、永不改】：改了等於換一套 id，已搬過的會再搬一次。
   🔴 結果一定是合法 UUID（雲端 id 是 uuid 型別，3355 註解）。
   ⚠️ crypto.subtle 只在安全來源可用（https／localhost）；GitHub Pages 是 https。
      不可用時丟一個講得出原因的錯（不安靜）。 ╚═══════════════════════════════════════╝ */
const ALBUM_ID_NS = '6f1b3c2e-8d4a-4e7b-9c15-2a7e0d9b4f63';
function _uuidBytes(u){ const h=String(u).replace(/-/g,''); const b=new Uint8Array(16);
  for(let i=0;i<16;i++) b[i]=parseInt(h.substr(i*2,2),16); return b; }
function _uuidStr(b){ const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
async function uuidv5(name, ns){
  if(!(window.crypto && crypto.subtle && crypto.subtle.digest))
    throw new Error('這個瀏覽器環境不能計算相簿編號（需要安全連線 https），舊照片沒有整理成相簿。');
  const nsb=_uuidBytes(ns||ALBUM_ID_NS), nb=new TextEncoder().encode(String(name));
  const buf=new Uint8Array(nsb.length+nb.length); buf.set(nsb,0); buf.set(nb,nsb.length);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  const b=hash.slice(0,16);
  b[6]=(b[6]&0x0f)|0x50;          // version 5
  b[8]=(b[8]&0x3f)|0x80;          // variant RFC 4122
  return _uuidStr(b);
}
const albumIdOf      = photoId => uuidv5('album:'+photoId);
const albumPhotoIdOf = photoId => uuidv5('ap:'+photoId);

/* ╔═ 🔴 v0.22_i §0b-5 F-1 ＋ §0c R-50（🟡-5）｜舊照片的名字「像不像檔名」═══════════════╗
   Ali 09-29 同意：改過名的沿用；檔名樣子的 ⇒ 相簿名改成「新相簿(N)」。
   判定（寫死，不要各猜）：空字串、'(無檔名)'（intake 5148 的預設值）、或以圖片副檔名結尾。
   （改過名的照片不會帶副檔名 —— 改名框不預填副檔名以外的東西，她打的是字。）
   ⚠️ 只決定【相簿名】；那一筆 album_photo 的名字一律照搬照片原名（§2 第一點）。 ╚═══════╝ */
const FILE_NAME_RE = /\.(jpe?g|png|heic|heif|webp|gif)$/i;
function looksLikeFileName(n){
  const s=String(n==null?'':n).trim();
  return s==='' || s==='(無檔名)' || FILE_NAME_RE.test(s);
}
/* 「新相簿(N)」：N ＝ 目前最大號＋1，🔴 數【全部】相簿（含垃圾桶與墓碑）⇒ 還原後不撞名（R-50 🟡-3）。 */
const NEW_ALBUM_RE = /^新相簿\((\d+)\)$/;
function maxNewAlbumNo(all){
  let n=0; for(const a of all){ const m=NEW_ALBUM_RE.exec(String(a.name||'')); if(m) n=Math.max(n, +m[1]); }
  return n;
}

/* ╔═ 🔴🔴 v0.22_i §2 ＋ §0b R-10 ＋ §0c（🔴-6、🟠-1、🟠-2）｜搬家：舊照片 ⇒ 一本相簿一張 ══════╗
   掛點：loadAll（開 App；未連線與已連線都經過，pull 之後）＋ 批 3 起 cloudPull 結尾（手動同步）。
   【可重複執行】是唯一的保護（舊版 v0.1.8.1 不讀版本號、搬完之後還可能再新增照片，相-03）：
     判準　照片 projectCode === 目前專案（未連線＝null）      ← 🟠-1：別的專案的孤兒不碰
           且 albumVer 為空（0＝已由舊版搬來、1＝v0.1.9 上傳）← 🟠-2：主判準
           且 本機沒有任何 album_photo（含垃圾桶）指向它    ← 輔助：搬到一半斷掉的那一張
     🔴 直接讀 IndexedDB（lAll），【不讀 MARKERS 變數】—— 開 App 時 loadMarkers 在 pull 之前（A-13）
   每一張做三件，順序寫死（斷在任何一步，下次都接得上，而且推出同一組 id）：
     ① 相簿（id＝UUIDv5('album:'+photoId)）：名字＝照片原名，像檔名 ⇒ 新相簿(N)；
        定位點＝那張照片最新的 marker（x／y 公分 ⇒ locX／locY，×10 由 toDb 做），沒有 ⇒ 未定位
     ② album_photo（id＝UUIDv5('ap:'+photoId)）：名字＝照片原名、備註空、sort＝1
     ③ 照片蓋 albumVer＝0（savePhoto：本機存、標 pending）
   🛑 不碰：orig_status（null＝舊照片、從來沒有原檔；不寫 'none'）、shot_at（讀時推算）、
          photos.name（凍結，舊版在讀）、markers（只讀不寫不刪，保留當備份）。 ╚═══════════════╝ */
S.migrate = null;                        // {done, total}：畫面顯示「正在整理舊照片（N / M）」
let _migrating = false;
async function migrateOldPhotos(){
  if(_migrating) return 0;
  _migrating = true;
  let made = 0;
  try{
    const scope   = CLOUD.code || null;
    const photos  = await lAll('photos');
    const aps     = await lAllObj('album_photos');
    const albums  = await lAllObj('albums');
    const markers = await lAll('markers');
    const hasAp   = new Set(aps.map(x=>x.photoId));
    const apIds   = new Set(aps.map(x=>x.id));
    const inScope = photos.filter(p => (p.projectCode ?? null) === scope && p.albumVer == null);
    /* 🔴 自驗抓到的缺口：斷在 ② 之後（album_photo 寫了、照片還沒蓋章）⇒ 下次因為「已有 album_photo」被跳過，
       而 albumVer 永遠是空的（🟠-2 那道保護就少了這一張）。
       ⇒ 若它的 album_photo 正是搬家推算出來的那一個 id，只補蓋章（不重建任何東西）。 */
    for(const p of inScope){
      if(!hasAp.has(p.id)) continue;
      if(apIds.has(await albumPhotoIdOf(p.id))){ p.albumVer = 0; await savePhoto(p); }
    }
    const todo = inScope.filter(p => !hasAp.has(p.id));
    if(!todo.length) return 0;
    /* 名次要穩定：依加入時間、再依 id ⇒ 同一批舊照片在任何一台排出同樣的「新相簿(N)」順序 */
    todo.sort((a,b)=>String(a.addedAt||'').localeCompare(String(b.addedAt||''))
                   || String(a.id).localeCompare(String(b.id)));
    let nextNo = maxNewAlbumNo(albums);
    const albumById = new Map(albums.map(a=>[a.id,a]));
    S.migrate = {done:0, total:todo.length}; onMigrateProgress();
    for(const p of todo){
      const aid  = await albumIdOf(p.id);
      const apid = await albumPhotoIdOf(p.id);
      /* ① 相簿（搬到一半斷掉時可能已經有了 ⇒ 沿用，不改它的名字與位置） */
      if(!albumById.has(aid)){
        /* 同一張照片可能有多個 marker（兩台各標過）⇒ 取 updatedAt 最新；一樣新就取 id 大的（穩定） */
        const mk = markers.filter(m=>m.photoId===p.id)
          .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))
                    || String(b.id).localeCompare(String(a.id)))[0];
        const name = looksLikeFileName(p.name) ? `新相簿(${++nextNo})` : String(p.name).trim();
        const a = newObj({ id:aid, name,
          locX: (mk && isFinite(mk.x)) ? Number(mk.x) : null,     // 🔴 公分；×10 在 toDb
          locY: (mk && isFinite(mk.y)) ? Number(mk.y) : null,
          projectCode: p.projectCode ?? null,                     // 🔴 歸屬跟著照片（不靠 stampObj 補）
          deletedAt:null, batchId:null, restoredAt:null, purgedAt:null });
        await saveAlbum(a);
        albumById.set(aid, a);
      }
      /* ② album_photo */
      const ap = newObj({ id:apid, albumId:aid, photoId:p.id,
        name: p.name==null ? '' : String(p.name), note:'', sort:1,
        projectCode: p.projectCode ?? null,
        deletedAt:null, batchId:null, restoredAt:null, purgedAt:null });
      await saveAlbumPhoto(ap);
      /* ③ 最後才蓋章（前兩步沒成功，下次會再來一次） */
      p.albumVer = 0;
      await savePhoto(p);
      made++;
      S.migrate.done++; onMigrateProgress();
    }
  }catch(e){
    /* _i §2 🔍：搬家失敗沿用同步錯誤的顯示（cloudErr）；已搬完的那幾張不會重來（有 albumVer） */
    cloudErr(new Error('整理舊照片時失敗（已整理的不受影響，下次開啟會接著做）：'+((e&&e.message)||e)));
  }finally{
    _migrating = false;
    S.migrate = null; onMigrateProgress();
  }
  return made;
}
/* 搬家進度：畫在相簿清單頁最上面（albNotes 裡的 #albMig）。 */
function onMigrateProgress(){
  const b=$('albMig'); if(!b) return;           // 🔴 v0.1.9 批 5：畫在相簿清單頁最上面（albNotes）
  b.hidden=!S.migrate;
  b.textContent = S.migrate ? `正在整理舊照片（${S.migrate.done} / ${S.migrate.total}）` : '';
}

/* ══════════════════════════════════════════════════════════════
   🔴 v0.12_i 需求 44 ＋ v0.13_i 修三｜projects 的資料層（專屬小函式）
   ⚠️ projects 沒有 id、沒有 deleted_at、沒有 pending/synced
      ⇒ 【不要】套 stampObj／softDelete／cloudPushObj，那三個都假設有 id 與墓碑。
   🔴 本批明確【不含】pull —— cloudPullObjects 的 store 清單一個字不改。
      ⇒ 代價：兩台之間樓高與專案名字不會自動同步。這是刻意的取捨（形狀套不進既有迴圈），
        已列進交付必講清單 ⑧。
   ══════════════════════════════════════════════════════════════ */
/* 未連線時也要存得住 ⇒ 用一個不會與任何真實代碼衝突的本機鍵。
   ⚠️ A 類歧義：_i 沒有寫「還沒連線時這一列的 key 是什麼」，這裡取保守解（只存這台）。 */
const LOCAL_PROJ_KEY='_local';
const projKey = ()=> CLOUD.code || LOCAL_PROJ_KEY;
async function lGetProject(code){
  const rec=await tx('projects','readonly',s=>s.get(code));
  return rec ? fromDb('projects',rec) : null;
}
async function lPutProject(p){
  await tx('projects','readwrite',s=>s.put(toDb('projects',p)));
}
/* 雲端那一列（只有一列，key 是 code）。pull 與 push 的守衛都要讀它。 */
async function cloudFetchProjectRow(){
  const r=await sbFetch('/rest/v1/projects?select=*&code=eq.'+encodeURIComponent(CLOUD.code));
  if(!r.ok) throw new Error('讀雲端 projects 失敗：'+(await r.text()).slice(0,200));
  const rows=await r.json();
  return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
}
/* ╔═ 🔴 v0.17_i 修八 ②③｜送出前先【真的比對】，而且 null 不送 ════════════════════╗
   舊版：整列 upsert，updated_at 只是【寫進去】，從來沒有拿來比對
   ⇒ 手機沒有樓高 → 在手機只改專案名字 → 整列推上去、floor_h 寫成 null
     → 把電腦填的樓高蓋掉，而畫面同時顯示「✅ 已存」。
   🔴 ③ floor_h 為 null 時【不要送這個欄位】——與 v0.13_i 修二的 poly 是同一個形狀
      （polyToMM(undefined) 回 null ⇒ 把雲端洗掉）。同一個坑，不要再踩第二次。 ╚═══════╝ */
async function cloudPushProject(){
  if(!CLOUD.on || !CLOUD.code) return;
  const cloudRow = await cloudFetchProjectRow();
  const mine   = PROJECT.updatedAt ? new Date(PROJECT.updatedAt).getTime() : NaN;
  const theirs = (cloudRow && cloudRow.updated_at) ? new Date(cloudRow.updated_at).getTime() : NaN;
  /* ╔═ 🔴 v0.20_i §4-1a ③｜樓高有【自己的時間戳】，與整列的 updated_at 分開比 ═══════╗
     🔴🔴 **方向一寫反就是「資料被刪、而畫面說『✅ 一致』」**（本批最危險的位置之一）：
        曾經寫成　`!isFinite(hTheirs) || (isFinite(hMine) && hMine > hTheirs)`
        ⚠️ 貼完 SQL 的當下，雲端 floor_h_updated_at 對【所有既有專案】都是 NULL
           ⇒ `!isFinite(hTheirs)` 恆成立 ⇒ pushH 恆為 true ⇒ **兩台都推、誰後同步誰贏**
           ⇒ 🔴 B 從來沒動過樓高，也會送 `floor_h:null` **蓋掉 A 的 280**
           ⇒ N-534 必敗，而且它與 §4-1b「沒時間戳＝當成最舊」**直接打架**
             （pull 側做對了，push 側做反了）。
     ✅ 正解一句話：**這台自己沒有動過樓高，就永遠不推。** ╚═══════════════════════════╝ */
  const hMine   = PROJECT.floorHUpdatedAt ? new Date(PROJECT.floorHUpdatedAt).getTime() : NaN;
  const hTheirs = (cloudRow && cloudRow.floor_h_updated_at)
                    ? new Date(cloudRow.floor_h_updated_at).getTime() : NaN;
  const pushH = isFinite(hMine) && (!isFinite(hTheirs) || hMine > hTheirs);
  /* ╔═ 🔴🔴 外層那個守衛原本是 `return`，不是「跳過 name」（前刀 A-11）═══════════════╗
     情境：A 改了名字（雲端 updated_at 變新）→ B 先前清掉樓高但還沒推
     ⇒ B 的 `mine <= theirs` 成立 ⇒ **整支函式 return**
     ⇒ **樓高的清空永遠推不上去**，而畫面說「✅ 已存」。
     ✅ 改成旗標，不要 return —— 名字與樓高各自決定要不要送。
     🔑 這裡正好用得上 §4-2a 查證過的 PostgREST 事實：**payload 沒帶的欄位不會被動**
        ⇒「只送要改的那幾欄」是安全的。 ╚════════════════════════════════════════════╝ */
  const pushRow = !(cloudRow && isFinite(mine) && isFinite(theirs) && mine <= theirs);
  const row = { code: CLOUD.code };
  if(pushRow){
    row.name = PROJECT.name||null;
    row.updated_at = PROJECT.updatedAt || nowISO();
  }
  if(pushH){
    /* 🔴 含 null —— 「她把樓高清掉了」這件事**必須傳播**（§4-1c ②）。
       ⚠️ 這與 v0.17_i 修八「null 不送」相反，是【刻意的行為改變】，已列進交付必講 ⑨。
          之所以現在敢送 null，是因為有了 floor_h_updated_at 能分辨
          「她清掉了」與「這台根本沒填過」—— 修八當時沒有這個分辨能力。 */
    row.floor_h = PROJECT.floorH == null ? null : toMM(PROJECT.floorH);
    row.floor_h_updated_at = PROJECT.floorHUpdatedAt;
  }
  if(Object.keys(row).length === 1) return;   // 🔴 只剩 code ⇒ 沒事要送
  const r=await sbFetch('/rest/v1/projects?on_conflict=code',{method:'POST',
    headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
    body:JSON.stringify(row)});
  if(!r.ok) throw new Error('寫入雲端 projects 失敗：'+(await r.text()).slice(0,200));
}
/* ╔═ 🔴 v0.17_i 修八 ① ＋ §0-6 A-1｜projects 走【自己的一支】，不進 cloudPullObjects ══╗
   🔴 為什麼不可以加進那個迴圈（前刀查碼、冷讀刀複驗）：
     · fromRow 的結構是 rooms→walls→beams→【否則落到 items】（最後一個 return 沒有守衛）
       ⇒ 傳 'projects' 進去，回來的是一個 items 形狀的物件，floor_h 沒有人讀
     · lmap = new Map(local.map(x=>[x.id,x]))，而 projects 的 keyPath 是 code、每一列沒有 id
       ⇒ 全部 key 是 undefined ⇒ 互相蓋掉
     · lPutObj → lPut 第一行 rec.id = rec.id || uid() ⇒ 往 keyPath='code' 的 store
       塞一個只有 id 沒有 code 的物件
   ⇒ 症狀：按〔🔄 同步〕沒有任何錯誤訊息，專案那一列被寫成垃圾
     ⇒ 下一次 loadProject() 讀回來 floorH 是 null ⇒ 設定頁變「（未填）」，
       而畫面同時顯示「✅ 同步完成　雲端與這台一致」
     ＝ **修八自己要修的那個症狀，被修八本身重新造出來一次**（O-20）。
   🔴 所以這一支：自己打 API、自己做欄位對應、不走 fromRow、不用 lPutObj／stampObj／softDelete。╚═╝ */
async function cloudPullProject(){
  if(!CLOUD.on || !CLOUD.code) return;
  syncStep('專案設定…');
  const row=await cloudFetchProjectRow();
  if(!row) return;                                  // 雲端還沒有這一列 ⇒ 沒事可拉
  const local=await lGetProject(CLOUD.code);
  const theirs = row.updated_at ? new Date(row.updated_at).getTime() : NaN;
  const mine   = (local && local.updatedAt) ? new Date(local.updatedAt).getTime() : NaN;
  /* ╔═ 🔴 v0.20_i §4-1a ④｜先算【樓高那一組】，再算【整列那一組】═════════════════╗
     舊版是整列比一次 updated_at，theirs <= mine 就整支 return
     ⇒ 樓高沒有自己的發言權，只能跟著名字的時間戳走。
     ✅ 拆成兩組之後，「只改名字」與「清掉樓高」才不會互相綁架。
     🔴 §4-1b 邊界：雲端沒有 floor_h_updated_at ⇒ **當成最舊，不覆蓋**
        （沿用碼 3587「雲端沒時間戳 → 當最舊」的既有規則，🔴 不新發明；
          而且這正是 push 側 pushH 的鏡像 —— 兩邊必須同向，否則就是 N-534 那個坑）。
     🛑 **不要**幫舊資料補一個假的 floor_h_updated_at（obs O-13）。 ╚═══════════════╝ */
  const hTheirs = row.floor_h_updated_at ? new Date(row.floor_h_updated_at).getTime() : NaN;
  const hMine   = (local && local.floorHUpdatedAt) ? new Date(local.floorHUpdatedAt).getTime() : NaN;
  const takeH   = isFinite(hTheirs) && (!isFinite(hMine) || hTheirs > hMine);
  const takeRow = !(isFinite(mine) && isFinite(theirs) && theirs <= mine);  // 名字：整列級（沿用現況）
  if(!takeH && !takeRow) return;
  const merged={
    code: CLOUD.code,
    name: takeRow ? (row.name==null ? (local? local.name : '') : row.name)
                  : (local? local.name : ''),
    /* 🔴 takeH 為 true 時，**row.floor_h 是 null 也要收** ——
       那就是「她在另一台把樓高清掉了」，必須傳播（§4-1c ②）。
       ⚠️ 這與舊版「雲端 null 就不收」相反，而之所以現在敢收，
          是因為 takeH 已經先用時間戳確認過「那個 null 是有人主動清的」。 */
    floorH: takeH ? (row.floor_h==null ? null : fromMM(row.floor_h))
                  : (local ? local.floorH : null),
    floorHUpdatedAt: takeH ? row.floor_h_updated_at : (local ? local.floorHUpdatedAt : null),
    updatedAt: takeRow ? (row.updated_at || nowISO()) : (local ? local.updatedAt : nowISO())
  };
  await lPutProject(merged);
  PROJECT = merged;                                 // 記憶體也要跟上（O-24：兩層都要看）
}
async function loadProject(){
  try{
    const p=await lGetProject(projKey());
    /* 🔴 丙-5：這是【重建一個新的物件字面值】，不是 Object.assign
       ⇒ 沒有列出來的欄位會被安靜吃掉。而 loadProject() 被 reloadObjects() 最後一行
         無條件呼叫（boot／每次同步／每次擺上圖／每次刪房間都會跑）
       ⇒ 漏了 updatedAt 的話它永遠是 undefined，A-2 修的那個坑原封不動回來。
       🔴 兩個分支都要有 updatedAt。（同形前例：anchorToMM/anchorFromMM 的註解。） */
    /* 🔴 v0.20_i §4-1a ①：floorHUpdatedAt 是本批新增的欄位，
       而這裡是【重建物件字面值】⇒ **三個分支都要列到它**，漏一個就被安靜吃掉。 */
    PROJECT = p ? {code:p.code, name:p.name||'', floorH:(p.floorH==null?null:p.floorH),
                   updatedAt:(p.updatedAt||null),
                   floorHUpdatedAt:(p.floorHUpdatedAt||null)}
                : {code:projKey(), name:'', floorH:null, updatedAt:null, floorHUpdatedAt:null};
  }catch(e){ PROJECT={code:projKey(), name:'', floorH:null, updatedAt:null, floorHUpdatedAt:null}; }
}

/* delete*：🔴 軟刪除（進垃圾桶），不是 lDel
   🔴 v0.1.9 R-05：一次刪除＝同一個 batchId（垃圾桶一行）。沒給就自己開一個（單筆刪除＝一行）。 */
async function softDelete(store, arr, id, saver, batchId){
  const o=arr.find(x=>x.id===id) || await lGetObj(store,id);
  if(!o) return;
  o.deletedAt=nowISO();
  o.batchId=batchId||uid();
  await saver(o);
}
async function deleteRoom(id, batchId){ return softDelete('rooms',ROOMS,id,saveRoom,batchId); }
async function deleteWall(id){ return softDelete('walls',WALLS,id,saveWall); }
async function deleteBeam(id){ return softDelete('beams',BEAMS,id,saveBeam); }
async function deleteItem(id){ return softDelete('items',FURN,id,saveItem); }

/* ── 需求 4／15｜啟動時一次載入 ──
   🔴 順序寫死（v0.04_i §1）：
      lAll × 四個 store → pull（若已連線）→ seedIfEmpty → purgeTrash
      ⚠️ pull 失敗（丟錯）→ 【不要】跑 seedIfEmpty，讓使用者看到錯誤訊息。
         理由：pull 失敗時「本機全空」不代表「這個專案是空的」。 */
async function reloadObjects(){
  ROOMS_ALL = await lAllObj('rooms');      // 🔴 含墓碑，給 roomOrder() 用（v0.05_i §3 / N-93）
  ROOMS = await lAllLive('rooms');
  WALLS = await lAllLive('walls');
  BEAMS = await lAllLive('beams');
  FURN  = await lAllLive('items');
  /* 🔴 v0.1.9：相簿兩層也在這裡載入（活的：不含垃圾桶，也不含永久刪除的墓碑）。 */
  ALBUMS  = (await lAllObj('albums')).filter(x=>!x.deletedAt && !x.purgedAt);
  APHOTOS = (await lAllObj('album_photos')).filter(x=>!x.deletedAt && !x.purgedAt);
  PHOTOS  = new Map((await lAll('photos')).map(p=>[p.id,p]));   // 照片本身（相簿畫面與放大畫面讀這裡）
  /* 🔴 需求 41 邊界 ＋ v0.13_i 修七 F-29：poly 少於 3 點或格式壞掉 → 不畫，但【不可靜默】。
     ⚠️ 放在這裡重算（而不是畫的時候寫），是為了讓它跟著資料走、
        而且不會被「同步成功就清空」那條路清掉（那是 S.dataErr 的行為）。
     邊界：poly 為 null ＝ 正常情況（種子／手建的房間），不是錯誤，不報。 */
  const bad=ROOMS.filter(r=>r.poly!=null && !validPoly(r.poly)).map(r=>r.name||'未命名');
  S.geomErr = bad.length
    ? `有 ${bad.length} 間房的分區形狀讀不出來（${bad.slice(0,3).join('、')}${bad.length>3?'…':''}），那幾塊不會畫出來。`
    : '';
  /* 🔴 修九邊界：beamFocus 指到的樑被刪掉 ⇒ 清掉，不炸。 */
  if(S.beamFocus && !BEAMS.some(b=>b.id===S.beamFocus)) S.beamFocus=null;
  await loadProject();
}
async function loadAll(){
  await reloadObjects();
  let pulled=false;
  if(CLOUD.on){
    await cloudPull();            // 丟錯 → 由呼叫端接，且不會走到 seed
    await reloadObjects();
    pulled=true;
  }
  if(!CLOUD.on || pulled) await seedIfEmpty();
  /* 🔴 v0.1.9 §2 搬家（R-10）：連線時已在 cloudPull 結尾跑過（手動同步也經過）；
     這裡只負責【未連線】那條路。可重複執行；失敗只寫 cloudErr、不擋開 App。 */
  if(!CLOUD.on) await migrateOldPhotos();
  await purgeTrash();
  await reloadObjects();
}

/* ══════════════════════════════════════════════════════════════
   需求 5｜種子範例、兩種清空、垃圾桶
   ══════════════════════════════════════════════════════════════ */
const SEED_ROOM_NAME='範例房間（可刪）';
/* 🔴 v0.09_i 需求 28：判準是【有沒有存活的房間】，不是「四種物件全空」。
   ⚠️ 舊判準造出一條【出不去的狀態】（Ali 兩台真機踩到、claude 本機重現）：
        清清單 → 建一筆家具 → 重新載入 → rooms:0, furn:1 ⇒ 種子【不生】
        而 v0.1.4 刻意沒有「新增房間」UI ⇒ 沒有房間、也沒有任何辦法生一個出來
   ⇒ 種子的目的就是「給一個可以放東西的房間」；家具存不存在與這個目的無關，
     卻會把它鎖死 ⇒ 判準只看房間。
   ⚠️ ROOMS 已經是【存活】的（lAllLive 過濾掉 deletedAt）。
   邊界：有房間但沒有牆 → 不生（房間在就不生，牆的有無不是種子的判準）。 */
async function seedIfEmpty(){
  if(ROOMS.length) return;
  const rid=uid();
  const room=newObj({ id:rid, name:SEED_ROOM_NAME, slabH:300, note:'',
    projectCode:CLOUD.code||null, synced:false, pending:false,
    appVer:APP_VER, deletedAt:null });
  await saveRoom(room);
  // 矩形 400×300 公分（＝4000×3000 公釐）、state='proposed'、isBoundary=true、thickness=10cm
  const P=[[0,0],[400,0],[400,300],[0,300]];
  for(let i=0;i<4;i++){
    const a=P[i], b=P[(i+1)%4];
    await saveWall(newObj({ id:uid(), room:rid, x1:a[0],y1:a[1],x2:b[0],y2:b[1],
      /* 🔴 v0.05_i §1（修一）：種子牆是 state:'proposed'，不是 'existing'。
         _d §4-2c：existing ＝ 後台匯入、前台唯讀；種子是【前台自己造的】
         ⇒ 它在定義上就不可能是 existing。
         ⚠️ 寫 'existing' 的後果（建造者實測推出來的）：需求 3 的 insert 政策
            with check (… and state='proposed') 會回 42501 ⇒ 四道牆永遠 pending
            ⇒「有 N 筆未上傳」永遠不歸零。 */
      thickness:10, height:null, isBoundary:true, state:'proposed',
      total:null, note:'', isPlaced:true, isBudgeted:false,
      projectCode:CLOUD.code||null, synced:false, pending:false,
      appVer:APP_VER, deletedAt:null }));
  }
  // 🔴 家具 ×0（零件）。要試就自己建一件——那正是本輪的功能。
  await reloadObjects();
}
/* 種子還沒被動過？（提示句只留到使用者建了第一件東西為止） */
function isSeedPristine(){
  return FURN.length===0 && ROOMS.length===1 && ROOMS[0].name===SEED_ROOM_NAME;
}

/* 甲｜清擺設：什麼都不刪，只把所有 Item 的 isPlaced 設成 false。
   🔴 anchor 保留！只是不擺（它記得上次擺哪，切回來就回原位）。
   ⚠️ 逐筆更新、逐筆標 pending，不做交易（探針階段）。 */
async function clearPlacement(){
  for(const f of FURN.slice()){ f.isPlaced=false; await saveItem(f); }
  await reloadObjects();
}
/* ══ 🔴 v0.12_i 需求 47 ＋ v0.13_i 修六｜清清單不准動【房子本身】══
   判準是「這一筆是不是房子本身（＝匯入來的）」，🔴【不是 state】。
   ⚠️ 用 state 的後果：匯入的 33 道裡有 5 道是 proposed（她 SVG 裡的隔間牆）
      ⇒ 不會被跳過 ⇒ 被軟刪 ⇒ 而 RLS 允許改 proposed ⇒【沒有任何錯誤訊息】
      ⇒ 而舊的 N-198 只檢查「28 道 existing 還在」⇒ 綠燈通過，五分之一的房子已經不見了。
   🔴 這條依賴「poly 有補進本機」（v0.13_i 修二）：若 poly 沒下來，isHouseRoom 全 false
      ⇒ 10 間真實房間會被全部軟刪，而 rooms 的 RLS 不會擋。兩條要一起看。
      ⇒ 防線＝確認框先把「保留 X 間房」講出來（v0.14_i 補七 N-10b，obs O-18 規則①）。 */
/* 牆：匯入的 room_id 一律 NULL。
   ⚠️ v0.14_i 補七 N-10a：加一層便宜保險 `|| state==='existing'`，成本一個 ||，
      同時擋住 D1-8 的原始 42501 路徑（對 existing 牆送 UPDATE 會被 RLS 拒 28 次）。 */
const isHouse     = w => (w && (w.room == null || w.state === 'existing'));
/* 房間：有 poly ＝ 從 SVG 匯入的真實分區，不是她擺的東西。 */
const isHouseRoom = r => (r && validPoly(r.poly));
/* 樑：全部都是匯入的 ⇒ clearAll 一律跳過。 */

/* 乙｜清清單：只清【她擺的東西】；房子（既有牆、樑、有 poly 的分區）留著。
   🔴 留什麼：photos / markers 【完全不動】（照片不屬於清單）。 */
async function clearAll(){
  const batch=uid();                 // 🔴 v0.1.9 R-05：清清單一次＝垃圾桶一行（🟡-12：出現在它含有的每個篩選底下）
  for(const r of ROOMS.slice()){ if(isHouseRoom(r)) continue; r.deletedAt=nowISO(); r.batchId=batch; await saveRoom(r); }
  for(const w of WALLS.slice()){ if(isHouse(w))     continue; w.deletedAt=nowISO(); w.batchId=batch; await saveWall(w); }
  /* 🔴 樑跟既有牆同性質（房子本身）⇒ 一根都不刪。 */
  for(const f of FURN.slice()) { f.deletedAt=nowISO(); f.batchId=batch; await saveItem(f); }
  await reloadObjects();
  /* 🔴 v0.09_i 需求 29：立刻重生種子，不要等下一次重新載入。
     若清完之後畫面上 0 個房間，而重生只發生在下一次載入
     則使用者處在一個「什麼都做不了」的狀態，而且畫面不說為什麼。
     ⚠️ v0.02_i 需求 5 本來就明訂「清空 → 種子會回來」
        ⇒ 這只是把「回來」的時機從【下次載入】提前到【當下】，不是新行為。
     ⚠️ 不要加「範例房間已重新產生」這種說明句（_d §10-0b）——她看得到它出現在畫面上。 */
  await seedIfEmpty();
}
/* 🗂 v0.1.9 批 7（R-18）：舊的 purgeTrash（「超過 20 筆刪最舊」＋「1 個月」、只刪本機）與 trashSize（數四個 store 的筆數）
   整段改寫 ⇒ 移到「批 7｜垃圾桶頁＋永久刪除」那一段（183 天、拿掉 20 筆、六張表、連線中寫 purged_at、離線只清本機）。 */

/* ══════════════════════════════════════════════════════════════
   需求 6｜房間：改名／刪除（含 anchor 重設）
   ══════════════════════════════════════════════════════════════ */
/* ╔═ 🔴 v0.19_i §下-9｜房間備註頁 ═════════════════════════════════════════════╗
   🔑 資料層【早就備好而且沒人用】：rooms.note 在 toRow／fromRow 都在，
      會推雲端也會拉回來 ⇒ 不用改 SQL、不用改同步。
   🛑 不用 askDialog 當本體：.dlg 是 max-height:80vh，輸入區加標題與按鈕列
      在所有手機都會把按鈕擠到捲動線以下。 */
let _noteRid=null, _noteOrig='';
/* ╔═ 🔴 v0.21_i §5b 下-27｜備註頁：鍵盤開著時〔取消〕〔完成〕不可以被推出畫面 ═══════════════╗
   Ali 真機（N-541）：「有鍵盤的情況下，如果一直增加，會被推到畫面看不到的位置。」
   🔑 不是瀏覽器的上限，可以修。根因（obs O-32 同族）：
      手機跳出鍵盤時，瀏覽器【不縮】整個版面，只縮「看得見的那一塊」（visual viewport）。
      而備註頁是 `position:fixed; inset:0` ＝ 高度仍是整個畫面
      ⇒ 打字時瀏覽器為了讓游標看得見，把看得見的那一塊往下捲 ⇒ 釘在最上面的按鈕被捲出去。
   ✅ 修法（Ali 同意：**只在備註頁生效**）：備註頁打開時追著 visualViewport，
      把 .notepage 的 top／height 設成「鍵盤上方看得見的那一塊」⇒ 按鈕在最上面、備註在框內捲。
   🛑🛑 **不動 <meta viewport>**（不用 interactive-widget=resizes-content）——
      Ali：「不改全域設定（之前 debug 撞爛很麻煩）」；那會讓所有 fixed 元素（含 .sel 家具面板）
      在鍵盤開著時一起跳位置，改掉 N-527 剛通過的行為。
   🔴 四個前提（讀坑 ⚠️14）：
      ① 關閉時的善後寫在 closeRoomNote 的【最前面】—— 它第二行有 `if(!rid) return;`
      ② 監聽在 focus（叫出鍵盤）之前就掛上，並在打開當下先套一次
      ③ visualViewport 在【手指縮放】時也會發 resize ⇒ 只在 scale≈1 時套用
      ④ 「只在手機上作用」寫成一個具名判準（noteFitsVisualViewport），
         §6b 之後做電腦版的寬螢幕版型（例如側欄）時，**只改這一處**，不要讓它把側欄拉成滿高。
   📌 obs O-40：這裡新增了一個狀態 `_noteVVOn` ⇒ 同一刻寫出誰把它清掉：**只有 noteVVDetach()**，
      而 noteVVDetach 只有一個呼叫點（closeRoomNote 最前面）。 ╚══════════════════════════════╝ */
function noteFitsVisualViewport(){                     // ④ 具名判準（function 宣告，測試時可覆寫）
  return !!window.visualViewport && !!window.matchMedia && matchMedia('(pointer:coarse)').matches;
}
let _noteVVOn=false;
function noteFitVV(){
  const vv=window.visualViewport, p=$('notePage'); if(!vv||!p) return;
  if(Math.abs((vv.scale||1)-1) > 0.01) return;         // ③ 手指縮放中：不追
  p.style.top    = vv.offsetTop+'px';
  p.style.height = vv.height+'px';
  p.style.bottom = 'auto';                              // inset:0 的 bottom 讓給 height
}
function noteVVAttach(){
  if(_noteVVOn || !noteFitsVisualViewport()) return;
  window.visualViewport.addEventListener('resize', noteFitVV);
  window.visualViewport.addEventListener('scroll', noteFitVV);
  _noteVVOn=true;
  noteFitVV();                                          // ② 打開當下先套一次
}
function noteVVDetach(){
  if(_noteVVOn && window.visualViewport){
    window.visualViewport.removeEventListener('resize', noteFitVV);
    window.visualViewport.removeEventListener('scroll', noteFitVV);
  }
  _noteVVOn=false;
  const p=$('notePage');
  if(p){ p.style.top=''; p.style.height=''; p.style.bottom=''; }   // 清乾淨 ⇒ 回到 inset:0
}
function openRoomNote(rid){
  const r=ROOMS.find(x=>x.id===rid); if(!r) return;
  _noteRid=rid; _noteOrig=r.note||'';
  $('npTitle').textContent=`🏷️ ${r.name||'未命名'}　備註`;
  $('npText').value=_noteOrig;
  $('notePage').hidden=false;
  noteVVAttach();                                       // 🔴 下-27 ②：在 focus（叫出鍵盤）之前
  setTimeout(()=>$('npText').focus(),30);
}
/* 🔴 關閉之後要回到【原來那個房間的位置】。
   renameRoom／saveRoom 那條路會重建清單（buildList 第一行是 innerHTML=''）
   ⇒ 直接關會彈回最上面 ⇒ 用 §下-1 加的 .grp[data-room] 捲回去。 */
function closeRoomNote(){
  noteVVDetach();                                       // 🔴 下-27 ①：在任何 return 之前
  const rid=_noteRid;
  $('notePage').hidden=true; _noteRid=null; _noteOrig='';
  if(!rid) return;
  const gh=document.querySelector(`.grp[data-room="${rid}"]`);
  if(gh) gh.scrollIntoView({block:'start'});
}
$('npDone').onclick=async()=>{
  const rid=_noteRid; if(!rid) return closeRoomNote();
  const r=ROOMS.find(x=>x.id===rid);
  if(r){
    r.note=$('npText').value;
    await saveRoom(r); await reloadObjects();   // 沿用 renameRoom 那條路，不新造存檔路徑
  }
  buildList(); refreshTop();
  closeRoomNote();
};
$('npCancel').onclick=async()=>{
  /* 🔴 保護：**只有真的改過字**，按〔取消〕才問一次；沒改過直接關。 */
  if($('npText').value !== _noteOrig){
    const ok=await askDialog({title:'放棄修改', body:'這次的修改不留？', okText:'不留'});
    if(ok===false) return;               // 她說「還要改」⇒ 留在備註頁
  }
  closeRoomNote();
};

async function renameRoom(id,name){
  const r=ROOMS.find(x=>x.id===id); if(!r) return;
  r.name=(name==null?'':String(name)).trim();       // 可留空 → 顯示「未命名」，不報錯
  await saveRoom(r); await reloadObjects();
}
/* 🔴 刪什麼／留什麼（spec-authoring §5-1）
   刪：該 Room／該 Room 底下所有 Wall／Beam 的列（軟刪除）
   留：Item 一筆都不刪；name/w/d/h/note/price/color/log/isBudgeted 全部不動；
       🔴 anchor 必須【就地轉成絕對座標】，不可留著指向已刪的牆
   🔴 順序硬規則：【先算 place()、再刪牆】。反了就取不到牆。 */
async function deleteRoomCascade(rid){
  const items=FURN.filter(f=>f.room===rid);
  const snap=items.map(f=>({f, p:place(f)}));       // ← 先算（此時牆還在）
  for(const {f,p} of snap){
    if(f.anchor && f.anchor.type==='wall'){
      f.anchor={type:'free', x:p.x, y:p.y};
      /* 🔴 v0.20_i 下-19：舊註解寫「沿用 btnUnsnap 的做法」—— **那句話是錯的**，
         當時 btnUnsnap 根本沒做這件事（它只換 anchor、不動 rot）。
         ⇒ 一句沒被驗證的「沿用」會讓後面每一個人停止追查（obs O-25／O-34）。
         ✅ 現在三處真的統一了：commitMove（拖走）／btnUnsnap（下-19）／本處。 */
      f.rot = p.ang*180/Math.PI;                    // 保住絕對朝向（與 btnUnsnap／commitMove 三處統一）
    }
    f.room=null;
    f.isPlaced=false;
    await saveItem(f);
  }
  const batch=uid();                               // 🔴 v0.1.9 R-05：房間＋它的牆與樑＝垃圾桶一行（還原時一起回來）
  for(const w of WALLS.filter(w=>w.room===rid)){ w.deletedAt=nowISO(); w.batchId=batch; await saveWall(w); }
  for(const b of BEAMS.filter(b=>b.room===rid)){ b.deletedAt=nowISO(); b.batchId=batch; await saveBeam(b); }
  await deleteRoom(rid, batch);
  if(S.selId && items.some(f=>f.id===S.selId)) { /* 家具沒刪，但已不在平面圖上 */ }
  await reloadObjects();
}
/* 確認框要列出家具名稱（Ali 定 Q-2）。N 很多時列前 10 筆 ＋「…等 N 件」 */
function confirmDeleteRoomText(rid){
  const items=FURN.filter(f=>f.room===rid);
  const names=items.map(f=>f.name||'未命名');
  const shown=names.slice(0,10);
  let li=shown.map(n=>`<li>${esc(n)}</li>`).join('');
  if(names.length>10) li+=`<li>…等 ${names.length} 件</li>`;
  return `刪除房間「${esc(roomName(rid))}」。<br>`+
    `牆與樑會一起刪除。<b>家具一件都不刪</b>，會變成未擺放：`+
    (names.length? `<ul>${li}</ul>` : '<br>（這個房間目前沒有家具）')+
    /* 🔴 v0.1.9 F-2（Ali 09-29）：還原房間時家具不會自動回去 ⇒ 刪之前先講 */
    `<br>之後從垃圾桶還原這個房間時，家具<b>不會</b>自動回到房間裡（要自己重新指定）。`;
}
async function confirmDeleteRoom(rid){
  const ok=await askDialog({title:'刪除房間', body:confirmDeleteRoomText(rid), okText:'刪除'});
  if(!ok) return;
  await deleteRoomCascade(rid);
  render(); buildList(); syncSel(); refreshTop();
}

/* ══════════════════════════════════════════════════════════════
   需求 7｜家具／項目 CRUD
   ══════════════════════════════════════════════════════════════ */
/* 新增：只有 name 也能建；連 name 都留空也允許（顯示「未命名」）。 */
async function addItem(init){
  const it=Object.assign({
    id:uid(), room:null, name:'', w:null, d:null, h:null,
    note:'', price:null, color:null, rot:0,
    /* 🔴 需求 46：只預留結構，本批不做任何邏輯（沒有分類 UI、沒有用到 zBase 的判定）。 */
    category:null, zBase:null,
    anchor:{type:'free', x:0, y:0},
    isPlaced:false, isBudgeted:false, log:[],
    projectCode:CLOUD.code||null, synced:false, pending:false,
    appVer:APP_VER, deletedAt:null
  }, init||{});
  newObj(it);                                   // 🔴 v0.05_i §3：新建才蓋 createdAt
  await saveItem(it);
  await reloadObjects();
  return it.id;
}
async function confirmDeleteItem(id){
  const f=FURN.find(x=>x.id===id); if(!f) return;
  const ok=await askDialog({title:'刪除項目',
    body:`刪除「${esc(f.name||'未命名')}」。<br>它會進垃圾桶（之後可能自動清掉）。`,
    okText:'刪除'});
  if(!ok) return;
  await deleteItem(id);
  await reloadObjects();
  if(S.selId===id) select(null);
  render(); buildList(); syncSel();
}
async function updateItemField(id,field,value){
  const f=FURN.find(x=>x.id===id); if(!f) return;
  f[field]=value;
  await saveItem(f);
}

/* ══════════════════════════════════════════════════════════════
   需求 13｜頁內覆蓋層確認／輸入（取代 confirm()／prompt()——O-11）
   ══════════════════════════════════════════════════════════════ */
let _askRes=null;
function askDialog(opts){
  const o=opts||{};
  $('askTitle').textContent=o.title||'確認';
  $('askBody').innerHTML=o.body||'';
  const hasInput = ('input' in o);
  $('askInputLine').hidden=!hasInput;
  if(hasInput) $('askInput').value=o.input==null?'':o.input;
  $('askYes').textContent=o.okText||'確定';
  $('ovAsk').hidden=false;
  if(hasInput) setTimeout(()=>$('askInput').focus(),30);
  return new Promise(res=>{ _askRes=res; });
}
function askClose(v){
  $('ovAsk').hidden=true;
  const r=_askRes; _askRes=null;
  if(r) r(v);
}
$('askNo').onclick=()=>askClose(false);
$('askYes').onclick=()=>{
  const hasInput=!$('askInputLine').hidden;
  askClose(hasInput ? $('askInput').value : true);
};
$('askInput').addEventListener('keydown',e=>{ if(e.key==='Enter') $('askYes').click(); });
