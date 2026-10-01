"use strict";

/* ══════════════════════════════════════════════════════════════
   v0.1.3｜雲端（Supabase）——_d §12-1b 方案 B：匿名身分 ＋ members
   🔒 anon key 是設計上公開的；service_role 永不進本檔。
   🔴 需求 13：CLOUD 模組與 cloudJoin/cloudLeave/cloudSync 的邏輯一行不改，
      只換觸發它的按鈕在哪。cloudPull 只准在末端加一行（需求 15）。
   ══════════════════════════════════════════════════════════════ */
const CLOUD = {
  url : 'https://dcagkkbzfzirxpearzoq.supabase.co',
  key : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjYWdra2J6ZnppcnhwZWFyem9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MDg4MDYsImV4cCI6MjEwNDI4NDgwNn0.tPycXGs0Iv6P6dpT3gAqQLBgEunMkSuhuNzBW2EhRN8',
  code:null, tok:null, uid:null, on:false, blocked:false, msg:'', busy:false,
  reauth:0,           // v0.1.3.1：這次連線期間重新取得身分幾次（R-1 的可見度）
  /* 🔴 需求 35-1：續期失敗、真的換了身分 ⇒ 畫面要講一句人話（旗標，不是計數） */
  reidentified:false,
  /* 需求 34 邊界：signup 回應沒有 refresh_token ＝ 這個環境不支援續期 ⇒ 標一次，不沉默 */
  noRefresh:false
};
/* 🔴 需求 38：多久沒同步就算「舊了」。寫成具名常數，方便日後調（測試時可暫時改成 1）。 */
const STALE_MIN = 30;
/* 🔴 v0.22_i R-45：所有 localStorage 鍵一律經過這裡加 ENV_PREFIX（正式版前綴是空字串 ⇒ 鍵名不變）。
   ⚠️ 全檔不可以再直接呼叫 localStorage.*（v0.1.8.1 的 deco.tab 兩處已改成走 LS）。 */
const LS={ get:k=>{try{return localStorage.getItem(ENV_PREFIX+k)}catch(e){return null}},
           set:(k,v)=>{try{localStorage.setItem(ENV_PREFIX+k,v)}catch(e){}},
           del:k=>{try{localStorage.removeItem(ENV_PREFIX+k)}catch(e){}} };

function cloudErr(e){
  CLOUD.msg = (e&&e.message)||String(e);
  cloudStat();
  return null;
}

/* ══════════════════════════════════════════════════════════════
   🔴 需求 18｜同步的分步狀態 ＋ 完成回饋
   Ali 原話：「他停住好久喔，這樣不知道她有沒有成功呢」
             「我是看著平面圖上面的出現照片的符號確定他同步的」
   ⇒ 她是【繞過對話框】自己推論出來的 ＝ 對話框沒有做到 _d §10-0b 的「狀態必留」。
   ⚠️ 為什麼要有時間戳：「回到原本那行字」與「從來沒按過」長得一樣，
      而「✅ 同步完成」若沒有時間，也分不出是【這一次】還是上一次殘留的字。
   ⚠️ 寫在【獨立的 #syncprog】裡，所以 cloudStat() 產的狀態與錯誤歸屬句一字不改。
   ══════════════════════════════════════════════════════════════ */
const SYNC = { added:0, pushed:0, photoTotal:0, photoDone:0,
               cloudPhotoRows:0, cloudObjRows:0 };
function syncReset(){
  SYNC.added=0; SYNC.pushed=0; SYNC.photoTotal=0; SYNC.photoDone=0;
  SYNC.cloudPhotoRows=0; SYNC.cloudObjRows=0;
}
function syncProg(html){ const b=$('syncprog'); if(b) b.innerHTML=html||''; }
function syncStep(txt){ syncProg(`<span class="run">⏳ ${esc(txt)}</span>`); }
const hhmm = ()=>{ const d=new Date(), z=x=>String(x).padStart(2,'0');
  return `${z(d.getHours())}:${z(d.getMinutes())}`; };
/* ⚠️ O-14：fetch 被 CSP 擋掉時丟的是 TypeError，訊息看起來像網路問題。
   要把它與「真的連不上」分開講，否則測試的人會以為程式壞了。 */
/* ╔═ 🔴 v0.1.10 P7（§0d #3／#4）｜每個請求都有逾時 ════════════════════════════════════════╗
   v0.1.9：fetch 在背景被凍住、回來也不回應 ⇒ 原檔佇列的 _origBusy 永遠是 true ⇒ 之後的 kick 全部只設
   _origAgain ⇒ 永遠不再跑（Android 真機：切走 5 分鐘回來橘條不消失，要重新整理）。
   ⇒ 用 AbortController 設上限：一般 30 秒；上傳 Blob 60 秒＋每 50 KB 1 秒；下載 Storage 檔 120 秒。
   🔑 timer 在 fetch 回來之後【不清】：呼叫端讀 body（json()／blob()）也要受同一個上限保護；
      已經讀完的回應被 abort 是 no-op。
   逾時／網路錯 ⇒ 丟出的錯帶 e.transient＝true（呼叫端據此「留 pending、這一輪停、下次再來」）。
   冪等性（讀坑 Q3）：Storage 上傳是固定路徑＋x-upsert、列是 upsert＋return=representation、刪檔走待刪清單 ⇒ 逾時後重做不會出錯。 ╚═╝ */
const SB_TIMEOUT_MS = 30000;
function sbTimeoutFor(path, opt){
  if(opt.timeoutMs!=null) return opt.timeoutMs;
  const b=opt.body;
  if(b && typeof Blob!=='undefined' && b instanceof Blob) return 60000 + Math.ceil(b.size/51200)*1000;
  if(/^\/storage\/v1\/object\/photos\//.test(path) && !(opt.method && opt.method!=='GET')) return 120000;
  return SB_TIMEOUT_MS;
}
/* 暫時性的 HTTP 狀態（§0d #4）：留 pending、之後再試；其他 4xx 才算「真的失敗」 */
const isTransientStatus = s => s>=500 || s===408 || s===429;
async function sbFetch(path, opt){
  opt = opt || {};
  const h = Object.assign({ apikey: CLOUD.key }, opt.headers||{});
  if(CLOUD.tok) h.Authorization = 'Bearer '+CLOUD.tok;
  const ms = sbTimeoutFor(path, opt);
  const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
  if(ac) setTimeout(()=>{ try{ ac.abort(); }catch(e){} }, ms);
  let r;
  try{
    const o = Object.assign({}, opt, {headers:h});
    delete o.timeoutMs; delete o._retry;
    if(ac) o.signal = ac.signal;
    r = await fetch(CLOUD.url+path, o);
  }catch(e){
    const timedOut = !!(ac && ac.signal.aborted);
    if(!timedOut) CLOUD.blocked = true;
    const err = new Error(timedOut
      ? `連線逾時（${Math.round(ms/1000)} 秒沒有回應，稍後會自動再試）`
      : '對外連線失敗（可能被這個環境的安全政策擋住，或網路中斷）：'+e.message);
    err.name = timedOut ? 'TimeoutError' : 'NetworkError';
    err.transient = true;
    throw err;
  }
  CLOUD.blocked = false;
  /* 🔴 需求 34：401 先【續期】，續不動才換身分。
     ⚠️ path.indexOf('/auth/')<0 這一行守衛不准動——refreshSession 本身也走 sbFetch，
        少了它就會遞迴。 */
  if(r.status===401 && !opt._retry && path.indexOf('/auth/')<0){
    const okRefresh = await refreshSession();
    if(!okRefresh){
      await signInAnon(true);                   // 身分過期且續不動 → 重新拿一個
      /* 🔴 R-1：新身分是【全新的 uid】，不在 members 裡。
         少了這一步，接下來每個讀取都會回 200 []（有權限問題，但長得像「雲端空了」）。 */
      if(CLOUD.code && !_rejoining){
        _rejoining = true;
        try{ await joinProject(CLOUD.code); }
        finally{ _rejoining = false; }          // ⚠️ 防遞迴：joinProject 本身也走 sbFetch
      }
      CLOUD.reidentified = true;                // 🔴 需求 35-1：這件事不可以靜默
    }
    return sbFetch(path, Object.assign({}, opt, {_retry:true}));
  }
  return r;
}
let _rejoining = false;

/* 🔴 需求 35-2：舊格式（沒有 v:2 ＝ 沒有 refresh_token）的 session 一律丟棄。
   ⚠️ 只丟【身分】，不丟 deco_code——代碼是 Ali 唯一的鑰匙。 */
function dropLegacySession(){
  try{
    const raw = LS.get('deco_sess');
    if(!raw) return;
    const j = JSON.parse(raw);
    if(!j || j.v !== 2) LS.del('deco_sess');
  }catch(e){ LS.del('deco_sess'); }             // 壞掉的也丟
}

/* 🔴 需求 34：用 refresh_token 續期。
   ⚠️ 回來的 refresh_token 是【新的】，一定要覆蓋存起來，否則下一次續期必失敗。
   ⚠️ in-flight 共用：兩個請求同時 401 時只能真的續一次，否則第二個拿到已被輪替掉的
      舊 token ⇒ 失敗 ⇒ 白白掉回重新註冊。 */
let _refreshing = null;
async function refreshSession(){
  if(_refreshing) return _refreshing;
  _refreshing = (async ()=>{
    let saved={};
    try{ saved = JSON.parse(LS.get('deco_sess')||'{}') || {}; }catch(e){ saved={}; }
    if(!saved.r) return false;                  // 沒有 refresh token → 續不了
    let r;
    try{
      r = await sbFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ refresh_token: saved.r })});
    }catch(e){ return false; }                  // 離線／被擋：不換身分，錯誤由外層那條路報
    if(!r.ok) return false;                     // 400／401：token 失效或被撤銷
    let j={}; try{ j = await r.json(); }catch(e){ return false; }
    if(!j.access_token) return false;
    CLOUD.tok = j.access_token;
    CLOUD.uid = (j.user && j.user.id) || CLOUD.uid;
    LS.set('deco_sess', JSON.stringify({ v:2, t:j.access_token,
            r: j.refresh_token || saved.r, u: CLOUD.uid }));
    return true;
  })().finally(()=>{ _refreshing = null; });
  return _refreshing;
}

async function signInAnon(force){
  dropLegacySession();                          // 🔴 需求 35-2：早於任何還原邏輯
  if(CLOUD.tok && !force) return;
  if(!force){
    const saved=LS.get('deco_sess');
    if(saved){ try{ const j=JSON.parse(saved);
      if(j && j.v===2 && j.t){ CLOUD.tok=j.t; CLOUD.uid=j.u; return; } }catch(e){} }
  }
  const r=await sbFetch('/auth/v1/signup',{method:'POST',
    headers:{'Content-Type':'application/json'}, body:'{}'});
  const t=await r.text();
  let j={}; try{ j=JSON.parse(t); }catch(e){}
  if(!r.ok || !j.access_token)
    throw new Error('拿匿名身分失敗（Anonymous sign-ins 開了嗎？）：'+(j.msg||j.error_description||j.error||t.slice(0,160)));
  const prev=CLOUD.uid;
  CLOUD.tok=j.access_token; CLOUD.uid=(j.user&&j.user.id)||null;
  if(force && prev && prev!==CLOUD.uid) CLOUD.reauth++;   // 身分真的換掉了
  /* 🔴 需求 34：refresh_token 一定要存下來，否則到期時只能重新註冊一個新身分。
     邊界：這個環境沒有給 refresh_token ⇒ 標起來，讓 cloudStat() 說一句（不要沉默）。 */
  CLOUD.noRefresh = !j.refresh_token;
  LS.set('deco_sess', JSON.stringify({v:2, t:CLOUD.tok, r:j.refresh_token||null, u:CLOUD.uid}));
}
/* 🔴 R-1 的核心修法：把「雲端 0 筆」這個有歧義的訊號，
   換成一個有明確答案的問題——「這台的身分在 members 裡嗎？」
   ⚠️ 需求 15 留什麼：這一段【一行不動】。 */
async function cloudVerifyMember(){
  const r=await sbFetch('/rest/v1/members?select=project_code&project_code=eq.'
                        +encodeURIComponent(CLOUD.code));
  if(!r.ok) throw new Error('確認專案身分失敗：'+(await r.text()).slice(0,160));
  const rows=await r.json();
  return Array.isArray(rows) && rows.length>0;
}
async function joinProject(code){
  await signInAnon();
  const r=await sbFetch('/rest/v1/rpc/join_project',{method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})});
  const t=await r.text();
  if(!r.ok) throw new Error('加入專案失敗（SQL 跑過了嗎？）：'+t.slice(0,200));
  try{ return JSON.parse(t); }catch(e){ return String(code).toUpperCase().trim(); }
}

/* ══════════════════════════════════════════════════════════════
   需求 15｜四張新表的 push／pull 欄位對照
   🔴 fromRow() 必須做 fromMM()，含 anchor 內的 along/off/x/y
   ⚠️ synced / pending / appVer 是本機專用欄位，不可送上雲端（雲端 schema 沒有）
   ══════════════════════════════════════════════════════════════ */
/* ╔═ 🔴🔴 v0.20_i §4-2｜`site` 由後台管，App **一個字都不要送** ═══════════════════╗
   本批貼了 SQL 加 site 欄位（projects／rooms／walls／beams；🔴 items 不加），
   但 App **不做任何功能** —— 所以這支函式裡【完全不要出現 `site` 這個 key】。

   🛑 **最容易寫出來的那一種錯**：`site: o.site ?? null`
      ⇒ 會送出 `"site":null` ⇒ **把後台填的值洗成 NULL**。
   🔑 為什麼這個坑特別毒：下面 items 分支現成就有一行 `flags:o.flags ?? null`，
      **那一行是對的**（flags 本來就歸 App 管、fromRow 也讀得回來）
      ⇒ 建造者很自然會「比照 flags 的寫法」把 site 也加上去 ⇒ **一行就洗掉整張表**。
      🔴 **不可以比照 flags 的寫法。**
   ⚠️ JS 的兩種「沒有」在這裡不等價：
        { site: undefined } → JSON.stringify 會丟掉它 → 安全
        { site: null }      → 序列化成 "site":null → 🔴 會 SET 成 NULL
      ⇒ 不要依賴 undefined 的僥倖，**直接不要有那個 property**。
   ✅ fromRow() 也不要讀 site（App 完全不需要知道它）。

   📌 **判準（機械可查，之後加任何新欄位都照它判）**：
      「`toRow()` 送、而 `fromRow()` **不讀** 的欄位 ⇒ 它一定會在第一次存檔被洗成 null。」
      理由：讀得回來的欄位是 round-trip（送出去的就是從雲端讀來的），怎麼送都不會掉；
           讀不回來的欄位，記憶體裡永遠是 undefined ⇒ `?? null` ⇒ SET NULL。
      ⇒ `site` 正是這一類（所以不能送）；`z_min`／`z_max` 也是（已正確不送）。
      ✅ 建造前讀坑已逐欄掃過四個分支：**本批不需要修任何一欄。** ╚═══════════════════╝ */
function toRow(store,o){
  const base={ id:o.id, project_code:CLOUD.code,
    deleted_at:o.deletedAt||null, updated_at:o.updatedAt||nowISO() };
  /* 🔴 v0.05_i §3（修三）：有 createdAt 才送 created_at。
     ⚠️ 沒有的【不要送 null】——雲端那一欄是 not null default now()，
        送 null 會被拒；而 omit 掉就由資料庫自己蓋（那是真的時間，不是假造的）。
        這正好就是「不要補寫一個假的 createdAt」（obs O-13）的另一半。 */
  if(o.createdAt) base.created_at=o.createdAt;
  /* 🔴 v0.22_i R-05：三態刪除的新欄位（六張表都有 batch_id／purged_at；兩張相簿表多 restored_at）。
     🔴 一律【有值才送】（比照 created_at／poly）：
        · purged_at　一台還不知道「已永久刪除」的手機送 null 會把墓碑洗掉（雲端 trigger 也擋，兩層）
        · batch_id　 與 deleted_at 成對；還原時雲端的舊 batch_id 留著無害（垃圾桶只看 deleted_at 有值的）
        · restored_at 只有「按了還原」的那一次才有新值 ⇒ 雲端 trigger 靠它分辨還原與離線編輯（§0c R-06）
     📌 fromRow 三個都讀 ⇒ 是 round-trip 欄位，不會落入 3112 的「送了卻讀不回來 ⇒ 洗成 null」。 */
  if(o.batchId)    base.batch_id=o.batchId;
  if(o.purgedAt)   base.purged_at=o.purgedAt;
  if((store==='albums'||store==='album_photos') && o.restoredAt) base.restored_at=o.restoredAt;
  /* ── 🔴 v0.1.9：相簿兩張表 ── */
  if(store==='albums') return Object.assign(base,{
    name:o.name??null,
    /* 🔴 定位點【永遠送】（含 null）：〔取消定位〕＝清成空，這個「清空」必須傳播到別台。 */
    loc_x:toMM(o.locX), loc_y:toMM(o.locY) });
    /* 🔴🔴 v0.1.10 P9（§0d ⑦）：序號 no 與顏色 color 由【雲端】在 insert 時發（trigger albums_assign_no），
       App 一律【不送】—— 連 null 都不送（這一行上面的 Object.assign 刻意沒有這兩個 key）。
       雲端另有 albums_zz_keep_no 擋任何更新，就算誰送了也改不動。 */
  if(store==='album_photos') return Object.assign(base,{
    album_id:o.albumId, photo_id:o.photoId,
    name:o.name??null, note:o.note??null, sort:(o.sort==null? null : Number(o.sort)) });
  if(store==='rooms'){
    const row=Object.assign(base,{
      name:o.name??null, slab_h:toMM(o.slabH), note:o.note??null });
    /* 🔴🔴 v0.13_i 修二-a：poly【有值才送】，比照上面 created_at 的寫法。
       ⚠️ 若無條件送，polyToMM(undefined) 會是 null
          ⇒ 舊裝置存一次檔就把雲端那一列的 poly 明確覆寫成 null ⇒ 另一台也跟著死。
       ⭐ 這個寫法不論 PostgREST 的 upsert 對「payload 沒帶的欄位」是保留還是覆寫成預設，
          都不會洗掉資料 ⇒ 我們不必先解那個【仍未實測】的問題。
       ⚠️ 與 obs O-19 同一個形狀：存檔不可以順便把一個欄位變成 null。 */
    if(validPoly(o.poly)) row.poly=polyToMM(o.poly);
    return row;
  }
  if(store==='walls') return Object.assign(base,{
    room_id:o.room||null, x1:toMM(o.x1), y1:toMM(o.y1), x2:toMM(o.x2), y2:toMM(o.y2),
    thickness:toMM(o.thickness), height:toMM(o.height),
    /* 🔴 v0.05_i §1（修一）：前台是唯一的 insert 來源，它只能寫 proposed
       ⇒ 這裡的後備值也必須是 'proposed'，否則一道沒有 state 的牆會被 42501 拒掉。 */
    /* 🔴 v0.13_i 修十一 F-14：本批 z_min／z_max【只讀不寫】—— 這裡一個字都不加。
       （它們要等門窗那一批才用得到；順手加進來會把匯入的高度區間洗掉。） */
    is_boundary:o.isBoundary!==false, state:o.state||'proposed',
    total:o.total??null, note:o.note??null,
    is_placed:o.isPlaced!==false, is_budgeted:!!o.isBudgeted });
  if(store==='beams') return Object.assign(base,{
    room_id:o.room||null, x1:toMM(o.x1), y1:toMM(o.y1), x2:toMM(o.x2), y2:toMM(o.y2),
    width:toMM(o.width), drop_mm:toMM(o.drop), note:o.note??null });
  /* 🔴 v0.22_i §0b R-04（A-4）：最後一個分支【明寫】items，不認得的 store 直接丟錯。
     舊寫法是「其餘一律當 items」（3497 註解警告過）⇒ 傳一個新 store 進來會安靜地被組成 items 形狀。 */
  if(store!=='items') throw new Error('toRow：不認得的資料表 '+store);
  return Object.assign(base,{
    room_id:o.room||null, name:o.name??null,
    w:toMM(o.w), d:toMM(o.d), h:toMM(o.h),
    note:o.note??null, price:o.price??null, color:o.color??null, rot:o.rot||0,
    anchor:anchorToMM(o.anchor),
    /* 🔴 需求 46：只加兩個欄位，【不做任何邏輯】（分類的篩選／分組／icon 差異／
       任何用到 z_base 的判定都不在本批）。
       category 存英文代碼（space／furniture／appliance／hidden／opening），前台顯示中文
       ⇒ 之後改中文顯示名不用動資料。 */
    category:o.category??null, z_base:toMM(o.zBase),
    /* 🔴 v0.19_i §下-7 ①：新欄位 items.flags（jsonb，Ali 2026-09-19 已貼 SQL）。
       🔴🔴 rotUser **不可以塞進 anchor**：commitMove 與 snapBackToWall 都是
          【整個重建 anchor】⇒ 塞進去會被安靜丟掉，而失敗路徑正好就是本條要修的那一條
          （同一個坑 v0.14_i 踩過一次：anchor.side 消失）。 */
    flags:o.flags ?? null,
    is_placed:!!o.isPlaced, is_budgeted:!!o.isBudgeted, log:o.log||[] });
}
function fromRow(store,row){
  const base={ id:row.id, projectCode:row.project_code||null,
    deletedAt:row.deleted_at||null, updatedAt:row.updated_at||null,
    /* 🔴 v0.05_i §3（修三）：pull 覆蓋時要【保留】建立時間 ⇒ 直接讀雲端的 created_at。
       雲端沒有（舊列）→ null，不偽造。 */
    createdAt:row.created_at||null,
    /* 🔴 v0.22_i R-05：與 toRow 成對（兩邊都要有，3112 判準）。 */
    batchId:row.batch_id||null, purgedAt:row.purged_at||null,
    appVer:APP_VER };
  /* ── 🔴 v0.1.9：相簿兩張表 ── */
  if(store==='albums') return Object.assign(base,{
    name:row.name||'', locX:fromMM(row.loc_x), locY:fromMM(row.loc_y),
    restoredAt:row.restored_at||null,
    /* 🔴 v0.1.10 P9：只讀欄（雲端發；沒貼 SQL 時雲端沒有這兩欄 ⇒ undefined ⇒ null ⇒ 畫面「#—」） */
    no:(row.no==null ? null : Number(row.no)), color:(row.color==null ? null : Number(row.color)) });
  if(store==='album_photos') return Object.assign(base,{
    albumId:row.album_id, photoId:row.photo_id,
    name:row.name||'', note:row.note||'', sort:(row.sort==null? null : Number(row.sort)),
    restoredAt:row.restored_at||null });
  /* 🔴 六處換算之一：雲端 mm → 記憶體 cm。 */
  if(store==='rooms') return Object.assign(base,{
    name:row.name||'', slabH:fromMM(row.slab_h), note:row.note||'',
    poly:polyFromMM(row.poly) });
  if(store==='walls') return Object.assign(base,{
    room:row.room_id||null,
    x1:fromMM(row.x1), y1:fromMM(row.y1), x2:fromMM(row.x2), y2:fromMM(row.y2),
    thickness:fromMM(row.thickness), height:fromMM(row.height),
    isBoundary:row.is_boundary!==false, state:row.state||'existing',
    total:row.total??null, note:row.note||'',
    isPlaced:row.is_placed!==false, isBudgeted:!!row.is_budgeted });
  if(store==='beams') return Object.assign(base,{
    room:row.room_id||null,
    x1:fromMM(row.x1), y1:fromMM(row.y1), x2:fromMM(row.x2), y2:fromMM(row.y2),
    width:fromMM(row.width), drop:fromMM(row.drop_mm), note:row.note||'' });
  /* 🔴 R-04：同 toRow —— 不認得的 store 不可以落成 items。 */
  if(store!=='items') throw new Error('fromRow：不認得的資料表 '+store);
  return Object.assign(base,{
    room:row.room_id||null, name:row.name||'',
    w:fromMM(row.w), d:fromMM(row.d), h:fromMM(row.h),
    note:row.note||'', price:row.price??null, color:row.color||null, rot:row.rot||0,
    anchor:anchorFromMM(row.anchor),
    category:row.category||null, zBase:fromMM(row.z_base),     // 🔴 需求 46
    flags:row.flags||null,                                     // 🔴 §下-7 ②
    isPlaced:!!row.is_placed, isBudgeted:!!row.is_budgeted, log:row.log||[] });
}
/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 3｜同步層的共用零件
   ══════════════════════════════════════════════════════════════ */
/* ╔═ 🔴 v0.22_i §0c R-44｜所有 pull 一律翻頁（sbFetchAll）═══════════════════════════════╗
   PostgREST（Supabase 預設 Max rows）一次最多回 1000 列，而且【不報錯、不說被截斷】。
   照片線的刪除傳播是「雲端沒這個 id ⇒ 刪本機」⇒ 第 1001 張起每一次同步都會被刪掉本機副本（O-18／O-22）。
   ⇒ 依 id 排序、limit／offset 一頁一頁拿到「不足一頁」為止。
   🔧 SB_PAGE 是 let：自驗時改小（例 2）就能在幾筆資料上驗翻頁，不必造 1001 筆。 */
let SB_PAGE = 1000;
async function sbFetchAll(pathBase, what){
  const out=[];
  for(let off=0; ; off+=SB_PAGE){
    const r=await sbFetch(`${pathBase}&order=id.asc&limit=${SB_PAGE}&offset=${off}`);
    if(!r.ok) throw new Error(`讀雲端${what||''}失敗：`+(await r.text()).slice(0,200));
    const rows=await r.json();
    if(!Array.isArray(rows)) throw new Error(`讀雲端${what||''}失敗：回應不是清單`);
    out.push(...rows);
    if(rows.length < SB_PAGE) break;
  }
  return out;
}
/* ╔═ 🔴 v0.22_i §0c R-15｜資料版本號：v0.1.9 只讀不寫 ═════════════════════════════════╗
   v0.1.9 自己的格式＝1。雲端 projects.data_ver 是 null 或 ≤ 1 ⇒ 正常。
   > 1（之後的版本寫的）⇒ 【只停推雲端】：本機照存、照標 pending，畫面常駐一行「請重新整理到新版」。
   讀的時機：cloudPull 最前面（身分確認之後）⇒ 在任何補推之前就知道要不要停。 */
const DATA_VER = 1;
CLOUD.frozen = false;
const FROZEN_MSG = '雲端資料已經是新版的格式，這個版本不會再上傳任何東西。請重新整理到新版。';

/* 🔴 v0.1.9：推送後拿回雲端那一列（return=representation）並當場套用（§0c R-06、R-07）。
   · 雲端 trigger 把已永久刪除的列「回舊列」、把離線編輯留在垃圾桶 ⇒ 回來的列與送出去的不同
   · 不當場套用的話，推的那台要等下一次同步才知道（甚至永遠不知道：雲端 updated_at 可能等於本機） */
async function applyPushedRow(store, o, row){
  if(!row) return;
  const inc=fromRow(store,row);
  if(inc.purgedAt){ await lDel(store,o.id); return 'purged'; }
  /* 🔴 v0.1.10 P9：新建相簿推上去那一次，雲端回傳的列帶著剛發的序號與顏色，但 updated_at 跟本機一樣
     ⇒ 下面的判斷不會覆寫 ⇒ 號會被丟掉、要等下一次 pull。⇒ 這兩欄不同就先寫進本機（不動 pending 的判斷）。 */
  if(store==='albums' && ((inc.no??null)!==(o.no??null) || (inc.color??null)!==(o.color??null))
     && (inc.no!=null || inc.color!=null)){
    const cur=await lGetObj(store,o.id);
    if(cur){ cur.no=inc.no; cur.color=inc.color; await lPutObj(store,cur); o.no=inc.no; o.color=inc.color; }
  }
  if((inc.deletedAt||null)!==(o.deletedAt||null)
     || (Date.parse(inc.updatedAt||'')||0)!==(Date.parse(o.updatedAt||'')||0)){
    await lPutObj(store, Object.assign({}, inc, {pending:false, synced:true,
      createdAt: inc.createdAt || o.createdAt || null}));
    return 'changed';
  }
  return null;
}
/* 推：本機 → 雲端（單筆） */
async function cloudPushObj(store,id){
  const o=await lGetObj(store,id);
  if(!o || !CLOUD.on || o.projectCode!==CLOUD.code) return;
  if(CLOUD.frozen) return;                       // 🔴 R-15：停推（pending 留著）
  if(ALBUM_STORES.includes(store) && !ALBUM_CLOUD) return;
  const row=toRow(store,o);
  const ins=await sbFetch(`/rest/v1/${store}?on_conflict=id`,{method:'POST',
    headers:{'Content-Type':'application/json',
             'Prefer':'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify(row)});
  if(!ins.ok){
    const t=await ins.text();
    /* 🔴 §0c R-48（🟠-4）：兩台同時把同一張照片放進同一本 ⇒ 撞「同一本不重複」的唯一鍵（23505）。
       不處理的話這一筆永遠 pending、永遠重試（O-19 形狀）。⇒ 本機這一筆拿掉，說一句話。 */
    if(store==='album_photos' && /23505/.test(t)){
      await lDel(store,o.id);
      const a=ALBUMS.find(x=>x.id===o.albumId);
      cloudErr(new Error(`這張已經在「${(a&&a.name)||'那本相簿'}」裡了（另一台先放進去了），這一筆沒有重複加入。`));
      return;
    }
    throw new Error(`寫入雲端 ${store} 失敗：`+t.slice(0,200));
  }
  let rows=null; try{ rows=await ins.json(); }catch(e){}
  const back = Array.isArray(rows) ? rows[0] : null;
  const how  = await applyPushedRow(store, o, back);
  if(!how){
    /* 🔴 v0.1.9：同照片線 —— 推送途中又存過一次的話，不可以用舊的那份蓋掉（只標記沒被改過的）。 */
    const cur=await lGetObj(store,o.id);
    if(cur && (cur.updatedAt||null)===(o.updatedAt||null)){ cur.pending=false; cur.synced=true; await lPutObj(store,cur); }
  }
  SYNC.pushed++;                                 // 🔴 需求 18 ②：上傳 N 筆
  cloudStat();
}

/* ╔═ 🔴 v0.1.9｜照片列的欄位對照（兩個方向各一支，推與拉只准走這兩支）══════════════════╗
   本機欄位名 ⇄ 雲端欄位名。🔴 只列【雲端認得】的欄位 —— 本機專用的（small／orig 兩個 Blob、
   source、rotated、oriBy、orientation、decoded、err、rawW/H、origClean…）不進來也不被洗掉。 */
function photoFromRow(row){
  const o={ name:row.name, mime:row.mime||'image/jpeg',
    smallSize:row.small_size,
    w:row.width, h:row.height, dateTaken:row.date_taken||null,
    addedAt:row.added_at||null, storagePath:row.storage_path,
    origPath:row.orig_path||null, origStatus:row.orig_status||null,
    origType:(row.orig_type==='jpg-shrunk' ? 'jpg' : (row.orig_type||null)),
    origShrunk:(row.orig_type==='jpg-shrunk'),
    albumVer:(row.album_ver==null? null : row.album_ver),
    updatedAt:row.updated_at||null };
  /* 🔴 v0.1.9 批 7 自驗抓到：orig_size 在雲端是「有原檔才送」（photoToRow）⇒ 第一次推（還是 pending）回來的列是 null，
     舊寫法照單全收 ⇒ 本機的 origSize 被洗成 null ⇒ 之後傳完原檔（has）時 `origSize!=null` 不成立 ⇒ 永遠不送
     ⇒ 雲端與本機都不知道原檔多大（〔刪除雲端的原檔〕寫不出 MB）。同一個形狀＝3112 判準的反方向（讀回 null 洗掉本機）。
     ⇒ 雲端沒有值就【不帶這個欄位】（Object.assign 不會碰本機那一欄）。 */
  if(row.orig_size!=null) o.origSize=row.orig_size;
  return o;
}
function photoToRow(r){
  /* 🔴 R-03 ②：updated_at 送【編輯當時】的時間（rec.updatedAt），不是推送當下。
     從雲端拉下來的舊紀錄可能沒有 updatedAt ⇒ 退回 addedAt，再不行才現在（雲端欄位 not null）。 */
  const row={ id:r.id, project_code:CLOUD.code, name:r.name, mime:r.mime,
    small_size:r.smallSize||null,
    width:r.w||null, height:r.h||null, date_taken:r.dateTaken||null,
    added_at:r.addedAt||null, storage_path:r.storagePath,
    updated_at:r.updatedAt || r.addedAt || nowISO() };
  /* 🔴🔴 §0c R-03（🔴-6）：新欄位一律【有值才送】（比照 poly）。
     照片是整列 upsert ⇒ 一台舊資料的手機（本機 origStatus 還是空）一推，
     就會把另一台剛寫的 'has' 洗掉（相-32 時過時不過）。有值才送 ⇒ 它不會碰那一欄。 */
  if(r.origSize!=null && r.origStatus==='has') row.orig_size=r.origSize;
  if(r.origPath)   row.orig_path=r.origPath;
  if(r.origStatus) row.orig_status=r.origStatus;
  /* 🔴 v0.1.9 Q-A2：「已縮小」要讓別台也知道 ⇒ 編進 orig_type（'jpg-shrunk'）；讀回來拆開 */
  if(r.origType)   row.orig_type = (r.origShrunk && r.origType==='jpg') ? 'jpg-shrunk' : r.origType;
  if(r.albumVer!=null) row.album_ver=r.albumVer;
  /* 唯一的例外：〔刪除雲端的原檔〕要把路徑【清掉】，這個清空必須傳播 ⇒ 明寫送 null。 */
  if(r.origStatus==='purged') row.orig_path=null;
  return row;
}
/* ── 推：本機 → 雲端（照片） ── */
async function cloudPushPhoto(id){
  const r=await lGet('photos',id);
  if(!r || !CLOUD.on || r.projectCode!==CLOUD.code) return;
  if(CLOUD.frozen) return;                       // 🔴 R-15
  if(!r.storagePath){
    /* 🔴 §0b R-13（A-17）：只傳【壓縮版】。舊碼是 `r.small||r.orig` ⇒ 解不開的 HEIC 會被當成
       壓縮版傳到 .jpg 路徑。small 做不出來的照片根本不會進相簿（批 4 intake），這裡是第二道。 */
    const blob=r.small;
    if(!blob) return;
    const path=`${CLOUD.code}/${r.id}.jpg`;      // 🔑 路徑第一段＝權限鍵
    const up=await sbFetch('/storage/v1/object/photos/'+path,{method:'POST',
      headers:{'Content-Type':blob.type||'image/jpeg','x-upsert':'true'}, body:blob});
    if(!up.ok) throw new Error('上傳照片檔失敗：'+(await up.text()).slice(0,200));
    r.storagePath=path;
  }
  /* ⚠️ 先上傳檔案、成功才寫列。反序會留下「指不到檔的列」。 */
  const row=photoToRow(r);
  const ins=await sbFetch('/rest/v1/photos?on_conflict=id',{method:'POST',
    headers:{'Content-Type':'application/json',
             'Prefer':'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify(row)});
  if(!ins.ok) throw new Error('寫入雲端清單失敗：'+(await ins.text()).slice(0,200));
  let rows=null; try{ rows=await ins.json(); }catch(e){}
  /* 🔴 §0c R-07（🔴-5）：雲端回 [] ＝ 這張已被永久刪除（photo_purged 墓碑擋下了重新插入）
     ⇒ 本機也刪掉，不要再推。 */
  if(Array.isArray(rows) && rows.length===0){
    await lDel('photos',r.id);
    SYNC.pushed++; cloudStat();
    return 'purged';
  }
  /* 🔴 v0.1.9：推送途中這台可能又存了一次（例如原檔佇列、改名）⇒ 重讀本機那一筆，
     只有「沒被改過」才標成已同步；storagePath 一律補上。否則會用舊的那份蓋掉新的編輯。 */
  {
    const cur=await lGet('photos',r.id);
    if(cur){
      cur.storagePath=r.storagePath;
      if((cur.updatedAt||null)===(r.updatedAt||null)){
        cur.pending=false; cur.synced=true;
        /* 🔴 自驗抓到（相-32 在 B 台失敗）：「有值才送」讓雲端保住了 A 寫的 'has'，
           但雲端那一列的 updated_at 變成 B 送的時間 ＝ B 本機的時間 ⇒ B 下次拉「一樣新」就不採用
           ⇒ B 的橘條永遠不消失。⇒ 用推送回傳的那一列（return=representation）把雲端認得的欄位
           當場補進本機（它＝B 送的值＋雲端保住的那幾欄）。 */
        if(Array.isArray(rows) && rows[0]) Object.assign(cur, photoFromRow(rows[0]));
      }
      await lPut('photos',cur);
      /* 壓縮版一上雲，原檔佇列就可以接著傳這一張（§9-2 ①） */
      if(cur.orig && (cur.origStatus==='pending' || (cur.albumVer===0 && cur.origStatus==null && !cur.origClean)))
        kickOrigQueue();
    }
  }
  SYNC.pushed++;                                 // 🔴 需求 18 ②
  cloudStat();
}
async function cloudPushMarker(id){
  const m=await lGet('markers',id);
  if(!m || !CLOUD.on || m.projectCode!==CLOUD.code) return;
  if(CLOUD.frozen) return;                       // 🔴 R-15
  const row={ id:m.id, project_code:CLOUD.code, photo_id:m.photoId,
    x:m.x, y:m.y, updated_at:nowISO() };
  const ins=await sbFetch('/rest/v1/markers?on_conflict=id',{method:'POST',
    headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
    body:JSON.stringify(row)});
  if(!ins.ok) throw new Error('寫入雲端標記失敗：'+(await ins.text()).slice(0,200));
  m.pending=false; m.synced=true; await lPut('markers',m);
  SYNC.pushed++;                                 // 🔴 需求 18 ②
  cloudStat();
}
/* 🗂 v0.1.9 批 10：cloudDelPhoto／cloudDelMarker（雲端硬刪）拿掉 —— 呼叫它們的 deletePhoto／deleteMarker 已拿掉，
   而且貼了 v0.1.9 SQL 之後雲端的 photos／markers 本來就沒有 delete 權限。 */

/* ══════════════════════════════════════════════════════════════
   🔴 需求 15｜物件表的 pull（v0.1.9 起六張：四張舊表 ＋ 相簿兩張）
   掛在 cloudPull() 內、照片與標記【之後】。
   前提：cloudPull() 開頭的 cloudVerifyMember() 已通過（R-1 守門），本函式不重複做。
   🔴 【不准】抄照片線的兩條：
      · 「本機已有就跳過」—— 房間/家具會改，抄了就永遠拉不到修改
      · 「雲端沒這個 id ⇒ 刪本機」—— 這幾張表有 deletedAt，刪除是寫得出來的事實
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.14_i 補一：無視時間戳回填的【白名單】。
   判準：這個欄位使用者【有沒有辦法把它清空】？有 → 不可以進；沒有 → 可以進。
   🔴 不要寫成「所有 null 的欄位」。 */
const BACKFILL = { rooms:['poly'],
  /* 🔴 v0.1.10 P9（§0d ⑦）：雲端補號補色【不會】讓 updated_at 變新（albums 沒有自動更新 updated_at 的 trigger）
     ⇒ 走「晚的贏」拿不到 ⇒ 進白名單：雲端有值、本機空 ⇒ 無視時間戳補下來。
     使用者清不掉這兩欄（只讀、雲端 trigger 固定）⇒ 符合上面的判準。 */
  albums:['no','color'] };
const OBJ_STORES = ['rooms','walls','beams','items','albums','album_photos'];
async function cloudPullObjects(){
  const q = '&project_code=eq.' + encodeURIComponent(CLOUD.code);
  syncStep('房間／牆／樑／家具／相簿…');          // 🔴 需求 18 ①（第 4 階段）
  for(const store of OBJ_STORES){
    const rows  = await sbFetchAll(`/rest/v1/${store}?select=*${q}`, store);   // 🔴 R-44 翻頁
    SYNC.cloudObjRows += rows.length;           // 🔴 需求 19 ①
    const local = await lAllObj(store);
    const lmap  = new Map(local.map(x => [x.id, x]));

    for(const row of rows){
      const inc = fromRow(store, row);        // 欄位改名 ＋ fromMM() ＋ anchor 內的長度
      const cur = lmap.get(inc.id);
      /* 🔴 v0.1.9 §0c R-06：已永久刪除（墓碑）⇒ 本機刪掉，【無視時間戳】。
         理由：雲端 trigger 對墓碑一律「回舊列」，墓碑的 updated_at 可能比某台本機還舊
         ⇒ 走下面「晚的贏」的話，那台永遠不會知道它已經被永久刪除。 */
      if(inc.purgedAt){
        if(cur) await lDel(store, inc.id);
        continue;
      }
      if(!cur){
        if(inc.deletedAt) continue;           // ① 墓碑：本機沒有 → 不要把它生出來
        await lPutObj(store, Object.assign({}, inc, {synced:true, pending:false}));
        SYNC.added++;                         // 🔴 需求 18 ②：聯集發生時要說出多了幾筆
        continue;
      }
      /* 🔴 v0.09_i 需求 31：pending 不再是【絕對否決】。
         ⚠️ v0.04_i 需求 15 的規則② `if(cur.pending) continue` 是規格寫錯的：
            pending 只代表「還沒推上去」，【不代表「本機這份比較新」】
            ⇒ 一旦某一筆卡在 pending，它就【永遠】不接受雲端的任何更新
            ⇒ 兩台各自守著自己的版本，不會自己好，畫面也不會說
            實例：Ali 手機那間房間是【已軟刪除 ＋ pending】⇒ 雲端的活房間永遠拉不回來。
         ⇒ 改成一律照比 updatedAt——晚的贏（與本輪一貫的衝突規則一致）。
            本機 pending 且【較新】→ 不覆蓋（保護真正的離線編輯）
            本機 pending 且【較舊】→ 覆蓋，並清掉 pending／設 synced=true
                                     （那筆舊修改被判定為已被取代）
         ⚠️ 時間戳相同 → 不動本機（用 > 不用 >=，沿用 v0.04_i）。 */
      /* ══ 🔴🔴 v0.13_i 修二-b ＋ v0.14_i 補一｜新欄位的回填（放在「晚的贏」之前）══
         情境：Ali 兩台都已經 pull 過那 10 筆 room，本機有它們但【沒有 poly】
               （v0.1.4.5 的 fromRow 不認識這個欄位），而 updatedAt 與雲端【完全相等】
               ⇒ 走 `>` 這條比較 ⇒ 不覆蓋 ⇒ 🔴 poly 永遠下不來，10 個分區一個都不畫。
         ⚠️ 乾淨的開發機走的是 `!cur` 分支 ⇒ 一切正常 ⇒ 測試會【全綠】，只有她的機器會壞
            （obs O-13「本機儲存比程式活得久」＋ O-17「量具說謊」的合體）。
         ⇒ 規則：雲端有值、本機是 null／undefined 的欄位，無視時間戳補下來。
         🔴 但只限【白名單】（v0.14_i 補一）：判準是「使用者有沒有辦法把這個欄位清空」。
            有辦法清空 ⇒ 不可以進白名單 —— 這個 App 明訂「清空 ＝ null」，
            寫成通則會把【使用者清掉的價錢】當成版本落差長回來，並推回雲端。
            poly 目前沒有任何 UI 可以清空它 ⇒ 符合條件。
            ⚠️ 之後若做了「編輯分區形狀」，這一格要重新檢視；
               下一個新欄位（z_min／z_max／category／z_base）要【逐一判斷】，不可以自動加。 */
      /* 🔴 v0.1.10 批 3 自驗抓到：舊寫法每個欄位各寫一次 `Object.assign({}, cur, {[k]:…})`，
         而 cur 是迴圈前的快照 ⇒ 白名單有【兩個】欄位時，第二次寫入把第一個欄位蓋回空（O-44 同形）。
         v0.1.9 以前白名單只有 poly 一個，所以一直沒現形。⇒ 改成先改 cur、最後寫一次。 */
      let filled=false;
      for(const k of (BACKFILL[store] || [])){
        if(cur && cur[k]==null && inc[k]!=null){
          /* 🔴 不改 updatedAt、不動 pending／synced ——
             這不是一次「雲端比較新」的衝突，是【本機根本不知道有這個欄位】。 */
          cur[k]=inc[k]; filled=true;
        }
      }
      if(filled) await lPutObj(store, cur);
      if(!inc.updatedAt) continue;            // ③ 雲端沒時間戳 → 當最舊，不覆蓋
      if(store==='albums'){                   // 🔴 v0.1.10 P9 防呆：雲端的號不會從有變空；真的遇到就保留本機的
        if(inc.no==null && cur.no!=null) inc.no=cur.no;
        if(inc.color==null && cur.color!=null) inc.color=cur.color;
      }
      if(new Date(inc.updatedAt) > new Date(cur.updatedAt||0))
        await lPutObj(store, Object.assign({}, inc, {synced:true, pending:false,
          /* 🔴 v0.05_i §3（修三）：整筆覆蓋時 createdAt 要【保留】。
             雲端那一欄是 not null，正常一定有值；只有「雲端是舊列、沒有 created_at」
             這個情況才會回 null —— 那時用本機原本記得的，不要被 null 蓋掉。 */
          createdAt: inc.createdAt || cur.createdAt || null})); // ④ 晚的贏
    }
    // 🔴 ⑤ 這裡【沒有】「雲端沒有就刪本機」那一段。刪除一律走 deletedAt／purgedAt。
  }
  /* ⑥ 補推：本機還沒推成功的（pending）。
     ⚠️ 這一段是建造者依【規則②「等 push」】＋ 既有 ③ 補推（照片/標記）的對稱性補的，
        _i 需求 15 的函式本體沒有寫。若規格者認為不該有，砍掉這一個 for 即可。 */
  {
    let n=0;
    for(const store of OBJ_STORES)
      n += (await lAllObj(store)).filter(x=>x.projectCode===CLOUD.code && x.pending).length;
    if(n && !CLOUD.frozen) syncStep(`上傳 ${n} 筆…`);   // 🔴 需求 18 ①（第 6 階段）
  }
  await pushPendingObjects();                    // 🔴 v0.1.10 P7：與回前景共用同一支（O-34）
}
/* ╔═ 🔴 v0.1.10 P7（§2、§0d #3）｜補推：本機還沒推成功的（pending）════════════════════════════╗
   v0.1.9 只有 cloudPull 的 ③／⑥ 會補推 ⇒ 背景中推失敗的壓縮版與相簿列要等「重新整理或按同步」。
   現在同一支給兩個地方叫：cloudPull（照舊：錯誤記下、繼續推其他筆）與回前景 resumeUploads
   （opt.stopOnTransient：遇到網路錯／逾時就停，不要連打）。 ╚═══════════════════════════════════╝ */
async function pushPendingPhotos(opt){
  const stop=!!(opt && opt.stopOnTransient);
  for(const st of ['photos','markers']){
    for(const x of await lAll(st)){
      if(x.projectCode!==CLOUD.code || !x.pending) continue;
      try{ await (st==='photos' ? cloudPushPhoto(x.id) : cloudPushMarker(x.id)); }
      catch(e){ cloudErr(e); if(stop && e && e.transient) return false; }
    }
  }
  return true;
}
async function pushPendingObjects(opt){
  const stop=!!(opt && opt.stopOnTransient);
  for(const store of OBJ_STORES){
    for(const x of await lAllObj(store)){
      if(x.projectCode!==CLOUD.code || !x.pending) continue;
      try{ await cloudPushObj(store,x.id); }
      catch(e){ cloudErr(e); if(stop && e && e.transient) return false; }
    }
  }
  return true;
}
let _pushBusy=false;
async function pushPending(opt){
  if(!CLOUD.on || !CLOUD.code || CLOUD.frozen || _pushBusy) return false;
  _pushBusy=true;
  try{
    /* 照片先（album_photo 指著它）；照片停了就不推物件（多半是網路斷了） */
    if(!(await pushPendingPhotos(opt))) return false;
    return await pushPendingObjects(opt);
  }finally{ _pushBusy=false; }
}
/* 回到前景／從 bfcache 回來／網路恢復 ⇒ 接著傳（不跑整個同步：那會重新拉全部資料）。10 秒最多一次。 */
const RESUME_GAP_MS = 10000;
let _resumeAt=0;
function resumeUploads(why){
  if(!CLOUD.on || !CLOUD.code || CLOUD.frozen || CLOUD.busy) return false;
  if(document.visibilityState==='hidden') return false;
  const now=Date.now();
  if(now-_resumeAt < RESUME_GAP_MS) return false;
  _resumeAt=now;
  (async()=>{
    try{ await pushPending({stopOnTransient:true}); }catch(e){ cloudErr(e); }
    _origStalled=false;
    kickOrigQueue();
    try{ await flushPendingDel(); }catch(e){ cloudErr(e); }
    refreshTop();
    if(S.tab==='photo'){ try{ await reloadObjects(); renderAlbums(); }catch(e){} }
  })();
  return true;
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) resumeUploads('visible'); });
window.addEventListener('pageshow',()=>resumeUploads('pageshow'));
window.addEventListener('online',()=>resumeUploads('online'));

/* ── 拉：雲端 → 本機 ── */
async function cloudPull(){
  if(!CLOUD.on) return;
  syncStep('確認身分…');                       // 🔴 需求 18 ①（第 1 階段）
  /* 🔴 R-1：先確認身分，再談同步。
     ⚠️ 這一步失敗就【中止】——下面有刪除傳播迴路（照片線），
        身分不對時它會把「讀不到」誤讀成「別台刪了」，然後刪掉本機。 */
  if(!await cloudVerifyMember())
    throw new Error(`這台的身分不在專案 ${CLOUD.code} 裡（身分可能已變更）。`
      +`為避免誤刪本機資料，同步已中止，一筆都沒有刪。請按「重新連線」。`);
  /* 🔴 §0c R-15：資料版本號（只讀）。在任何補推之前判斷要不要停推。 */
  {
    const prow=await cloudFetchProjectRow();
    CLOUD.frozen = !!(prow && prow.data_ver!=null && Number(prow.data_ver) > DATA_VER);
  }
  const q='&project_code=eq.'+encodeURIComponent(CLOUD.code);

  // ① 照片
  syncStep('照片清單…');
  const rows=await sbFetchAll('/rest/v1/photos?select=*'+q, '清單');   // 🔴 R-44 翻頁
  SYNC.photoTotal=rows.length;
  SYNC.cloudPhotoRows=rows.length;             // 🔴 需求 19 ①：雲端到底有沒有東西
  const local=await lAll('photos');
  const lmap=new Map(local.map(x=>[x.id,x]));
  for(const row of rows){
    /* 🔴 需求 18 ①（第 2 階段）：逐張下載時要動，不然她只看到「停住好久」 */
    SYNC.photoDone++;
    syncStep(`照片 ${SYNC.photoDone}/${SYNC.photoTotal}…`);
    const cur=lmap.get(row.id);
    if(cur && (cur.small||cur.orig)){
      /* ╔═ 🔴🔴 v0.22_i §0b R-03 ①（A-3）｜檔案有就不重下載，但【欄位照 updatedAt 晚的贏】═══╗
         舊寫法：本機有檔就整筆跳過 ⇒ A 台傳完原檔（has），B 台的橘條【永遠不消失】（相-32）。
         🔴 而且舊寫法對 !synced 的照片會【順手清掉 pending】⇒ R-03 ③ 剛標上的待推
            （例如搬家蓋的 albumVer）還沒推就被當成「已同步」（批 2 施工紀錄已記這一條必修）。
         新規則（與物件表同一套）：
           本機 pending 且較新　⇒ 不覆蓋、pending 留著（③ 補推會送上去）
           雲端較新（或本機沒有 updatedAt）⇒ 只覆蓋【雲端認得的欄位】（photoFromRow），
                                              本機的 Blob 與本機專用欄位不動；pending 清掉
           一樣新　⇒ 視為已同步 ╚══════════════════════════════════════════════════════════╝ */
      const inc=photoFromRow(row);
      const tC=Date.parse(inc.updatedAt||'')||0, tL=Date.parse(cur.updatedAt||'')||0;
      let changed=false;
      if(cur.projectCode!==CLOUD.code){ cur.projectCode=CLOUD.code; changed=true; }
      if(cur.pending && tL>tC){
        if(!cur.storagePath && inc.storagePath){ cur.storagePath=inc.storagePath; changed=true; }
      }else if(tC>tL || !cur.updatedAt){
        Object.assign(cur, inc); cur.pending=false; cur.synced=true; changed=true;
      }else if(!cur.synced || cur.pending){
        cur.synced=true; cur.pending=false;
        cur.storagePath=cur.storagePath||inc.storagePath; changed=true;
      }
      if(changed) await lPut('photos',cur);
      continue;
    }
    const f=await sbFetch('/storage/v1/object/photos/'+row.storage_path);
    if(!f.ok) continue;                          // 檔案還沒到 → 下次再拉
    const blob=await f.blob();
    const inc=photoFromRow(row);
    await lPut('photos',Object.assign({ id:row.id, source:'雲端',
      rawW:row.width, rawH:row.height,
      decoded:true, orientation:null, rotated:false, oriBy:null, err:null,
      appVer:APP_VER+'（雲端）', small:blob,
      projectCode:CLOUD.code, synced:true, pending:false }, inc, {
      origSize: inc.origSize || blob.size, smallSize: inc.smallSize || blob.size,
      addedAt: inc.addedAt || nowISO() }));
    SYNC.added++;                              // 🔴 需求 18 ②：要說出「新增 N 筆」
  }
  /* 🔴 照片段落的「雲端沒這個 id → lDel」【一行不動】（需求 15 留什麼）。
     理由：照片沒有 deletedAt 欄位，它只能用「消失」表達刪除（v0.1.9 的永久刪除也靠它傳播，§0b Q-4）。
     ⚠️ 這是兩套刪除語言並存，【刻意的】，不要統一。
     🔴 v0.1.9 R-44：rows 已經翻頁拿全 ⇒ 這裡的「沒有」才是真的沒有。 */
  const rid=new Set(rows.map(r=>r.id));
  for(const x of local)
    if(x.synced && x.projectCode===CLOUD.code && !rid.has(x.id)) await lDel('photos',x.id);

  // ② 標記（v0.1.9：只讀，搬家用）
  syncStep('標記…');                            // 🔴 需求 18 ①（第 3 階段）
  let mrows=null;
  try{ mrows=await sbFetchAll('/rest/v1/markers?select=*'+q, '標記'); }catch(e){ mrows=null; }
  if(mrows){
    const lm=await lAll('markers');
    const lmm=new Map(lm.map(x=>[x.id,x]));
    for(const row of mrows){
      const cur=lmm.get(row.id);
      /* 🔴 v0.1.9：本機也存 updatedAt（搬家「同一張有兩個標記取較新的」靠它，兩台才會選同一個）。 */
      if(cur && cur.x===row.x && cur.y===row.y && cur.synced
         && (cur.updatedAt||null)===(row.updated_at||null)) continue;
      const isNew=!cur;
      await lPut('markers',{ id:row.id, photoId:row.photo_id, x:row.x, y:row.y,
        updatedAt:row.updated_at||null,
        projectCode:CLOUD.code, synced:true, pending:false });
      if(isNew) SYNC.added++;
    }
    const mid=new Set(mrows.map(r=>r.id));
    for(const x of lm)
      if(x.synced && x.projectCode===CLOUD.code && !mid.has(x.id)) await lDel('markers',x.id);
  }

  // ③ 補推：本機有、雲端還沒有的（離線時拍的）
  {
    const pend=(await lAll('photos')).filter(x=>x.projectCode===CLOUD.code && x.pending)
      .concat((await lAll('markers')).filter(x=>x.projectCode===CLOUD.code && x.pending));
    if(pend.length && !CLOUD.frozen) syncStep(`上傳 ${pend.length} 筆…`);   // 🔴 需求 18 ①（第 5 階段）
  }
  await pushPendingPhotos();                     // 🔴 v0.1.10 P7：與回前景共用同一支（O-34）

  // ④ 🔴 需求 15：物件表（掛在照片與標記【之後】；v0.1.9 起含相簿兩張）
  await cloudPullObjects();
  /* ⑤ 🔴 v0.17_i 修八 ①：專案設定（樓高／專案名字）。
     🔴 排在四個 store 的迴圈【之外】，單獨呼叫一次（§0-6 A-1：它的形狀套不進那個迴圈）。 */
  await cloudPullProject();
  /* ⑥ 🔴 v0.1.9 §0b R-10：搬家掛在這裡（開 App 與手動〔🔄 同步〕都經過）。
     放在所有 pull 之後 ⇒ 另一台先搬好的相簿已經拉下來了，這台只補沒搬的。 */
  const moved = await migrateOldPhotos();
  /* 🔴 自驗抓到（B 台第一次同步）：搬家的推送是背景送的（saveAlbum／savePhoto 不等），
     cloudSync 緊接著數 pending ⇒ 畫面寫「⏳ 還有 6 筆沒上傳」，而它們其實正在上傳（O-18：狀態說錯）。
     ⇒ 有搬到東西，就在這裡【等】它們推完（重複推一次無害：upsert＋回傳列套用）。 */
  if(moved){
    for(const x of await lAll('photos'))
      if(x.projectCode===CLOUD.code && x.pending) await cloudPushPhoto(x.id).catch(e=>cloudErr(e));
    for(const st of ALBUM_STORES)
      for(const x of await lAllObj(st))
        if(x.projectCode===CLOUD.code && x.pending) await cloudPushObj(st,x.id).catch(e=>cloudErr(e));
  }
  /* ⑦ 🔴 v0.1.9 批 4：用量（每次同步重讀一次，給用量條與 95% 擋上傳用）＋ 原檔上傳佇列（背景；失敗寫在照片上，不擋同步結果）。 */
  await refreshUsage();
  kickOrigQueue();
  /* ⑧ 🔴 v0.1.9 批 7（🟠-3）：上次沒刪成的雲端檔（永久刪除／刪除雲端原檔留下的）每次同步重試 */
  await flushPendingDel().catch(e=>cloudErr(e));
}

/* 🔴 需求 37：狀態式那一行要用的兩個計數。
   ⚠️ M（pend）在 cloudSync 的【成功分支】現算，不沿用 cloudStat 開頭那個舊值（v0.11_i 修三）。 */
async function countPending(){
  let n=0;
  try{
    for(const x of await lAll('photos'))  if(x.pending) n++;
    for(const x of await lAll('markers')) if(x.pending) n++;
    for(const st of OBJ_STORES)
      for(const x of await lAll(st)) if(x.pending) n++;
  }catch(e){}
  return n;
}
/* 房間／家具用 lAllLive()（不含墓碑）。
   🔴 v0.1.9 R-41：同步結果改說「相簿 N、照片 N」——照片＝至少還在一本活的相簿裡的那些（推算）。 */
async function countLive(){
  const out={rooms:0, items:0, albums:0, photos:0};
  try{
    out.rooms  = (await lAllLive('rooms')).length;
    out.items  = (await lAllLive('items')).length;
    const albums=(await lAllObj('albums')).filter(x=>!x.deletedAt && !x.purgedAt);
    const alive=new Set(albums.map(a=>a.id));
    out.albums = albums.length;
    const ph=new Set((await lAllObj('album_photos'))
      .filter(x=>!x.deletedAt && !x.purgedAt && alive.has(x.albumId)).map(x=>x.photoId));
    out.photos = ph.size;
  }catch(e){}
  return out;
}
async function cloudSync(){
  if(!CLOUD.on || CLOUD.busy) return;
  CLOUD.busy=true; CLOUD.msg='';
  syncReset();
  $('newProjNote').hidden=true;
  if($('btnSync')) $('btnSync').disabled=true;    // 🔴 需求 18 ④：同步中不能連按
  cloudStat();
  let ok=false;
  try{ await cloudPull(); S.dataErr=''; ok=true; }
  catch(e){ cloudErr(e); S.dataErr=(e&&e.message)||String(e); }
  CLOUD.busy=false;
  if($('btnSync')) $('btnSync').disabled=false;
  /* 🔴 需求 18 ②③：完成／失敗都要有一行【帶時間】的結果。
     ⚠️ 失敗時的錯誤與歸屬句由 cloudStat() 照原樣輸出，這裡只給狀態行。 */
  if(ok){
    /* 🔴 需求 38：同步成功才寫入（失敗不寫）。語意＝「這台拉到雲端資料」的時間。 */
    LS.set('deco_lastsync', new Date().toISOString());
    /* 🔴 需求 37（＋v0.11_i 修三）：改成【狀態式】——說現在是什麼樣子，
       不是「剛剛搬了幾筆」。她問的是「我那兩件家具到底上去了沒」。
       🔴 M（pend）必須在 cloudPull() 【結束之後】重算，不可以沿用先前的值，否則會說謊。 */
    const m = await countPending();
    const c = await countLive();
    let line2;
    if(CLOUD.msg){
      /* 🔴 v0.11_i 修三：這一輪有任何錯誤被 cloudErr 記下 ⇒ 不准說「一致」。
         一致是一個【承諾】；有錯誤還承諾一致，比不承諾更糟。 */
      line2 = `<span class="er">⚠️ 同步完成，但有錯誤（下方有詳細訊息）</span>`;
    }else if(m > 0){
      line2 = `<span class="er">⏳ 還有 <b>${m}</b> 筆沒上傳</span>`;
    }else{
      /* 🔴 v0.1.9 R-41：相簿 N、照片 N（照片＝還在某一本活相簿裡的那些） */
      line2 = `雲端與這台一致　房間 <b>${c.rooms}</b>、家具 <b>${c.items}</b>、相簿 <b>${c.albums}</b>、照片 <b>${c.photos}</b>`;
    }
    syncProg(`<span class="done">✅ 同步完成</span>　${hhmm()}<br>`+line2
      + (SYNC.added? `<br>這次從雲端拿到 <b>${SYNC.added}</b> 筆` : ''));
  }else{
    syncProg(`<span class="fail">🔴 同步失敗</span>　${hhmm()}`);
  }
  /* ⚠️ 需求 15 邊界：pull 結束後呼叫【一次】render() ＋ buildList()，
     不要每寫一筆就重畫。 */
  await reloadObjects();                          // 🗂 v0.1.9：loadMarkers 拿掉（平面圖不再畫舊標記）
  render(); buildList(); syncSel(); refreshTop(); renderPhotos();
  /* 🔴 v0.17_i 修八：樓高／專案名字是【設定頁】上的欄位。她很可能就站在那一頁按同步，
     而那一頁的欄位只有 refreshProj() 會重填 ⇒ 不補這一行的話，拉下來了但畫面沒變
     ⇒ 又變成「看不出有沒有同步到」（O-18）。 */
  if(S.tab==='proj') await refreshProj();
  /* 🔴 需求 19 ①：雲端這個代碼下【四張表 ＋ photos 全部 0 筆】＝ 這是一個新專案。
     ⚠️ 不阻擋，只提醒（她可能真的要開新專案）。
        邊界：雲端有照片但沒有物件 → 不算新專案（所以兩個計數要一起看）。
     🔴 這是 obs_環境與既有狀態的落差那條坑的【第四次變形】：
        用「什麼都沒有」表達「你不在你以為的地方」。 */
  if(ok && CLOUD.on && SYNC.cloudPhotoRows===0 && SYNC.cloudObjRows===0){
    const n=$('newProjNote');
    n.innerHTML = `⚠️ <b>這是一個新的專案</b>，雲端目前沒有任何東西。<br>`
      +`如果你是要連到既有專案，請檢查代碼有沒有打錯：`
      +`<b class="codetxt">${esc(CLOUD.code||'')}</b>`;
    n.hidden=false;
  }
  cloudStat();
}

/* ══════════════════════════════════════════════════════════════
   🔴 需求 19 ②｜記住用過的專案代碼（最多 5 組）
   理由：Ali 這次就是【手打錯】的（ALI_WUNDAWU vs ALI_WUNDAUW），
        一整輪跨裝置測試因此作廢。點一下填入 ⇒ 不必再手打。
   ⚠️ 邊界（v0.06_i §4）：清單裡要能【刪除單筆】——
      否則打錯的那個代碼會一直留在清單裡誘惑人點。
   ══════════════════════════════════════════════════════════════ */
const CODES_KEY='deco_codes';
function codesGet(){
  try{ const a=JSON.parse(LS.get(CODES_KEY)||'[]'); return Array.isArray(a)?a:[]; }
  catch(e){ return []; }
}
function codesSave(a){ LS.set(CODES_KEY, JSON.stringify(a.slice(0,5))); }
function codesAdd(code){
  if(!code) return;
  const a=codesGet().filter(x=>x!==code);
  a.unshift(code);                      // 最近用過的排最前
  codesSave(a); renderCodes();
}
function codesDel(code){
  codesSave(codesGet().filter(x=>x!==code)); renderCodes();
}
function renderCodes(){
  const box=$('codeList'); if(!box) return;
  box.innerHTML='';
  for(const c of codesGet()){
    const chip=document.createElement('span'); chip.className='codechip';
    const pick=document.createElement('button'); pick.className='pick codetxt';
    pick.textContent=c;
    pick.title='填入這個代碼';
    pick.onclick=()=>{ $('pcode').value=c; };
    const del=document.createElement('button'); del.className='del';
    del.textContent='✕'; del.title='從清單移除';
    del.onclick=()=>codesDel(c);
    chip.appendChild(pick); chip.appendChild(del);
    box.appendChild(chip);
  }
}

/* ── 連線 / 離開 / 狀態 ── */
async function cloudJoin(){
  const raw=($('pcode').value||'').trim().toUpperCase();
  if(raw.length<4){ CLOUD.msg='專案代碼至少 4 個字'; cloudStat(); return; }
  CLOUD.busy=true; CLOUD.msg=''; cloudStat();
  try{
    const code=await joinProject(raw);
    CLOUD.code=code; CLOUD.on=true;
    LS.set('deco_code',code);
    codesAdd(code);                       // 🔴 需求 19 ②：記住它，下次不必手打
    $('pcode').value=code;
    /* 這台既有的本機照片：歸到這個 project 底下並推上去
       ⚠️ 只認 projectCode 為空的（沒有被別的代碼認領過的），不搶別人的 */
    for(const x of await lAll('photos'))
      if(!x.projectCode){ x.projectCode=code; x.pending=true; await lPut('photos',x); }
    for(const x of await lAll('markers'))
      if(!x.projectCode){ x.projectCode=code; x.pending=true; await lPut('markers',x); }
    /* ══ 🔴 v0.05_i §2（修二）：離線建立的【物件】也要被認領 ══
       v0.04_i 需求 15「留什麼」原本寫「cloudJoin 一行不改」⇒ 建造者依規格沒動
       ⇒ 未連線時建的房間／家具 projectCode 永遠是 null
       ⇒ cloudPushObj 第一行 `o.projectCode!==CLOUD.code` 就 return ⇒ 連線後也推不上去。
       v0.05_i 把那一條改成「cloudJoin 只准【加一段物件認領】」。
       ⚠️ 刻意【不】改寫上面照片與標記那兩段，也【不】把三者合併成一個泛用迴圈——
          照片與物件的欄位形狀不同（照片走 lPut，物件要走 lPutObj 做單位換算），
          合併會讓下一手看不出哪個是哪個。 */
    for(const store of ['rooms','walls','beams','items','albums','album_photos']){
      for(const x of await lAllObj(store)){
        if(x.projectCode) continue;          // 已屬於某個專案 → 不動（不搶別人的）
        if(x.deletedAt)   continue;          // 🔴 垃圾桶裡的不認領（避免把墓碑推上去）
        /* 🔴 邊界：認領到一道 state='existing' 的牆 ——修一之後前台不會造出這種牆，
           但若真的遇到（例如手動塞的測試資料），插入必被 RLS 擋（42501）。
           ⇒ 跳過不認領，並留一筆錯誤在狀態列（_d §10-0b：狀態與錯誤必留）。 */
        if(store==='walls' && x.state==='existing'){
          cloudErr(new Error(`有一道既有牆（state=existing）無法認領進專案 ${code}：`
            +`既有牆只能由後台匯入。這一道留在本機，不會上傳。`));
          continue;
        }
        x.projectCode = code;
        x.pending     = true;                // 標成待推，交給 cloudPullObjects() 的 ⑥ 補推
        await lPutObj(store, x);             // ⚠️ 逐筆寫入、不做交易（與需求 5 甲同一個模式）
      }
    }
  }catch(e){ CLOUD.on=false; cloudErr(e); CLOUD.busy=false; cloudStat(); return; }
  CLOUD.busy=false;
  await cloudSync();
}
function cloudLeave(){
  CLOUD.on=false; CLOUD.code=null; CLOUD.msg='';
  LS.del('deco_code');
  /* 🔴 v0.22_i R-52（甲）：行為不變（本機資料留著＝刻意設計），只補清兩個【遺漏】：
     · deco_lastsync　不清的話，離開後加入別的代碼會顯示「舊專案」的上次同步時間（相-36）
     · reidentified　 「身分已過期、已重新加入」那一句是上一次連線期間的事，不該帶到下一次
     （前·規格刀 v0.1.4.5 就指出過；報告：_關卡報告/建造者檢查_登出與測試專案設定_opus_20260930.md） */
  LS.del('deco_lastsync');
  CLOUD.reidentified=false;
  syncProg(''); $('newProjNote').hidden=true;
  cloudStat(); refreshTop(); renderPhotos();
  /* ⚠️ 刻意【不刪】本機資料——離開只是停止同步，不是清空這台 */
}

/* 🔴 需求 13：cloudStat() 的【狀態】與【錯誤與歸屬】文字一字不改，只換輸出目標
   （.cloudbar → 頂列徽章 ＋ 同步對話框）。
   ⚠️ 已刪：未連線時那兩行【說明文字】（依 _d §10-0b，不搬）。 */
/* 🔴 需求 36-2：本機有多少筆「屬於別的專案代碼」的東西（改完之後它們會永遠不同步，
   而那正是 obs O-18 的形狀——不說出來就是把會報錯的坑換成不會報錯的坑）。
   ⚠️ v0.11_i 修二：要掃【六個】store，含 photos／markers，否則孤兒照片會完全看不見。
   ⚠️ 含已軟刪除的（墓碑也還在推）。
   ⚠️ 這裡只【數】，不動任何一筆——cloudJoin 的認領邏輯一行不改（N-169）。 */
const ORPHAN_STORES = ['rooms','walls','beams','items','photos','markers','albums','album_photos'];   // 🔴 v0.1.9 R-04
async function countOrphans(){
  if(!CLOUD.on || !CLOUD.code) return 0;
  let n=0;
  try{
    for(const st of ORPHAN_STORES)
      for(const x of await lAll(st))
        if(x.projectCode != null && x.projectCode !== CLOUD.code) n++;
  }catch(e){ return 0; }
  return n;
}
/* 🔴 需求 38：上次【這台拉到雲端資料】的時間。
   ⚠️ 不是「雲端最後被改的時間」——兩者不同，文案不可寫成後者。 */
function lastSyncDate(){
  const s=LS.get('deco_lastsync'); if(!s) return null;
  const d=new Date(s); return isNaN(d.getTime())? null : d;
}
function lastSyncLabel(){
  const d=lastSyncDate();
  if(!d) return '還沒同步過';                    // 🔴 不要顯示空白或 --:--
  const z=x=>String(x).padStart(2,'0');
  return `${z(d.getMonth()+1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
function isStale(){
  const d=lastSyncDate();
  if(!d) return true;                            // 從來沒同步過 ⇒ 也算舊的
  return (Date.now()-d.getTime()) > STALE_MIN*60*1000;
}
async function cloudStat(){
  const box=$('cstat');
  if(!box) return;
  let pend=0;
  try{ for(const x of await lAll('photos')) if(x.pending) pend++;
       for(const x of await lAll('markers')) if(x.pending) pend++;
       for(const st of ['rooms','walls','beams','items','albums','album_photos'])
         for(const x of await lAll(st)) if(x.pending) pend++; }catch(e){}
  const orphan = await countOrphans();
  $('syncDlg').classList.toggle('blocked', !!CLOUD.blocked);
  $('btnJoin').textContent = CLOUD.on?'重新連線':'連線';
  /* 🔴 需求 23：〔離開專案〕整區（含分隔線）一起顯示／隱藏 */
  $('leaveRow').hidden = !CLOUD.on;
  $('btnSync').hidden  = !CLOUD.on;
  let html;
  if(CLOUD.blocked){
    html = `<span class="er">🔴 這個環境擋住了對外連線</span><br>`+
      `Artifact 頁面有安全政策（CSP），只允許連少數幾個網址，`+
      `<b>連不到資料庫，而且不會有錯誤提示</b>。<br>`+
      `⚠️ <b>這不是程式的問題，是頁面被放在哪裡的問題。</b><br>`+
      `→ 正解：把本檔放到 GitHub Pages 當網頁開。`+
      `步驟見 <code>階段B_放上網_20260908.md</code>`;
  }else if(CLOUD.on){
    /* ⚠️ 文字一字不改（需求 13「留什麼」）；只給代碼那個 <b> 加等寬＋加寬字距的 class
       ——需求 19 ③，讓顛倒的字母看得出來。 */
    html = `<span class="on">✅ 已連線</span>　專案代碼 <b class="codetxt">${esc(CLOUD.code)}</b>`+
      `　這台的身分 <b>…${esc((CLOUD.uid||'').slice(-6))}</b><br>`+
      (CLOUD.busy? `⏳ 同步中…` : (pend? `⏳ 有 <b>${pend}</b> 筆還沒上傳` : `雲端與這台一致`))+
      /* 🔴 需求 38 ①：接在那一行後面，對話框一關也還記得（存在 localStorage）。 */
      `　上次同步 <b>${esc(lastSyncLabel())}</b>`+
      /* 🔴 需求 35-1：換身分是「資料歸屬會改變」的事件，不可以靜默。旗標，不是計數。 */
      (CLOUD.reidentified? `<br><span class="er">⚠️ 這台的身分已過期，已用專案代碼重新加入。資料沒有掉，但這台在雲端是一個新身分。</span>`:'')+
      /* 需求 34 邊界：這個環境沒給續期憑證 ⇒ 說出來，不要讓它安靜地每小時換一次身分。 */
      (CLOUD.noRefresh? `<br><span class="er">⚠️ 這個環境沒有給續期用的憑證，身分到期時會換成新的身分。</span>`:'')+
      /* 🔴 需求 36-2：孤兒資料必須看得見。N=0 整行不顯示。 */
      (orphan? `<br><span class="er">⚠️ 有 <b>${orphan}</b> 筆資料屬於別的專案代碼，不會同步。</span>`:'')+
      (CLOUD.reauth? `<br><span class="er">⚠️ 這次連線期間身分重新取得過 ${CLOUD.reauth} 次</span>`:'')+
      `<br>⚠️ 安全等級＝<b>知道代碼的人就看得到</b>。只放測試照片。`;
  }else{
    html = `<span class="off">未連線</span>　照片只存這台（行為與 v0.1.2.2 完全相同）`;
  }
  if(CLOUD.frozen) html += `<br><span class="er">⚠️ ${esc(FROZEN_MSG)}</span>`;   // 🔴 v0.1.9 R-15
  if(CLOUD.msg) html += `<br><span class="er">⚠️ ${esc(CLOUD.msg)}</span>`;
  box.innerHTML = html;
  refreshTop(pend);
}
/* 需求 13：頂列徽章。未連線 → 「未連線」（中性色），仍可點。
   連線被擋 → 紅色「⚠️ 連線被擋」，點了在對話框內顯示完整錯誤與歸屬句。 */
function refreshTop(pend){
  const b=$('btnCode'); if(!b) return;
  b.classList.remove('off','er');
  if(CLOUD.blocked){ b.classList.add('er'); b.textContent='⚠️ 連線被擋'; }
  else if(CLOUD.on){
    /* 🔴 需求 38 ②：這一處才是關鍵——Ali 困惑那次【根本沒打開同步對話框】。
       已連線且超過 STALE_MIN 分鐘沒同步 → 加一個橘點，點進去看得到時間。
       ⚠️ 只加一個點，不動版面、不動尺寸。 */
    b.innerHTML='✅ '+esc(CLOUD.code||'')
      + (isStale()? ` <span style="color:var(--warnA)">●</span>` : '');
    /* 🔴 v0.20_i 下-18（_d §13-47）：這一顆改用 --warnA（橘）。
       Ali 原話：「我覺得那是提醒不是錯誤」——「超過 30 分鐘沒同步」不是錯誤，是提醒。
       ⚠️ cloudStat() 裡【真正的錯誤】仍然用 --warnB，一行不改。 */
  }
  else { b.classList.add('off'); b.textContent='未連線'; }
  const t=$('appTitle');
  if(t) t.textContent =
      S.tab==='list' ? '清單'
    : S.tab==='photo'? '相簿'
    : S.tab==='proj' ? '專案'
    : S.tab==='cost' ? '估價'
    : S.tab==='layout'?'格局'
    : '平面圖';
  /* 🔴 v0.20_i 下-16：原本拿【陣列的第一個】房間的名字 —— 不是她選的、不是畫面中心的、
     也不是最近用的 ⇒ 無效指引（v0.1.6 就這樣，不是 v0.1.7 做出來的）。
     📌 這個位置的未來用途已定（_d §13-79）：放 PROJECT.name，語意是「這一套擺設叫什麼」。
     🛑 本批不做那個切換器，只把無效指引拿掉、位置留著。 */
}
/* 🔴 v0.11_i 修四｜需求 38 的橘點要有東西去觸發它。
   refreshTop() 全部是事件驅動；App 開著不動時，30 分鐘到了不會有人去重算 ⇒ 做了等於沒做。
   三個時機：① 從背景切回來（本行）② setTab() 切分頁（既有，已呼叫 refreshTop）
             ③ 每次同步結束（既有）。
   ⚠️ 刻意【不用】setInterval：手機背景計時器不可靠，而且會在沒人看的時候空轉。 */
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refreshTop(); });
$('btnJoin').onclick  = cloudJoin;
$('btnLeave').onclick = cloudLeave;
$('btnSync').onclick  = cloudSync;
$('pcode').addEventListener('keydown',e=>{ if(e.key==='Enter') cloudJoin(); });
$('btnCode').onclick  = openSyncDialog;
$('btnCloseSync').onclick = ()=>{ $('ovSync').hidden=true; };
$('ovSync').addEventListener('click',e=>{ if(e.target.id==='ovSync') $('ovSync').hidden=true; });
function openSyncDialog(){ $('ovSync').hidden=false; cloudStat(); syncProg(''); }
/* 🔴 需求 16：專案頁要有出口。
   ① 進來之前記住上一個分頁；「‹ 返回」回到那裡（不是一律回平面圖）
   ② 齒輪做成【開關】：已經在專案頁時再點一次 ＝ 返回（Ali 的直覺反應就是這個）
   邊界：重新載入後第一次進來 → S.prevTab 沒有值 → 回平面圖，不卡住。 */
function openProjectPage(){
  if(S.tab==='proj'){ closeProjectPage(); return; }      // ② 齒輪開關
  S.prevTab = S.tab;
  setTab('proj');
}
function closeProjectPage(){ setTab(S.prevTab || 'plan'); }
$('btnGear').onclick = openProjectPage;
$('btnProjBack').onclick = closeProjectPage;
$('btnOpenSync').onclick = openSyncDialog;

async function cloudInit(){
  renderCodes();                        // 🔴 需求 19 ②：用過的代碼清單
  const code=LS.get('deco_code');
  if(!code){ cloudStat(); return; }
  $('pcode').value=code;
  try{
    await signInAnon();
    /* ⚠️ 需求 34 的副作用（已知、刻意接受，v0.11_i 修五）：
       身分留住之後，「每小時換身分順便重新加入專案」這個自我修復會消失。
       membership 的修復點改為 cloudInit()（每次開 App 一次，冪等）。
       ⇒ 若在 App 開著的期間於後台改動 members，畫面不會自動修復，
          要重新整理。這是取捨，不是缺陷。 */
    CLOUD.code=await joinProject(code);   // 冪等：已加入就什麼都不做
    CLOUD.on=true;
  }catch(e){ CLOUD.on=false; cloudErr(e); }
  cloudStat();
}

/* ══════════════════════════════════════════════════════════════
   需求 13｜專案頁（整理）
   ══════════════════════════════════════════════════════════════ */
$('btnClearPlace').onclick = async ()=>{
  const ok=await askDialog({title:'清擺設',
    body:'所有項目會變成「未擺放」。<b>項目本身、尺寸、價錢、備註都留著</b>，上次擺的位置也記得。',
    okText:'清擺設'});
  if(!ok) return;
  await clearPlacement();
  render(); buildList(); syncSel(); await refreshProj();
};
$('btnClearAll').onclick = async ()=>{
  /* 🔴 v0.14_i 補七 N-10b（obs O-18 規則①的落地）：
     按下刪除之前就要看見「保留幾間房」——若補二（poly 回填）失敗，X 會是 0，
     她在按下去之前就看得到。這是本批最便宜的一道防線（一行字串）。 */
  const keepRooms=ROOMS.filter(isHouseRoom).length;
  const keepWalls=WALLS.filter(isHouse).length;
  const keepBeams=BEAMS.length;
  const killRooms=ROOMS.length-keepRooms, killWalls=WALLS.length-keepWalls;
  const ok=await askDialog({title:'清清單',
    body:`將清掉 <b>${FURN.length}</b> 件家具`+
         (killRooms||killWalls? `，以及你自己建的 ${killRooms} 間房、${killWalls} 道牆`:'')+
         `；<br>保留 <b>${keepRooms}</b> 間房、<b>${keepWalls}</b> 道牆、<b>${keepBeams}</b> 根樑。<br>`+
         `<b>房子（牆、樑、分區）留著，只清掉你擺的東西。</b><br>`+
         `清掉的會進垃圾桶。<b>相簿與照片不受影響。</b>`,
    okText:'清清單'});
  if(!ok) return;
  await clearAll();
  select(null);
  render(); buildList(); syncSel(); refreshTop(); await refreshProj();
};
