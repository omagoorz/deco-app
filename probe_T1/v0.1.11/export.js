"use strict";
/* ══════════════════════════════════════════════════════════════
   🔴 v0.1.9 批 9｜匯出 zip（_i §11、_d §13-86；§0c R-12／R-50）
   一本一個 zip：01_照片名.jpg、02_…（前綴＝排序號；沒有原檔的用壓縮版，檔名加「_壓縮版」）＋ 說明.txt
   🔴 說明.txt 是【未來匯入的合約】：欄位固定、含格式版本（format: deco-album/1）。
   做法（§13 Q-9）：自寫 store-only zip（不壓縮 —— jpg 本來就壓過），CRC32 自己算，不從任何 CDN 載函式庫。
   🔴 中文檔名：general purpose bit 11（UTF-8）要設，否則 Windows 檔案總管顯示亂碼（相-27）；說明.txt 加 BOM。
   🔴 手機記憶體：逐張取檔、算完 CRC 就丟掉 ArrayBuffer，最後的 zip 由【Blob 各段】組成（瀏覽器可以放磁碟），
      不先把所有檔案串成一個大陣列。
   取檔順序：這台有乾淨原檔（去過 GPS）⇒ 用這台的；否則雲端有原檔 ⇒ 下載；都沒有 ⇒ 壓縮版。
   ══════════════════════════════════════════════════════════════ */
const _CRC_TABLE = (()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; }
  return t; })();
function crc32(u8){
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c = _CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF)>>>0;
}
/* 檔名清理：/ \ : * ? " < > | 換成 _（§11）；控制字元也換掉；空的給「未命名」 */
function zipSafeName(s){
  const t=String(s==null?'':s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g,'_').trim();
  return t || '未命名';
}
function dosTimeDate(d){
  const time=((d.getHours()&31)<<11) | ((d.getMinutes()&63)<<5) | ((Math.floor(d.getSeconds()/2))&31);
  const date=(((d.getFullYear()-1980)&127)<<9) | (((d.getMonth()+1)&15)<<5) | (d.getDate()&31);
  return {time, date};
}
/* files：[{name, blob}] ⇒ Blob（application/zip）。一次只把一個檔讀進記憶體。 */
async function buildStoreZip(files, onStep){
  const enc=new TextEncoder(), parts=[], central=[];
  const {time, date}=dosTimeDate(new Date());
  let offset=0;
  for(let i=0;i<files.length;i++){
    const f=files[i];
    const nameB=enc.encode(f.name);
    let crc, size;
    { const buf=new Uint8Array(await f.blob.arrayBuffer()); crc=crc32(buf); size=buf.length; }   // 算完就丟
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);   // bit 11＝UTF-8
    lh.setUint16(8,0,true); lh.setUint16(10,time,true); lh.setUint16(12,date,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,size,true); lh.setUint32(22,size,true);
    lh.setUint16(26,nameB.length,true); lh.setUint16(28,0,true);
    parts.push(lh.buffer, nameB, f.blob);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true);
    ch.setUint16(10,0,true); ch.setUint16(12,time,true); ch.setUint16(14,date,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,size,true); ch.setUint32(24,size,true);
    ch.setUint16(28,nameB.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,offset,true);
    central.push(ch.buffer, nameB);
    offset += 30 + nameB.length + size;
    onStep && onStep(i+1, files.length);
  }
  const cdSize=central.reduce((n,b)=>n+(b.byteLength!=null?b.byteLength:b.length),0);
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(4,0,true); end.setUint16(6,0,true);
  end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,offset,true); end.setUint16(20,0,true);
  return new Blob(parts.concat(central,[end.buffer]), {type:'application/zip'});
}
/* 說明.txt 的一個欄位值：多行時每行前加兩個空格（§11） */
const zipTxtVal = s => String(s==null?'':s).split(/\r?\n/).join('\r\n  ');
/* 匯出一本相簿。opt.returnBlob＝只回傳 zip（自驗用），不觸發下載。 */
let _zipBusy=false;
async function exportAlbumZip(albumId, opt){
  const a=albumOf(albumId); if(!a) return null;
  if(_zipBusy) return null;
  _zipBusy=true;
  const say=t=>{ S.photoMsg=t; const b=document.querySelector('#albView .pstat .bad'); if(b) b.textContent=t; else renderAlbums(); };
  try{
    const aps=apsOf(albumId);
    const w=Math.max(2, String(aps.length).length);
    const files=[], lines=[];
    lines.push('format: deco-album/1', `album: ${zipTxtVal(albName(a))}`, `exported_at: ${localStamp(new Date()).replace(' ','T').replace(' ','')}`, '');   // §11：ISO 8601（當地時間＋時差，例 2026-09-30T16:00:13+08:00）
    for(let i=0;i<aps.length;i++){
      const ap=aps[i], p=PHOTOS.get(ap.photoId);
      say(`匯出中…取照片 ${i+1} / ${aps.length} 張`);
      let blob=null, original=false;
      if(p && p.orig && p.origClean){ blob=p.orig; original=true; }
      else if(p && p.origStatus==='has' && p.origPath && CLOUD.on){
        try{ const r=await sbFetch('/storage/v1/object/photos/'+p.origPath); if(r.ok){ blob=await r.blob(); original=true; } }catch(e){}
      }
      if(!blob && p && p.small){ blob=p.small; original=false; }
      if(!blob) continue;                                  // 連壓縮版都沒有（還沒下載）⇒ 這張跳過，說明.txt 也不寫
      const seq=String(i+1).padStart(w,'0');
      /* 🔴 批 7 自驗（TEST 雲端那一趟）抓到：照片名常是檔名（B7_Y.jpg）⇒ 變成「01_B7_Y.jpg.jpg」。⇒ 名字尾巴的圖片副檔名先拿掉（F-1 同一條規則）。 */
      const base=zipSafeName(String(ap.name||'').replace(FILE_NAME_RE,'').trim() || '未命名');
      const file=`${seq}_${base}${original?'':'_壓縮版'}.jpg`;
      files.push({name:file, blob});
      lines.push(`seq: ${seq}`, `file: ${file}`, `name: ${zipTxtVal(ap.name||'')}`, `note: ${zipTxtVal(ap.note||'')}`,
                 `shot_at: ${p ? shotAtOf(p) : ''}`, `original: ${original?'yes':'no'}`, '');
    }
    const txt=new Blob([new Uint8Array([0xEF,0xBB,0xBF]), new TextEncoder().encode(lines.join('\r\n'))], {type:'text/plain'});
    files.push({name:'說明.txt', blob:txt});
    const zip=await buildStoreZip(files, (n,m)=>say(`匯出中…打包 ${n} / ${m} 個檔`));
    if(opt && opt.returnBlob) return zip;
    const zname=`${zipSafeName(albName(a))}.zip`;
    const u=URL.createObjectURL(zip);
    const link=document.createElement('a'); link.href=u; link.download=zname;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(u), 60000);
    /* §11：完成後告訴使用者檔案存到哪 */
    say(`已匯出「${zname}」（${files.length-1} 張＋說明.txt）。檔案在瀏覽器的下載資料夾（iPhone：「檔案」App →「下載項目」）。`);
    return zip;
  }catch(e){
    say('匯出失敗：'+((e&&e.message)||e));
    return null;
  }finally{
    _zipBusy=false;
  }
}
