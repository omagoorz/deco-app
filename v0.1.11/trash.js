"use strict";
/* ══════════════════════════════════════════════════════════════
   🔴🔴 v0.1.9 批 7｜垃圾桶頁＋永久刪除＋原檔管理（_i §8-4、§9-4；§0b R-05～R-08、R-18；§0c R-46、R-47、🟠-3、🟠-6、🟡-12）
   這是本版【唯一會刪掉雲端檔案】的一段。規則寫死在這裡，畫面只呼叫：
   · 垃圾桶＝六張表（房間／牆／樑／家具／相簿／相簿裡的一張）裡 deletedAt 有值、purgedAt 沒值的列
     一次刪除＝同一個 batchId ＝ 垃圾桶一行（舊版刪的沒有 batchId ⇒ 一筆一行）
   · 保留 183 天（R-18）；🔴 拿掉「超過 20 筆刪最舊」
   · 永久刪除＝寫 purgedAt（墓碑，推上雲端讓別台也刪）→ 本機 lDel；
     照片本身：沒有任何未永久刪除的 album_photo 指著它 ⇒ RPC purge_photo（雲端再查一次引用）⇒ 刪 Storage 兩個檔
   · 雲端檔案誰刪（§8-4 🔍）：【按下永久刪除的那一台】（或到期時連線中的那一台）。
     別台只從同步知道：墓碑 ⇒ lDel；照片列不見 ⇒ lDel。沒有任何一台會把它插回去：
       物件表靠 purged_at trigger（回舊列）、照片靠 photo_purged 墓碑（BEFORE INSERT 回 null）。
   · 有專案代碼但沒連上 ⇒〔永久刪除〕灰掉並寫原因（🟠-6：離線只刪本機，別台垃圾桶會永遠還看得到）；
     沒有專案代碼（純本機）⇒ 照本機規則直接刪。到期清理：離線只清本機列、不碰雲端檔案（R-08）。
   ══════════════════════════════════════════════════════════════ */
const TRASH_DAYS = 183;
const DAY_MS = 24*3600*1000;
const TRASH_STORES = ['rooms','walls','beams','items','albums','album_photos'];
const TRASH_KIND = { rooms:'struct', walls:'struct', beams:'struct', items:'item', albums:'album', album_photos:'photo' };
const TRASH_FILTERS = [ ['all','全部'], ['photo','照片'], ['album','相簿'], ['item','家具'], ['struct','房間・牆・樑'] ];
const SAVER = { rooms:saveRoom, walls:saveWall, beams:saveBeam, items:saveItem, albums:saveAlbum, album_photos:saveAlbumPhoto };
/* 🔧 到期測試用的「現在時間」開關（localStorage deco.nowFake＝ISO）。開著時診斷列會寫出來（O-18：測試狀態不可以長得跟真的一樣）。 */
function nowMs(){
  const f=LS.get('deco.nowFake'); const t=f?Date.parse(f):NaN;
  return isFinite(t) ? t : Date.now();
}
const nowFakeOn = ()=> { const f=LS.get('deco.nowFake'); return !!(f && isFinite(Date.parse(f))); };
/* 剩幾天（取這一行裡最早刪的那一筆 ⇒ 最先到期） */
const daysLeft = iso => Math.max(0, Math.ceil((Date.parse(iso) + TRASH_DAYS*DAY_MS - nowMs()) / DAY_MS));

/* 把垃圾桶整理成「行」：[{key, batchId, rows:[{store,o}], at, kinds:Set}]，最近刪的在上 */
async function trashGroups(){
  const map=new Map();
  for(const st of TRASH_STORES){
    for(const o of await lAllObj(st)){
      if(!o.deletedAt || o.purgedAt) continue;
      const key = o.batchId ? 'b:'+o.batchId : 'r:'+st+':'+o.id;
      let g=map.get(key);
      if(!g){ g={key, batchId:o.batchId||null, rows:[], at:o.deletedAt, last:o.deletedAt, kinds:new Set()}; map.set(key,g); }
      g.rows.push({store:st, o});
      g.kinds.add(TRASH_KIND[st]);
      if(String(o.deletedAt) < String(g.at))   g.at=o.deletedAt;
      if(String(o.deletedAt) > String(g.last)) g.last=o.deletedAt;
    }
  }
  return [...map.values()].sort((a,b)=>String(b.last).localeCompare(String(a.last)));
}
async function trashSize(){ return (await trashGroups()).length; }

/* 一行的文字（人話）。相簿名／照片名讀本機全部列（含垃圾桶）。 */
function trashLabel(g, allAlbums){
  const by=st=>g.rows.filter(r=>r.store===st).map(r=>r.o);
  const alb=by('albums'), aps=by('album_photos'), rooms=by('rooms'), walls=by('walls'), beams=by('beams'), items=by('items');
  const aName=id=>{ const a=allAlbums.get(id); return albName(a); };
  const parts=[];
  if(alb.length){
    const inAlb=aps.filter(ap=>alb.some(a=>a.id===ap.albumId)).length;
    parts.push((alb.length===1 ? `相簿「${albName(alb[0])}」` : `${alb.length} 本相簿`)
               + `（${inAlb ? inAlb+' 張照片' : '空相簿'}）`);
  }
  const loose=aps.filter(ap=>!alb.some(a=>a.id===ap.albumId));
  if(loose.length){
    const albs=[...new Set(loose.map(ap=>ap.albumId))];
    parts.push(loose.length===1
      ? `照片「${loose[0].name||'未命名'}」（從「${aName(loose[0].albumId)}」拿掉）`
      : `${loose.length} 張照片（從 ${albs.length===1 ? '「'+aName(albs[0])+'」' : albs.length+' 本相簿'}拿掉）`);
  }
  if(rooms.length) parts.push(rooms.length===1 ? `房間「${rooms[0].name||'未命名'}」` : `${rooms.length} 間房`);
  if(walls.length) parts.push(`${walls.length} 道牆`);
  if(beams.length) parts.push(`${beams.length} 根樑`);
  if(items.length) parts.push(items.length===1 ? `家具「${items[0].name||'未命名'}」` : `${items.length} 件家具`);
  return parts.join('、');
}

/* ── 還原（§8-4）──
   · 回原位：deletedAt 清掉、寫 restoredAt（雲端 trigger 靠它分辨「真的按了還原」與離線編輯，§0c R-06）
   · 同一本同一張已經有活的一筆（R-09 唯一鍵）⇒ 略過那一筆並說一句
   · 排序被占走 ⇒ 排最後
   · 還原「從某本拿掉」而那本相簿在垃圾桶 ⇒ 連那本相簿那一整行一起還原並說一句（🔍 建造者評估：採用）
     那本相簿已永久刪除／本機沒有 ⇒ 那一筆略過並說一句
   · 還原相簿時，它的照片有的在垃圾桶另一行／已永久刪除 ⇒ 還原後說「有 K 張已不在」
   · 房間：牆與樑同一行一起回來；家具維持「未指定房間」（F-2）
   回傳要說的話（陣列）。 */
async function restoreGroup(g, _depth){
  const msgs=[];
  const now=nowISO();
  const allAlb=new Map((await lAllObj('albums')).map(a=>[a.id,a]));
  /* ① 先處理「照片所在的相簿在垃圾桶」（同一行裡沒有那本相簿的） */
  const inRow=new Set(g.rows.filter(r=>r.store==='albums').map(r=>r.o.id));
  const needAlb=new Set();
  for(const r of g.rows){
    if(r.store!=='album_photos') continue;
    const a=allAlb.get(r.o.albumId);
    if(a && a.deletedAt && !a.purgedAt && !inRow.has(a.id)) needAlb.add(a.id);
  }
  if(needAlb.size && !_depth){
    const groups=await trashGroups();
    for(const aid of needAlb){
      const ag=groups.find(x=>x.rows.some(r=>r.store==='albums' && r.o.id===aid));
      if(ag && ag.key!==g.key){
        const m=await restoreGroup(ag, 1);
        msgs.push(`相簿「${albName(allAlb.get(aid))}」也在垃圾桶，已經連那本一起還原。`, ...m);
      }
    }
  }
  /* 還原後要重讀（上面可能剛還原了相簿） */
  const albNow=new Map((await lAllObj('albums')).map(a=>[a.id,a]));
  const live=(await lAllObj('album_photos')).filter(x=>!x.deletedAt && !x.purgedAt);
  let dup=0, gone=0;
  const back=new Set();                    // 這一趟剛還原的相簿（albNow 是還原前讀的）
  const order={rooms:0, walls:1, beams:2, albums:3, album_photos:4, items:5};   // 房間先於牆；相簿先於它的照片
  for(const r of g.rows.slice().sort((a,b)=>order[a.store]-order[b.store])){
    const o=await lGetObj(r.store, r.o.id);
    if(!o || o.purgedAt || !o.deletedAt) continue;
    if(r.store==='album_photos'){
      const a=albNow.get(o.albumId);
      if(!a || a.purgedAt || (a.deletedAt && !back.has(a.id))){ gone++; continue; }
      if(live.some(x=>x.albumId===o.albumId && x.photoId===o.photoId && x.id!==o.id)){ dup++; continue; }
      const sibs=live.filter(x=>x.albumId===o.albumId);
      if(sibs.some(x=>Number(x.sort)===Number(o.sort)))
        o.sort=(sibs.reduce((m,x)=>Math.max(m, Number(x.sort)||0), 0))+1;   // 排序被占走 ⇒ 排最後
      live.push(o);
    }
    if(r.store==='items' && o.anchor && o.anchor.type==='wall'
       && !(await lAllLive('walls')).some(w=>w.id===o.anchor.wall)){
      o.isPlaced=false;                   // 它貼的那道牆不在了 ⇒ 回清單（不留一件指向不存在的牆的家具）
    }
    o.deletedAt=null; o.batchId=null;
    if(r.store==='albums' || r.store==='album_photos') o.restoredAt=now;
    await SAVER[r.store](o);
    if(r.store==='albums') back.add(o.id);
  }
  /* ③ 還原相簿：它的照片有的沒回來（在垃圾桶另一行／已永久刪除）。
     🔴 自驗抓到：原本用「還原前」讀的清單算、而且巢狀那一層也算 ⇒ 外層接著還原的那張也被算成「不在」（說錯話，O-18）。
     ⇒ 只在最外層、全部還原完之後重讀再算；範圍＝這一行的相簿＋連帶還原的相簿。 */
  if(!_depth){
    const fresh=await lAllObj('album_photos');
    const albIds=new Set(g.rows.filter(x=>x.store==='albums').map(x=>x.o.id).concat([...needAlb]));
    for(const aid of albIds){
      const a=await lGetObj('albums', aid); if(!a || a.deletedAt || a.purgedAt) continue;
      const missing=fresh.filter(ap=>ap.albumId===aid && (ap.purgedAt || ap.deletedAt)).length;
      if(missing) msgs.push(`相簿「${albName(a)}」有 ${missing} 張照片已不在（在垃圾桶的另一行，或已永久刪除）。`);
    }
  }
  if(dup)  msgs.push(`有 ${dup} 張照片那本相簿裡已經有了，沒有重複加入。`);
  if(gone) msgs.push(`有 ${gone} 張照片的相簿已經不在（已永久刪除），沒有還原。`);
  return msgs;
}

/* ── 永久刪除 ── */
const PENDING_DEL_KEY='deco.pendingDel';
function pendingDelList(){ try{ const a=JSON.parse(LS.get(PENDING_DEL_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function setPendingDel(a){ if(a.length) LS.set(PENDING_DEL_KEY, JSON.stringify([...new Set(a)])); else LS.del(PENDING_DEL_KEY); }
/* 🔴 🟠-3：RPC 回傳的路徑先記進「待刪檔清單」，再刪；刪不掉的留著，每次同步重試。失敗要講（不可安靜）。
   刪完【再查一次】確認真的不在：DELETE 被政策擋下（還有照片列指著它）與「本來就不在」回的是同一個 404（O-17：量具說謊）。
   🔴 自驗抓到：查法不可以用「下載看看」—— 瀏覽器快取會回 206（檔案早就刪了、用量也降了，卻被判成還在，
      ⇒ 清單永遠清不掉、每次同步都說「還沒刪掉」）。⇒ 改用 Storage 的列表 API（查資料庫，不經快取）。 */
async function storageHas(path){
  const i=path.lastIndexOf('/'), dir=path.slice(0,i), name=path.slice(i+1);
  const r=await sbFetch('/storage/v1/object/list/photos',{method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({prefix:dir, search:name, limit:20})});
  if(!r.ok) throw new Error('查雲端檔案失敗：'+(await r.text()).slice(0,120));
  const j=await r.json();
  return Array.isArray(j) && j.some(x=>x && x.name===name);
}
let _delBusy=false;
async function flushPendingDel(){
  if(!CLOUD.on || _delBusy) return 0;
  let list=pendingDelList(); if(!list.length) return 0;
  _delBusy=true;
  try{
    const left=[];
    for(const path of list){
      try{
        await sbFetch('/storage/v1/object/photos/'+path,{method:'DELETE'});
        if(await storageHas(path)) left.push(path);      // 還在 ⇒ 沒刪掉（多半是還有照片列指著它）
      }catch(e){ left.push(path); }
    }
    setPendingDel(left);
    if(left.length) cloudErr(new Error(`有 ${left.length} 個雲端照片檔還沒刪掉（下次同步會再試）。`));
    return list.length-left.length;
  }finally{ _delBusy=false; }
}
/* 一筆寫成墓碑：有代碼且連線 ⇒ 等它推上去（推回來看到 purgedAt ⇒ applyPushedRow 會 lDel 本機）；
   沒有代碼 ⇒ 直接 lDel；有代碼沒連線 ⇒ 墓碑留在本機（pending），連線後補推（只有到期清理會走到這裡以外的路：它直接 lDel）。 */
async function purgeRow(store, o, now){
  o.purgedAt=now;
  stampObj(o); await lPutObj(store, o);
  if(!CLOUD.code || o.projectCode!==CLOUD.code){ await lDel(store, o.id); return; }
  if(CLOUD.on) await cloudPushObj(store, o.id);          // 失敗會丟錯 ⇒ 呼叫端停在這裡（照片不會先被刪）
}
/* 照片本身：沒有任何【未永久刪除】的 album_photo 指著它 ⇒ 刪。回傳 'gone'｜'inuse'｜'kept' */
async function purgePhotoIfUnused(photoId){
  const refs=(await lAllObj('album_photos')).filter(x=>x.photoId===photoId && !x.purgedAt);
  if(refs.length) return 'inuse';
  const p=await lGet('photos', photoId);
  if(!p){ return 'gone'; }
  if(!CLOUD.code || p.projectCode!==CLOUD.code){ await lDel('photos', photoId); return 'gone'; }
  if(!CLOUD.on) return 'kept';
  const r=await sbFetch('/rest/v1/rpc/purge_photo',{method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({p_id:photoId})});
  if(!r.ok) throw new Error('永久刪除照片失敗：'+(await r.text()).slice(0,200));
  const rows=await r.json();
  if(Array.isArray(rows) && rows.length){
    const paths=[rows[0].out_small, rows[0].out_orig].filter(Boolean);
    setPendingDel(pendingDelList().concat(paths));
    await lDel('photos', photoId);
    return 'gone';
  }
  /* 回 [] ：雲端沒有這一列（從來沒上傳）或雲端還有別的相簿在用 ⇒ 分辨一下 */
  const chk=await sbFetch('/rest/v1/photos?select=id&id=eq.'+photoId);
  const ex=chk.ok ? await chk.json() : [1];
  if(Array.isArray(ex) && !ex.length){ await lDel('photos', photoId); return 'gone'; }
  return 'inuse';
}
/* 永久刪除好幾行。opt.expire＝到期清理（離線時只清本機列）。回傳 {rows, photos, inuse, msgs} */
let _purgeBusy=false;
async function purgeGroups(groups, opt){
  if(_purgeBusy) return null;
  _purgeBusy=true;
  const out={rows:0, photos:0, inuse:0, msgs:[]};
  try{
    const now=nowISO();
    const offlineLocal = !!(opt && opt.expire) && CLOUD.code && !CLOUD.on;
    const photoIds=new Set();
    const allAp=await lAllObj('album_photos');
    for(const g of groups){
      for(const r of g.rows){
        const o=await lGetObj(r.store, r.o.id);
        if(!o || o.purgedAt) continue;
        if(r.store==='album_photos') photoIds.add(o.photoId);
        if(offlineLocal){ await lDel(r.store, o.id); out.rows++; continue; }   // R-08：離線到期只清本機列
        await purgeRow(r.store, o, now); out.rows++;
        /* 🔴 §0c R-46（🟠-7）：永久刪除相簿 ⇒ 它名下【所有】album_photo（不論哪一行）一起寫墓碑 */
        if(r.store==='albums'){
          for(const ap of allAp.filter(x=>x.albumId===o.id && !x.purgedAt)){
            const cur=await lGetObj('album_photos', ap.id); if(!cur || cur.purgedAt) continue;
            photoIds.add(cur.photoId);
            await purgeRow('album_photos', cur, now); out.rows++;
          }
        }
      }
    }
    if(!offlineLocal){
      for(const pid of photoIds){
        const how=await purgePhotoIfUnused(pid);
        if(how==='gone') out.photos++;
        else if(how==='inuse' && !(await lAllObj('album_photos')).some(x=>x.photoId===pid && !x.purgedAt)) out.inuse++;
      }
      await flushPendingDel();
      if(out.inuse) out.msgs.push(`有 ${out.inuse} 張照片另一台還放在別的相簿裡，照片本身沒有從雲端刪掉。`);
    }
  }finally{
    _purgeBusy=false;
  }
  return out;
}
/* 到期清理（取代舊的 purgeTrash：183 天、拿掉 20 筆；R-08／R-18）。loadAll 在 pull 之後呼叫。 */
async function purgeTrash(){
  const lim=nowMs()-TRASH_DAYS*DAY_MS;
  const due=(await trashGroups()).map(g=>({...g, rows:g.rows.filter(r=>{
    const t=Date.parse(r.o.deletedAt); return isFinite(t) && t<lim; })})).filter(g=>g.rows.length);
  if(!due.length) return 0;
  try{ const r=await purgeGroups(due, {expire:true}); return r ? r.rows : 0; }
  catch(e){ cloudErr(new Error('清理到期的垃圾時失敗（下次開啟再試）：'+((e&&e.message)||e))); return 0; }
}

/* ── 垃圾桶頁（專案頁的子畫面；🔴 不新增 S.tab 值 ⇒ 不碰 L()／setTab／t0 那一串讀者，O-30）── */
S.trash={open:false, f:'all', sel:new Set(), msg:''};
let _trUrls=[];
function openTrash(){ S.trash.open=true; S.trash.sel=new Set(); S.trash.msg=''; renderTrash(); }
function closeTrash(){ S.trash.open=false; _trUrls.forEach(u=>URL.revokeObjectURL(u)); _trUrls=[];
  $('trashView').hidden=true; $('projMain').hidden=false; refreshProj(); }
const purgeBlockedWhy = ()=> (CLOUD.code && !CLOUD.on)
  ? '沒有連上雲端：永久刪除要連線才能做（否則別台的垃圾桶還會看到它）。' : '';
let _trSeq=0;
async function renderTrash(){
  const box=$('trashView'); if(!box) return;
  $('projMain').hidden=true; box.hidden=false;
  const seq=++_trSeq;
  const groups=await trashGroups();
  const allAlb=new Map((await lAllObj('albums')).map(a=>[a.id,a]));
  if(seq!==_trSeq) return;
  _trUrls.forEach(u=>URL.revokeObjectURL(u)); _trUrls=[];
  const keys=new Set(groups.map(g=>g.key));
  S.trash.sel=new Set([...S.trash.sel].filter(k=>keys.has(k)));     // 不在了的勾選拿掉
  box.innerHTML='';
  const back=document.createElement('div'); back.className='backrow';
  const bb=document.createElement('button'); bb.className='btn'; bb.id='btnTrashBack'; bb.textContent='‹ 設定';
  bb.onclick=closeTrash; back.appendChild(bb); box.appendChild(back);
  const h=document.createElement('div'); h.className='projsec'; h.textContent=`垃圾桶（${groups.length} 行）`; box.appendChild(h);
  const note=document.createElement('div'); note.className='trnote';
  note.textContent=`保留 ${TRASH_DAYS} 天（半年），到期會自動永久刪除。雲端用量包含垃圾桶裡的照片。`
    + (nowFakeOn() ? `　⚠️ 現在時間＝測試值 ${LS.get('deco.nowFake')}` : '');
  box.appendChild(note);
  /* 篩選（🟡-12：一行出現在它含有的每一個篩選底下；「全部」只出現一次） */
  const fb=document.createElement('div'); fb.className='trfilt';
  for(const [k,t] of TRASH_FILTERS){
    const n = k==='all' ? groups.length : groups.filter(g=>g.kinds.has(k)).length;
    const c=document.createElement('button'); c.type='button'; c.className='chip'+(S.trash.f===k?' on':'');
    c.dataset.f=k; c.textContent=`${t} ${n}`;
    c.onclick=()=>{ S.trash.f=k; renderTrash(); };
    fb.appendChild(c);
  }
  box.appendChild(fb);
  if(S.trash.msg){ const m=document.createElement('div'); m.className='pstat'; m.id='trashMsg';
    m.innerHTML=esc(S.trash.msg).split(String.fromCharCode(10)).join('<br>'); box.appendChild(m); }
  const shown=groups.filter(g=>S.trash.f==='all' || g.kinds.has(S.trash.f));
  const list=document.createElement('div'); list.className='trlist';
  if(!shown.length){ const e=document.createElement('div'); e.className='trempty'; e.textContent='（沒有東西）'; list.appendChild(e); }
  for(const g of shown){
    const row=document.createElement('div'); row.className='trrow'; row.dataset.key=g.key;
    const on=S.trash.sel.has(g.key);
    const bx=document.createElement('span'); bx.className='box'+(on?' on':''); row.appendChild(bx);   // 勾選框常駐（R-31）
    const mid=document.createElement('div'); mid.className='trmid';
    const t=document.createElement('div'); t.className='trt'; t.textContent=trashLabel(g, allAlb); mid.appendChild(t);
    const s=document.createElement('div'); s.className='trs';
    s.textContent=`剩 ${daysLeft(g.at)} 天　${fmtLocal(g.last)} 刪除`; mid.appendChild(s);
    const phs=g.rows.filter(r=>r.store==='album_photos').slice(0,4);
    if(phs.length){
      const th=document.createElement('div'); th.className='trth';
      for(const r of phs){
        const p=PHOTOS.get(r.o.photoId);
        const im=document.createElement(p&&p.small?'img':'span');
        if(p&&p.small){ const u=URL.createObjectURL(p.small); _trUrls.push(u); im.src=u; im.alt=''; }
        th.appendChild(im);
      }
      mid.appendChild(th);
    }
    row.appendChild(mid);
    const rb=document.createElement('button'); rb.className='btn trres'; rb.textContent='還原';
    rb.onclick=async ev=>{ ev.stopPropagation(); rb.disabled=true;
      try{
        const m=await restoreGroup(g);
        await reloadObjects(); render(); buildList(); syncSel(); refreshTop();
        S.trash.msg=['已還原：'+trashLabel(g, allAlb)].concat(m).join(String.fromCharCode(10));
      }catch(e){ S.trash.msg='還原失敗：'+((e&&e.message)||e); }
      renderTrash(); };
    row.appendChild(rb);
    row.onclick=()=>{ if(S.trash.sel.has(g.key)) S.trash.sel.delete(g.key); else S.trash.sel.add(g.key); renderTrash(); };
    list.appendChild(row);
  }
  box.appendChild(list);
  /* 底部：〔永久刪除勾選的…〕（確認框寫數量；不可復原）＋ 灰掉時寫原因（🟠-6） */
  const foot=document.createElement('div'); foot.className='trfoot';
  const why=purgeBlockedWhy(), n=S.trash.sel.size;
  const pb=document.createElement('button'); pb.className='btn dangerfill'; pb.id='btnPurge';
  pb.textContent=`永久刪除勾選的 ${n} 行`; pb.disabled=!n || !!why;
  pb.onclick=()=>confirmPurge(groups.filter(g=>S.trash.sel.has(g.key)));
  foot.appendChild(pb);
  if(why){ const w=document.createElement('div'); w.className='trwhy'; w.textContent=why; foot.appendChild(w); }
  box.appendChild(foot);
}
async function confirmPurge(groups){
  if(!groups.length || purgeBlockedWhy()) return;
  const rows=groups.reduce((n,g)=>n+g.rows.length,0);
  /* 會跟著消失的照片（沒有別的相簿在用）：先算給她看 */
  const aps=await lAllObj('album_photos');
  const killAp=new Set(), pids=new Set();
  for(const g of groups) for(const r of g.rows){
    if(r.store==='album_photos'){ killAp.add(r.o.id); pids.add(r.o.photoId); }
    if(r.store==='albums') aps.filter(x=>x.albumId===r.o.id).forEach(x=>{ killAp.add(x.id); pids.add(x.photoId); });
  }
  const dying=[...pids].filter(pid=>!aps.some(x=>x.photoId===pid && !x.purgedAt && !killAp.has(x.id))).length;
  const ok=await askDialog({title:'永久刪除', okText:'永久刪除',
    body:`永久刪除 <b>${groups.length}</b> 行（共 ${rows} 筆）。<br>`
      + (dying ? `其中 <b>${dying} 張照片</b>沒有別的相簿在用，`
                 + (CLOUD.code ? '會連同雲端的檔案（壓縮版與原檔）一起刪掉。<br>' : '照片本身會一起刪掉。<br>') : '')
      + `<b>無法復原。</b>`});
  if(!ok) return;
  let res=null;
  try{ res=await purgeGroups(groups); }
  catch(e){ S.trash.msg='永久刪除到一半失敗（已刪的不會回來，其餘還在垃圾桶）：'+((e&&e.message)||e); }
  if(res){
    S.trash.msg=[`已永久刪除 ${res.rows} 筆`+(res.photos?`，照片 ${res.photos} 張`+(CLOUD.code?'（含雲端檔案）':''):'')+'。'].concat(res.msgs).join(String.fromCharCode(10));
    await refreshUsage();
  }
  S.trash.sel=new Set();
  await reloadObjects(); render(); buildList(); syncSel(); refreshTop();
  renderTrash();
}

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 7｜用量條的兩顆鈕（§9-4；B7-c 畫面交建造者）
   〔備份原檔〕＝相簿清單（每本寫雲端原檔大小），一次點一本 ⇒ 批 9 的 exportAlbumZip（🔴 不可一次打包全專案）
   〔刪除雲端的原檔〕＝勾選清單：第一列「垃圾桶裡的照片」預設勾（先勾垃圾桶裡的），其餘每本一列（不勾）
      ⇒ 確認框寫張數與 MB（不可逆，R-31）⇒ 每張【先改列】（orig_path 清空、orig_status＝purged）【再刪檔】（R-07）
   🔴 未連線 ⇒ 兩顆都不動作並寫原因（R-47）
   ══════════════════════════════════════════════════════════════ */
/* 這個專案「雲端有原檔」的照片 → {photoId: bytes} */
function cloudOrigMap(){
  const m=new Map();
  for(const p of PHOTOS.values())
    if(p.projectCode===CLOUD.code && p.origStatus==='has' && p.origPath)
      m.set(p.id, Number(p.origSize) || (p.orig ? p.orig.size : 0));   // 舊資料 origSize 可能是空（見 photoFromRow 註解）⇒ 退回本機原檔大小
  return m;
}
function origOfAlbum(albumId, om){
  const ids=[...new Set(apsOf(albumId).map(ap=>ap.photoId))].filter(id=>om.has(id));
  return {n:ids.length, bytes:ids.reduce((s,id)=>s+om.get(id),0), ids};
}
async function openBackupOrig(){
  if(!CLOUD.on){ showAlbMsg('沒有連上雲端：備份原檔要連線才能下載雲端的原檔。'); return; }
  const om=cloudOrigMap();
  const sorted=await sortedAlbums();
  openMenu('備份原檔：選一本匯出 zip（一次一本）', sorted.map(a=>{
    const o=origOfAlbum(a.id, om);
    return { label:albName(a), sub: o.n ? `原檔 ${o.n} 張｜${fmtBytes(o.bytes)}` : '雲端沒有原檔（會匯出壓縮版）',
             onClick:()=>{ exportAlbumZip(a.id); } };
  }));
}
async function openPurgeOrig(){
  if(!CLOUD.on){ showAlbMsg('沒有連上雲端：刪除雲端的原檔要連線才能做。'); return; }
  const om=cloudOrigMap();
  const liveP=new Set(APHOTOS.map(x=>x.photoId));
  const trashIds=[...om.keys()].filter(id=>!liveP.has(id));        // 照片在垃圾桶＝沒有任何活的 album_photo（O-40 推算）
  const sorted=(await sortedAlbums()).map(a=>({a, o:origOfAlbum(a.id, om)})).filter(x=>x.o.n);
  const rows=[], sets=[];
  if(trashIds.length){
    rows.push({html:`垃圾桶裡的照片<div class="sub">原檔 ${trashIds.length} 張｜${fmtBytes(trashIds.reduce((s,id)=>s+om.get(id),0))}</div>`, on:true});
    sets.push(trashIds);
  }
  for(const x of sorted){
    rows.push({html:`${esc(albName(x.a))}<div class="sub">原檔 ${x.o.n} 張｜${fmtBytes(x.o.bytes)}</div>`, on:false});
    sets.push(x.o.ids);
  }
  if(!rows.length){ showAlbMsg('雲端沒有任何原檔可以刪。'); return; }
  const r=await pickDialog({title:'刪除雲端的原檔',
    body:'只刪【雲端的原檔】，照片留壓縮版（放大畫面會寫「雲端的原檔已刪除」）。要留原檔請先〔備份原檔〕。',
    rows, actions:[{text:'取消', value:'no'}, {textFn:n=>`下一步（${n} 項）`, cls:'dangerfill', value:'go', needAny:true}]});
  if(r.value!=='go') return;
  const ids=[...new Set(sets.filter((s,i)=>r.checked[i]).flat())];
  const bytes=ids.reduce((s,id)=>s+(om.get(id)||0),0);
  const ok=await askDialog({title:'刪除雲端的原檔', okText:'刪除原檔',
    body:`刪除 <b>${ids.length} 張</b>照片的雲端原檔，共 <b>${fmtBytes(bytes)}</b>。<br>照片本身留著（壓縮版）。<br><b>無法復原。</b>`});
  if(!ok) return;
  const res=await purgeCloudOrigs(ids);
  await refreshUsage();
  await reloadObjects();
  showAlbMsg(`已刪除 ${res.done} 張照片的雲端原檔（${fmtBytes(res.bytes)}）。`+(res.fail?`\n有 ${res.fail} 張沒刪成：${res.err}`:''));
}
/* 每張：先改列（orig_status＝purged ⇒ photoToRow 送 orig_path:null）→ 推上去成功 → 路徑進待刪清單 → 刪檔 */
async function purgeCloudOrigs(ids){
  const out={done:0, bytes:0, fail:0, err:''};
  for(const id of ids){
    const r=await lGet('photos', id);
    if(!r || r.origStatus!=='has' || !r.origPath) continue;
    const path=r.origPath, size=Number(r.origSize) || (r.orig ? r.orig.size : 0);
    r.origStatus='purged'; r.origPath=null; r.origErr=null;
    const how=await savePhoto(r, {wait:true});
    if(how==='error'){ out.fail++; out.err='改雲端的照片列失敗（見同步訊息）'; continue; }
    setPendingDel(pendingDelList().concat([path]));
    out.done++; out.bytes+=size;
  }
  await flushPendingDel();
  return out;
}
$('btnTrash').onclick=openTrash;
