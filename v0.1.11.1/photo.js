"use strict";

/* ══════════════════════════════════════════════════════════════
   📷 照片資料層（_d §3-3 的七個函式；簽名與呼叫端一行不改）
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.1.9：opt.wait＝等推送做完並回傳它的結果（原檔佇列要知道「雲端回 [] ＝ 已被永久刪除」）。
   其餘呼叫端照舊（背景推、不等）。 */
async function savePhoto(rec, opt){
  rec.id = rec.id || uid();
  /* 🔴 需求 36（v0.11_i 修二）：照片線與 stampObj 同一個 bug——存檔不可以順手改變歸屬。 */
  if(rec.projectCode == null) rec.projectCode = CLOUD.code || null;
  rec.updatedAt   = nowISO();
  /* 🔴 v0.22_i §0b R-03 ③（A-3）：【每次】改欄位都標 pending（比照 stampObj）。
     舊寫法只在 !synced 時標 ⇒ 已同步過的照片之後改狀態（搬家蓋 albumVer、原檔狀態…）推送失敗就【永不重試】。
     ⚠️ 連帶：synced=false 的照片不會被「雲端沒這個 id ⇒ 刪本機」刪掉（4400 只刪 synced 的），
        所以別台永久刪除之後，這台的推送可能把它插回雲端 ⇒ 由雲端的 photo_purged 墓碑擋（§0c R-07，批 3 SQL）。 */
  if(CLOUD.code){ rec.pending = true; rec.synced = false; }
  await lPut('photos',rec);
  if(CLOUD.on && !(opt && opt.noPush)){          // 🔴 v0.1.10 P1：noPush＝只寫本機（見 uploadFiles）
    const p=cloudPushPhoto(rec.id).catch(e=>{ cloudErr(e); return 'error'; });
    if(opt && opt.wait) return await p;
  }
  return rec.id;
}
async function loadPhoto(id){ return lGet('photos',id); }
async function listPhotos(){ return lAll('photos'); }
/* 🗂 v0.1.9 批 10（O-37／R-19）：舊的 deletePhoto（照片物理刪除：本機 lDel＋雲端硬刪）、saveMarker／listMarkers／deleteMarker
   整族拿掉 —— 全檔已沒有任何呼叫者。
   · 舊註解寫「照片是物理刪除（照片線刻意如此，不要統一）」—— v0.1.9【刻意統一】了：照片可以同時在好幾本相簿，
     刪除改發生在 album_photo 層、進垃圾桶（半年）；真正的永久刪除只走批 7 的 purgeGroups → RPC purge_photo（先查引用）。
   · markers：v0.1.9 只讀（搬家用，直接讀 IndexedDB）。舊資料裡還沒推上去的標記仍由 cloudPull ③ 的 cloudPushMarker 補推（原樣保留）。 */

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 4｜JPEG 的區段與 EXIF（讀＋清 GPS）
   舊版只讀檔頭 256 KB、只取拍攝時間與方向；v0.1.9 要讀整個檔（清 GPS 要改寫整個檔）。
   ⚠️ 只認 JPEG（FF D8）。HEIC／PNG 等不走這裡 —— 它們的原檔由 canvas 轉成 jpg（makeOrig），
      轉檔本身會丟掉【全部】中繼資料 ⇒ GPS 一定不在（方向先烤進像素、拍攝時間讀不到就用加入時間）。
   ══════════════════════════════════════════════════════════════ */
/* 切出 JPEG 的區段（SOS 之後是影像資料，不再往下切）。回 null＝不是 JPEG。 */
function jpegSegments(v){
  if(v.byteLength<4 || v.getUint16(0)!==0xFFD8) return null;
  const segs=[]; let off=2;
  while(off+4<=v.byteLength){
    if(v.getUint8(off)!==0xFF) break;
    const m=v.getUint8(off+1);
    if(m===0xFF){ off+=1; continue; }                          // 填充位元組
    if(m===0xD9 || m===0xDA){ segs.push({marker:m, off, len:0}); break; }
    if((m>=0xD0 && m<=0xD7) || m===0x01){ off+=2; continue; }  // 沒有長度的標記
    const L=v.getUint16(off+2);
    if(L<2 || off+2+L>v.byteLength) break;
    segs.push({marker:m, off, len:2+L});
    off+=2+L;
  }
  return segs;
}
const _ASCII = (v,p,n)=>{ let s=''; for(let k=0;k<n && p+k<v.byteLength;k++) s+=String.fromCharCode(v.getUint8(p+k)); return s; };
function segKind(v, s){
  if(s.marker!==0xE1 || s.len<10) return null;
  if(v.getUint32(s.off+4)===0x45786966 && v.getUint16(s.off+8)===0) return 'exif';     // "Exif\0\0"
  if(_ASCII(v, s.off+4, 20).indexOf('http://ns.adobe.com/')===0) return 'xmp';         // XMP 與延伸 XMP
  return null;
}
/* EXIF 型別的單位大小（TIFF 6.0） */
const EXIF_TYPE_SIZE = {1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8};
/* 讀一個 exif APP1 的 TIFF 結構（不改任何東西） */
function exifTiff(v, s){
  const tiff=s.off+10;
  const bo=v.getUint16(tiff);
  if(bo!==0x4949 && bo!==0x4D4D) return null;
  const le = (bo===0x4949);
  const end = s.off+s.len;
  const u16=p=>v.getUint16(p,le), u32=p=>v.getUint32(p,le);
  const ok = p=>p>=tiff && p+2<=end;
  const readIFD=(p,want)=>{
    const found={};
    if(!ok(p)) return found;
    const n=u16(p);
    for(let i=0;i<n;i++){
      const e=p+2+i*12; if(e+12>end) break;
      const tag=u16(e), type=u16(e+2), cnt=u32(e+4);
      if(want && !want.includes(tag)) continue;
      const size=(EXIF_TYPE_SIZE[type]||1)*cnt;
      const vo = size>4 ? tiff+u32(e+8) : e+8;
      if(type===3) found[tag]=u16(e+8);
      else if(type===4) found[tag]=u32(e+8);
      else if(type===2) found[tag]=_ASCII(v, vo, Math.max(0,cnt-1)).replace(/\0+$/,'');
      else found[tag]={type,cnt,vo};
    }
    return found;
  };
  return {tiff, le, end, u16, u32, readIFD};
}
/* ╔═ 🔴 v0.1.9 §9-6／R-12｜解析：拍攝時間、時差、方向、有沒有 GPS ═══════════════════╗
   回傳的前兩欄與舊版一模一樣（dateTaken、orientation），呼叫端不必改。
   🆕 offsetTime（0x9011 OffsetTimeOriginal，例 +08:00）、gpsCount（GPS IFD 裡有幾項）、hasXmp。 ╚═╝ */
function parseExif(buf){
  const out={dateTaken:null, orientation:null, offsetTime:null, gpsCount:0, hasXmp:false};
  try{
    const v=new DataView(buf);
    const segs=jpegSegments(v); if(!segs) return out;          // 不是 JPEG
    let done=false;
    for(const s of segs){
      const k=segKind(v,s);
      if(k==='xmp'){ out.hasXmp=true; continue; }
      if(k!=='exif' || done) continue;
      done=true;
      const T=exifTiff(v,s); if(!T) continue;
      const ifd0=T.tiff+T.u32(T.tiff+4);
      const a=T.readIFD(ifd0,[0x0112,0x8769,0x8825]);
      if(a[0x0112]) out.orientation=a[0x0112];
      if(a[0x8769]){
        const b=T.readIFD(T.tiff+a[0x8769],[0x9003,0x9004,0x9011]);
        out.dateTaken=b[0x9003]||b[0x9004]||null;
        out.offsetTime=b[0x9011]||null;
      }
      if(a[0x8825]){
        const g=T.tiff+a[0x8825];
        if(g+2<=T.end) out.gpsCount=T.u16(g);
      }
    }
  }catch(e){ /* 格式壞掉：當作沒有 EXIF（與舊版相同的退路） */ }
  return out;
}
/* ╔═ 🔴🔴 v0.1.9 §9-6（A13，個資）｜JPEG 原檔去 GPS：【原地】改，不重新壓縮 ═══════════════╗
   做法：
     ① GPS IFD：每一項若值放在外面（> 4 位元組，例如經緯度三個分數），那一段值【填 0】；
        所有項目本身【填 0】；項目數改成 0（讀的人看到的是一個空的 GPS IFD）
     ② XMP 區段（http://ns.adobe.com/…）整段拿掉（XMP 也可能帶位置）
   🔴 不碰：方向（0x0112）、拍攝時間 —— 否則〔查看原檔〕與匯出 zip 會橫著（前·訴求刀 §6-3）
   🔴 不動任何位移：GPS 是原地填 0；XMP 是整段拿掉，而 EXIF 裡的位移都是相對於它自己那一段的 TIFF 表頭
      ⇒ 其他區段整段搬移不影響。
   回傳 {bytes, gpsCleared(清掉幾項), xmpRemoved(拿掉幾段)}。不是 JPEG ⇒ null。 ╚═════════════════╝ */
function stripJpegGps(buf){
  const src=new Uint8Array(buf);
  const u=new Uint8Array(src);                       // 複本（不動呼叫端的原始資料）
  const v=new DataView(u.buffer);
  const segs=jpegSegments(v); if(!segs) return null;
  let gpsCleared=0; const drop=[];
  for(const s of segs){
    const k=segKind(v,s);
    if(k==='xmp'){ drop.push(s); continue; }
    if(k!=='exif') continue;
    const T=exifTiff(v,s); if(!T) continue;
    const ifd0=T.tiff+T.u32(T.tiff+4);
    const a=T.readIFD(ifd0,[0x8825]);
    if(!a[0x8825]) continue;
    const g=T.tiff+a[0x8825];
    if(g+2>T.end) continue;
    const n=T.u16(g);
    for(let i=0;i<n;i++){
      const e=g+2+i*12; if(e+12>T.end) break;
      const type=T.u16(e+2), cnt=T.u32(e+4);
      const size=(EXIF_TYPE_SIZE[type]||1)*cnt;
      if(size>4){
        const vo=T.tiff+T.u32(e+8);
        if(vo>=T.tiff && vo+size<=T.end) u.fill(0, vo, vo+size);
      }
      u.fill(0, e, e+12);
      gpsCleared++;
    }
    v.setUint16(g, 0, T.le);                          // 項目數＝0
  }
  if(!drop.length) return {bytes:u, gpsCleared, xmpRemoved:0};
  const keep=[]; let pos=0;
  for(const s of drop){ keep.push(u.subarray(pos, s.off)); pos=s.off+s.len; }
  keep.push(u.subarray(pos));
  const total=keep.reduce((n,x)=>n+x.length,0);
  const out=new Uint8Array(total); let o=0;
  for(const x of keep){ out.set(x,o); o+=x.length; }
  return {bytes:out, gpsCleared, xmpRemoved:drop.length};
}
const orientOf = v => (Number.isInteger(v) && v>=1 && v<=8) ? v : 1;

/* 🔴 O-12：瀏覽器會不會自己套 EXIF 方向？——【測】，不猜（能力探測）。 */
let _oriByBrowser = null;
function _probeJpegOri6(bytes){
  const body=[0x45,0x78,0x69,0x66,0x00,0x00,
              0x49,0x49,0x2A,0x00, 0x08,0x00,0x00,0x00,
              0x01,0x00,
              0x12,0x01, 0x03,0x00, 0x01,0x00,0x00,0x00, 0x06,0x00,0x00,0x00,
              0x00,0x00,0x00,0x00];
  const len=body.length+2;
  const app1=[0xFF,0xE1,(len>>8)&0xFF,len&0xFF].concat(body);
  const out=new Uint8Array(2+app1.length+(bytes.length-2));
  out.set(bytes.subarray(0,2),0);
  out.set(app1,2);
  out.set(bytes.subarray(2),2+app1.length);
  return new Blob([out],{type:'image/jpeg'});
}
async function browserAppliesOrientation(){
  if(_oriByBrowser!==null) return _oriByBrowser;
  try{
    const cv=document.createElement('canvas'); cv.width=2; cv.height=1;
    const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,2,1);
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.9));
    const probe=_probeJpegOri6(new Uint8Array(await blob.arrayBuffer()));
    const bmp=await createImageBitmap(probe);
    _oriByBrowser = bmp.height > bmp.width;      // 2×1 → 1×2 ＝ 被轉了
    bmp.close && bmp.close();
  }catch(e){ _oriByBrowser = false; }            // 測不出來 → 當它不轉（回到原行為）
  return _oriByBrowser;
}
function applyOrient(ctx, ori, rw, rh){
  switch(ori){
    case 2: ctx.transform(-1, 0, 0, 1, rw, 0); break;
    case 3: ctx.transform(-1, 0, 0,-1, rw, rh); break;
    case 4: ctx.transform( 1, 0, 0,-1, 0, rh); break;
    case 5: ctx.transform( 0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform( 0, 1,-1, 0, rh, 0); break;
    case 7: ctx.transform( 0,-1,-1, 0, rh, rw); break;
    case 8: ctx.transform( 0,-1, 1, 0, 0, rw); break;
    default: break;                                   // 1：不動
  }
}
const fmtBytes=n=> n>=1048576 ? (n/1048576).toFixed(2)+' MB'
                 : n>=1024 ? (n/1024).toFixed(0)+' KB' : n+' B';

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 4｜原檔（§9-2、§9-6）
   ══════════════════════════════════════════════════════════════ */
/* 🔴 Q-A2（Ali 09-30 選甲）：非 jpg 轉檔時超過手機瀏覽器畫布上限 ⇒ 縮到上限內當原檔，標「原檔（已縮小）」。
   ⚠️ 推測：iPhone Safari 一張畫布約 16,777,216 畫素（4096²）；留一點餘量。🔬 真機探針驗。 */
const ORIG_MAX_PX = 16000000;
const ORIG_JPEG_Q = 0.92;
/* 產生要上雲端的原檔：jpg ⇒ 原地去 GPS（不重壓、畫質不變）；其他 ⇒ canvas 轉 jpg（丟掉全部中繼資料）。
   失敗一律丟一個講得出原因的錯（呼叫端寫進 origStatus='failed'＋origErr，不可安靜）。 */
async function makeOrig(file, buf){
  const u8=new Uint8Array(buf);
  if(u8.length>3 && u8[0]===0xFF && u8[1]===0xD8){
    const s=stripJpegGps(buf);
    if(!s) throw new Error('原檔讀不懂（JPEG 格式壞掉）');
    return {blob:new Blob([s.bytes],{type:'image/jpeg'}), type:'jpg', shrunk:false,
            gpsCleared:s.gpsCleared, xmpRemoved:s.xmpRemoved};
  }
  let bmp;
  try{ bmp=await createImageBitmap(file); }
  catch(e){ throw new Error('原檔轉 jpg 失敗：這個瀏覽器解不開這種格式（'+((e&&e.message)||e)+'）'); }
  try{
    const W=bmp.width, H=bmp.height, px=W*H;
    const k = px>ORIG_MAX_PX ? Math.sqrt(ORIG_MAX_PX/px) : 1;
    const cw=Math.max(1,Math.floor(W*k)), ch=Math.max(1,Math.floor(H*k));
    const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
    const ctx=cv.getContext('2d');
    if(!ctx) throw new Error('畫布建立失敗');
    ctx.drawImage(bmp,0,0,cw,ch);                   // 非 jpg 的方向由瀏覽器解碼時套用（imageOrientation 預設 from-image）
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',ORIG_JPEG_Q));
    if(!blob || !blob.size) throw new Error('原檔轉 jpg 失敗（畫面太大或記憶體不足）');
    return {blob, type:'jpg', shrunk:k<1, w:cw, h:ch, gpsCleared:0, xmpRemoved:0};
  }finally{ bmp.close && bmp.close(); }
}
/* ╔═ 🔴 v0.22_i §0c R-12｜拍攝時間：【不存】，讀的時候推算（shot_at 欄位保留、App 不寫）═════╗
   有 EXIF ⇒ date_taken（'YYYY:MM:DD HH:MM:SS'，當地時間）換成 'YYYY-MM-DD HH:MM:SS'，有時差就附上；
   沒有 ⇒ added_at（ISO/UTC）轉成這台的當地時間 'YYYY-MM-DD HH:MM:SS +08:00'。 ╚═══════════════╝ */
/* 原檔狀態的人話（§9-3；畫面文字一律走這一支） */
function origStatusText(r){
  const sz = r.origSize ? `（${fmtBytes(r.origSize)}）` : '';
  switch(r.origStatus){
    case 'has':     return '已上雲端'+sz+(r.origShrunk?'・已縮小':'')+(r.origType?`・${r.origType}`:'');
    case 'pending': return r.orig ? '排隊中（連線後上傳）'+sz : '排隊中（這台沒有原檔）';
    case 'failed':  return '失敗：'+(r.origErr||'原因不明');
    case 'skipped': return '雲端已滿，只存壓縮版';
    case 'purged':  return '雲端的原檔已刪除（只剩壓縮版）';
    default:        return (r.orig && r.albumVer===0) ? '舊照片，這台有原檔（連線後補傳）' : '沒有原檔（舊照片）';
  }
}
function localStamp(d){
  const z=x=>String(x).padStart(2,'0');
  const off=-d.getTimezoneOffset(), sg=off>=0?'+':'-', a=Math.abs(off);
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} `+
         `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())} ${sg}${z(Math.floor(a/60))}:${z(a%60)}`;
}
function shotAtOf(rec){
  const m=/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(rec&&rec.dateTaken||''));
  if(m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`+(rec.dateOffset?(' '+rec.dateOffset):'');
  const d=new Date(rec&&rec.addedAt||'');
  return isNaN(d.getTime()) ? '' : localStamp(d);
}

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 4｜用量（§9-4、R-17、R-47、R-49、Q-A1）
   整個雲端（全部 bucket）的用量，滿格＝1 GB。
     < 70%　正常
     ≥ 70%　新的原檔不傳（orig_status＝skipped），壓縮版照傳
     ≥ 95%　【新拍／新選】的照片擋住；已經拍進相簿、還在排隊的壓縮版照傳（Q-A1 甲），原檔一樣 skipped
   🔧 測試開關：localStorage 鍵 deco.usageFake（位元組數）⇒ 覆寫「整個雲端」的數字；
      開著時診斷列會寫「用量＝測試值」（O-18：假的狀態不可以長得跟真的一樣）。
   ══════════════════════════════════════════════════════════════ */
const USAGE_CAP  = 1024*1024*1024;
const USAGE_SOFT = 0.70*USAGE_CAP;
const USAGE_HARD = 0.95*USAGE_CAP;
S.usage = null;                              // {total, orig, fake, at}
async function refreshUsage(){
  if(!CLOUD.on) { S.usage=null; return null; }
  const fake=LS.get('deco.usageFake');
  let total=null, orig=null;
  try{
    const r=await sbFetch('/rest/v1/rpc/storage_usage',{method:'POST',
      headers:{'Content-Type':'application/json'}, body:'{}'});
    if(!r.ok) throw new Error((await r.text()).slice(0,160));
    const j=await r.json();
    total=Number(j&&j.total)||0; orig=Number(j&&j.orig)||0;
  }catch(e){
    if(fake==null){ cloudErr(new Error('讀不到雲端用量：'+((e&&e.message)||e))); return S.usage; }
  }
  if(fake!=null && isFinite(Number(fake))) total=Number(fake);
  S.usage={total, orig:orig||0, fake:(fake!=null), at:Date.now()};
  refreshDiag();
  /* 用量常常比畫面晚到（開 App 時同步還在跑）⇒ 相簿頁開著就重畫一次，用量條才不會停在「讀取中」 */
  if(S.tab==='photo') renderAlbums();
  return S.usage;
}
/* 'unknown'（還不知道／未連線）／'ok'／'warn'（≥70%）／'full'（≥95%） */
function usageLevel(){
  if(!S.usage || S.usage.total==null) return 'unknown';
  return S.usage.total>=USAGE_HARD ? 'full' : S.usage.total>=USAGE_SOFT ? 'warn' : 'ok';
}

/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 4｜收一張照片（intake）＋ 上傳到相簿（uploadFiles）
   ══════════════════════════════════════════════════════════════ */
/* 🔴 §0b R-13：做不出壓縮版的照片【不進相簿】，丟錯讓呼叫端在頁面上說原因（不存、不上傳）。
   🔴 舊版會把原檔當壓縮版上傳（4219 的 r.small||r.orig），已在 cloudPushPhoto 拿掉。 */
async function intake(file, source){
  const rec={ id:uid(), name:file.name||'(無檔名)', source, appVer:APP_VER,
    mime:file.type||'(未知)', origSize:file.size,
    addedAt:nowISO(), dateTaken:null, dateOffset:null, orientation:null,     // 🔴 需求 4：存 ISO
    decoded:false, err:null, w:0,h:0, small:null, smallSize:0,
    albumVer:1,                              // 🔴 R-10：v0.1.9 上傳＝1（搬家不會把它當成舊照片）
    orig:null, origClean:false, origStatus:null, origType:null, origShrunk:false, origErr:null };
  let buf=null;
  try{
    buf=await file.arrayBuffer();            // 🔴 v0.1.9：讀整個檔（清 GPS 要改寫整個檔）
    const ex=parseExif(buf);
    rec.dateTaken=ex.dateTaken; rec.orientation=ex.orientation; rec.dateOffset=ex.offsetTime;
  }catch(e){ rec.err='EXIF 讀取失敗：'+e.message; }
  let bmp=null;
  try{
    bmp=await createImageBitmap(file);
    rec.decoded=true; rec.rawW=bmp.width; rec.rawH=bmp.height;
  }catch(e){
    rec.err=(rec.err? rec.err+'｜':'')+'解碼失敗（可能是 HEIC/HEIF）：'+e.message;
  }
  if(bmp){
    try{
      const exifOri=orientOf(rec.orientation);
      const byBrowser=await browserAppliesOrientation();
      const ori = byBrowser ? 1 : exifOri;
      rec.oriBy = (exifOri>1) ? (byBrowser?'瀏覽器':'本程式') : null;
      const k=Math.min(1, 1600/Math.max(bmp.width,bmp.height));
      const rw=Math.round(bmp.width*k), rh=Math.round(bmp.height*k);
      const swap = ori>=5;
      const cv=document.createElement('canvas');
      cv.width  = swap? rh : rw;
      cv.height = swap? rw : rh;
      const ctx=cv.getContext('2d');
      applyOrient(ctx, ori, rw, rh);
      ctx.drawImage(bmp,0,0,rw,rh);
      const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.8));
      rec.small=blob; rec.smallSize=blob? blob.size : 0;
      rec.w=cv.width; rec.h=cv.height;
      rec.rotated = (exifOri>1);
    }catch(e){
      rec.err=(rec.err? rec.err+'｜':'')+'壓縮失敗：'+e.message;
      rec.w=rec.rawW; rec.h=rec.rawH;
    }
    bmp.close && bmp.close();
  }
  if(!rec.small) throw new Error('沒有加入相簿：做不出壓縮版（'+(rec.err||'原因不明')+'）');
  /* 原檔：去 GPS／轉 jpg。失敗 ⇒ 只存壓縮版，狀態 failed、寫原因（§9-6，不可安靜）。 */
  try{
    const o=await makeOrig(file, buf || await file.arrayBuffer());
    rec.orig=o.blob; rec.origClean=true; rec.origType=o.type; rec.origShrunk=!!o.shrunk;
    rec.origSize=o.blob.size; rec.origStatus='pending';
  }catch(e){
    rec.orig=null; rec.origStatus='failed'; rec.origErr=(e&&e.message)||String(e);
  }
  return rec;
}
/* 最近用過的相簿（R-50 🟡-4：這台的 localStorage，不上雲端）—— 最多記 3 本 */
const RECENT_ALBUMS_KEY='deco.recentAlbums';
function touchRecentAlbum(id){
  let a=[]; try{ a=JSON.parse(LS.get(RECENT_ALBUMS_KEY)||'[]'); if(!Array.isArray(a)) a=[]; }catch(e){ a=[]; }
  a=[id].concat(a.filter(x=>x!==id)).slice(0,3);
  LS.set(RECENT_ALBUMS_KEY, JSON.stringify(a));
}
/* ╔═ 🔴 v0.1.9 §9-1｜把選到的檔案放進一本相簿 ════════════════════════════════════════╗
   target：'new'（清單頁預設 ⇒ 開一本「新相簿(N)」）或相簿 id（內頁預設＝這本）。
   🔴 R-37：【至少成功一張】才建新相簿（選檔按取消、或全部做不出壓縮版 ⇒ 不會多出空相簿，相-29）。
   🔴 Q-A1：雲端已知 ≥ 95% ⇒ 新選的照片擋下（畫面上兩顆鈕也會灰，批 5）。
   新照片排在那本最後（sort＝目前最大＋1）。回傳 {made, albumId, msgs}。 ╚═══════════════════╝ */
async function uploadFiles(files, source, target){
  const list=[...(files||[])];
  const res={made:0, albumId:(target && target!=='new') ? target : null, msgs:[], apIds:[]};
  if(!list.length) return res;
  if(usageLevel()==='full'){
    res.msgs.push('雲端用量已超過 95%，暫停上傳（可以先刪除雲端的原檔或永久刪除垃圾桶裡的照片）。');
    return res;
  }
  /* ╔═ 🔴 v0.1.10 P1（§1、§0d #5）｜每一張：三筆【先全部寫進本機】，全部成功才推雲端 ═══════════╗
     v0.1.9 的做法是「先 saveAlbum（建新相簿、立刻背景推上雲）→ savePhoto（丟錯沒人接）」
     ⇒ iPhone 無痕視窗（IndexedDB 存不了 Blob）：照片存不進去、onPickFiles 中斷、畫面沒有任何訊息，
       而雲端已經多了一本空相簿（每選一次一本）。
     新順序：照片（noPush）→ 新相簿（第一張成功才建，noPush）→ album_photo（noPush）
       任一步丟錯 ⇒ 收回這一張剛寫的本機紀錄（照片、這一張順帶建的新相簿），訊息寫原因，繼續下一張
       ⇒ 一張都沒成功 ⇒ 本機與雲端都不會有新相簿；也不會有「不屬於任何相簿的照片」（v0.22_i §1）。
     全部寫完才依「照片 → 相簿 → album_photo」的順序在背景推（pushUploaded）。 ╚═══════════════════╝ */
  const toPush=[];
  for(const f of list){
    const fname=f.name||'(無檔名)';
    let rec;
    try{ rec=await intake(f, source); }
    catch(e){ res.msgs.push(`「${fname}」${(e&&e.message)||e}`); continue; }
    let wrote=false, made=null;
    try{
      await savePhoto(rec, {noPush:true}); wrote=true;
      if(!res.albumId){
        const all=await lAllObj('albums');
        made=newObj({ id:uid(), name:`新相簿(${maxNewAlbumNo(all)+1})`, locX:null, locY:null,
          deletedAt:null, batchId:null, restoredAt:null, purgedAt:null });
        await saveAlbum(made, {noPush:true});
      }
      const albumId = res.albumId || made.id;
      const sorts=(await lAllObj('album_photos'))
        .filter(x=>x.albumId===albumId && !x.purgedAt).map(x=>Number(x.sort)||0);
      const ap=newObj({ id:uid(), albumId, photoId:rec.id,
        name: rec.name==='(無檔名)' ? '' : rec.name, note:'',
        sort:(sorts.length? Math.max(...sorts) : 0)+1,
        deletedAt:null, batchId:null, restoredAt:null, purgedAt:null });
      await saveAlbumPhoto(ap, {noPush:true});
      if(made) res.albumId=made.id;
      res.made++; res.apIds.push(ap.id);
      toPush.push({photoId:rec.id, albumId:made ? made.id : null, apId:ap.id});
    }catch(e){
      /* 收回（每一步各自 try：收回本身失敗也不可以蓋掉原本的錯誤訊息） */
      if(wrote){ try{ await lDel('photos', rec.id); }catch(_){} }
      if(made){  try{ await lDel('albums', made.id); }catch(_){} }
      res.msgs.push(`「${fname}」存不進這支手機（瀏覽器儲存失敗：${(e&&e.name)||'Error'}）。無痕視窗或空間不足時會這樣。`);
    }
  }
  if(res.albumId && res.made) touchRecentAlbum(res.albumId);
  await reloadObjects();
  if(toPush.length) pushUploaded(toPush).catch(e=>cloudErr(e));
  return res;
}
/* 背景推：一張一張、照「照片 → 相簿（這一張順帶建的）→ album_photo」的順序。
   失敗只留 pending（v0.1.10 P7：回前景／下一次同步的 pushPending 會接著推）。 */
async function pushUploaded(items){
  if(!CLOUD.on) return;
  for(const it of items){
    try{
      await cloudPushPhoto(it.photoId);
      if(it.albumId && ALBUM_CLOUD) await cloudPushObj('albums', it.albumId);
      if(ALBUM_CLOUD) await cloudPushObj('album_photos', it.apId);
    }catch(e){ cloudErr(e); if(e && e.transient) break; }
  }
  kickOrigQueue();
}

/* ╔═ 🔴🔴 v0.1.9 §9-2／§9-3／§9-5｜原檔上傳佇列 ══════════════════════════════════════════╗
   對象：這個專案、這台本機【有原檔 Blob】、而且
     · orig_status＝pending（v0.1.9 拍的）；或
     · §0b Q-7：舊照片（albumVer＝0、狀態空、原檔還沒清過 GPS）⇒ 由【拍照那一台】補傳（none→pending 只有這台做）
   每一張的順序（寫死）：
     ① 壓縮版與照片列要先在雲端（還沒 ⇒ 這一輪跳過，下一輪再來）
     ② 舊照片先去 GPS（同 intake 的 makeOrig）
     ③ 🔴 R-47：量用量【當下】判 ⇒ ≥ 70% ⇒ skipped（不傳）
     ④ 確認照片列還在（被別台永久刪除 ⇒ 不傳）
     ⑤ 傳到 `${code}/${id}_orig.jpg`（R-49）⇒ 列更新 orig_path／has／格式／大小
     ⑥ 推回來是 []（剛好在 ④⑤ 之間被永久刪除）⇒ 把剛傳的檔刪掉（沒有列指著它，雲端政策允許）
   失敗 ⇒ failed＋原因（不可安靜；畫面點一下重試是批 5）。App 關掉再開 ⇒ 下次同步接著傳（以照片 id 判）。
   🔴 busy 旗標一律 finally 清（⑧-b 成對機制）。 ╚═══════════════════════════════════════════╝ */
let _origBusy=false, _origAgain=false, _origStalled=false;   // _origStalled：這一輪因為暫時性錯誤停下（給自驗與診斷看）
function kickOrigQueue(){
  if(_origBusy){ _origAgain=true; return; }
  processOrigQueue().catch(e=>cloudErr(e));
}
async function processOrigQueue(){
  if(!CLOUD.on || !CLOUD.code || CLOUD.frozen || _origBusy) return;
  _origBusy=true;
  let done=0;
  try{
    do{
      _origAgain=false;
      /* 🔴 v0.1.10 P7：迴圈外層那一次 try —— 暫時性錯誤（網路斷、逾時、5xx）⇒ 這張留 pending、整輪停
         （網路斷了，後面的一定也失敗，不要連打）；回前景／online／下次同步會再 kick。
         v0.1.9 是「丟錯跳出整個 for、沒人再 kick」。 */
      try{
      for(const r0 of await lAll('photos')){
        if(r0.projectCode!==CLOUD.code || !r0.orig) continue;
        const legacy = (r0.albumVer===0) && (r0.origStatus==null) && !r0.origClean;
        if(!(r0.origStatus==='pending' || legacy)) continue;
        const r=await lGet('photos', r0.id); if(!r) continue;          // 重讀（中途可能被改）
        if(!r.storagePath) continue;                                     // ① 壓縮版還沒上雲
        if(!r.origClean){                                                // ② 舊照片：先去 GPS
          try{
            const o=await makeOrig(r.orig, await r.orig.arrayBuffer());
            r.orig=o.blob; r.origClean=true; r.origType=o.type; r.origShrunk=!!o.shrunk; r.origSize=o.blob.size;
          }catch(e){
            r.origStatus='failed'; r.origErr=(e&&e.message)||String(e); await savePhoto(r); continue;
          }
        }
        const u=await refreshUsage();                                    // ③
        if(u && u.total!=null && u.total>=USAGE_SOFT){
          r.origStatus='skipped'; r.origErr=null; await savePhoto(r); continue;
        }
        const chk=await sbFetch('/rest/v1/photos?select=id&id=eq.'+r.id);   // ④
        if(!chk.ok){ const er=new Error('確認照片失敗：'+(await chk.text()).slice(0,160)); er.transient=isTransientStatus(chk.status); throw er; }
        const exists=await chk.json();
        if(!Array.isArray(exists) || !exists.length) continue;
        const path=`${CLOUD.code}/${r.id}_orig.jpg`;                      // ⑤
        const up=await sbFetch('/storage/v1/object/photos/'+path,{method:'POST',
          headers:{'Content-Type':'image/jpeg','x-upsert':'true'}, body:r.orig});
        if(!up.ok){
          const msg='上傳原檔失敗：'+(await up.text()).slice(0,160);
          /* 🔴 v0.1.10 §0d #4：5xx／408／429 是暫時的 ⇒ 留 pending（v0.1.9 一律記 failed，failed 不會自己重試） */
          if(isTransientStatus(up.status)){ const er=new Error(msg); er.transient=true; throw er; }
          r.origStatus='failed'; r.origErr=msg;
          await savePhoto(r); continue;
        }
        r.origPath=path; r.origStatus='has'; r.origErr=null;
        r.origSize=r.orig.size;                                          // 🔴 批 7：送得出 orig_size（上面那個洗成 null 的坑的第二道）
        const how=await savePhoto(r,{wait:true});
        if(how==='purged'){                                              // ⑥
          /* 🔴 v0.1.10 §0d #3：改走待刪清單（v0.1.9 是直接刪＋吞掉錯誤 ⇒ 中斷時會留下孤兒檔） */
          setPendingDel(pendingDelList().concat([path]));
          flushPendingDel().catch(e=>cloudErr(e));
        }
        if(S.usage && S.usage.total!=null && !S.usage.fake){ S.usage.total+=r.origSize||0; S.usage.orig+=r.origSize||0; }
        done++;
      }
      }catch(e){
        if(e && e.transient){ _origStalled=true; break; }          // 留 pending；等下一次 kick
        throw e;
      }
    }while(_origAgain);
  }finally{
    _origBusy=false;
    /* 🔴 v0.1.10 P7-a：「橘條最後會消失」——傳完要讓畫面知道（v0.1.9 要等下一次同步才重畫） */
    if(done){ try{ await reloadObjects(); if(S.tab==='photo') renderAlbums(); }catch(e){} }
  }
}
