"use strict";

/* ══════════════════════════════════════════════════════════════
   需求 8｜清單頁（版位依預覽 v0.04 確認）
     分組標題：[房間色小橫條] 房間名　N 件
     卡片    ：[色條4px][icon 欄 46px 留空] 名稱／尺寸 ＋ [計價][已擺] ＋ 價錢
     分組順序：各房間 → 最後是「未擺放」（色條用中性灰）
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.05_i §4（修四）：清單卡片上的三個就地編輯欄（name / price / note）
   共用一套「即時改記憶體＋畫面、失焦才存」的顆粒度（需求 7）：
     input            → 記下 dirty（price 另外做無效標示），不存
     blur / Enter     → commitCardEdits()
     visibilitychange → commitCardEdits()（手機鎖屏／切 App 時 blur 不可靠）
   ⚠️ 原本只有 name（`_nameDirty`），本輪擴成三個欄位，改用 `id::欄位` 當 key。 */
/* 🔴 v0.07_i 需求 26：從 Set<key> 改成 Map<key, 使用者打的原始字串>。
   ⚠️ 原本的弱點（claude 重現時發現，**不是** Ali 這次踩到的路徑，見 v0.07_i §0-2b）：
        值只存在 DOM 的 input 裡，commitCardEdits() 存檔時才回頭去 DOM 撈
        ⇒ 若在存檔之前 buildList() 重建了清單，那個 input 就不存在了
        ⇒ `if(!inp) continue` ⇒ 值【安靜地丟掉】，
           而 _cardDirty 在函式開頭就已 clear ⇒ 連重試的機會都沒有
   ⇒ 改成值一律從 Map 取，不再依賴 DOM 還在不在。
      「還原成上一個有效值」「移除紅框」仍要摸 DOM ⇒ 那兩步只在 inp 存在時做；
      inp 不存在時【只寫值、跳過畫面還原】（清單等下會被重建，本來就會重畫）。 */
let _cardDirty=new Map();
const cardKey=(id,fld)=>id+'::'+fld;
/* ╔═ 🔬 v0.15_i 修一-查｜commitNameEdits()／commitCardEdits() 有沒有同一個病？ ═╗
   結論：【沒有】。三個理由，缺一都會變成同一個病：
     ① 它不是「掃過所有欄位讀 DOM」，而是【只處理使用者真的打過字的那幾格】——
        來源是 _cardDirty（只有 input 事件會寫進去），不是 querySelectorAll。
     ② 值取自 Map 的 rawVal（v0.07_i 需求 26 改的），【不是】 inp.value
        ⇒ 就算卡片被 buildList() 重建、input 已經不在，也不會讀到別人的殘留值。
     ③ key 是 `id::欄位` ⇒ 永遠寫回【當初被編輯的那一筆】，不可能跨物件汙染。
   ＋ 第一行 `if(!_cardDirty.size) return;` 本身就等同於修一-a 的守衛
     （沒編輯過就什麼都不做）。
   ⚠️ 給下一手：若哪天有人把 ② 改回「commit 時回頭去 DOM 撈」，這個病會立刻長回來。╚═╝ */
function commitCardEdits(){
  if(!_cardDirty.size) return;
  const entries=[..._cardDirty.entries()]; _cardDirty.clear();
  let touched=false;
  for(const [key,rawVal] of entries){
    const [id,fld]=key.split('::');
    const inp=document.querySelector(`.cardedit[data-id="${id}"][data-fld="${fld}"]`);
    const f=FURN.find(x=>x.id===id);
    if(!f) continue;                       // 🔴 只有「這一筆不在了」才跳過，不再看 inp
    const raw=String(rawVal==null?'':rawVal).trim();
    if(fld==='price'){
      /* 需求 7（v0.04_i §7）：無效 → 還原成【上一個有效值】、移除紅框；
         清空 → null（未填），🔴 不是 0 ⇒ 卡片回到顯示「缺價錢」。 */
      if(raw!=='' && !/^\d+$/.test(raw)){
        /* 🔴 需求 26：值無效 → 不寫入（與現況一致）。
           畫面還原（還原成上一個有效值＋移除紅框）要摸 DOM ⇒ 只在 inp 還在時做；
           inp 不在＝清單已重建，重建時本來就會顯示舊值，不需要還原。 */
        if(inp){ inp.value = f.price==null ? '' : String(f.price); inp.classList.remove('bad'); }
        continue;
      }
      if(inp) inp.classList.remove('bad');
      const v = raw==='' ? null : parseInt(raw,10);
      if(f.price!==v){ f.price=v; touched=true; saveItem(f).catch(e=>cloudErr(e)); }
      continue;
    }
    if(LEN_CARD_FIELDS.includes(fld)){
      /* 🔴 需求 22：清單展開列的寬／深／高，沿用需求 7 的輸入規則。
         🔴 與選中面板改的是【同一個值】（同一個 FURN 物件、同一個 saveItem）。
         🔴 v0.17_i C-6：離地（zBase）走同一條路，但判準是 v>=0（見 badLen）。
            照字面把它丟進「其餘一律當字串」那個分支的話，打成 "3o" 會讓
            toMM 把 NaN 寫進 IndexedDB —— 沒有紅框、沒有還原、沒有錯誤。 */
      const v = raw==='' ? null : parseFloat(raw);
      if(badLen(fld, raw, v)){
        // 🔴 需求 26：同上，畫面還原只在 inp 還在時做
        if(inp){ inp.value = f[fld]==null ? '' : String(Math.round(f[fld]*10)/10);
                 inp.classList.remove('bad'); }
        continue;
      }
      if(inp) inp.classList.remove('bad');
      /* 🔴🔴 v0.1.4.2 建造者實測抓到的缺陷（v0.1.4.1 需求 22 引入、已上線）：
         這裡【不可以】用 `if(f[fld]!==v)` 當「有沒有改」的判準。
         理由：需求 22 的 input handler 為了讓「還沒填尺寸」立刻消失、
               並讓平面圖同屏看後果（BP-F2），已經把值【先寫進記憶體】了
               ⇒ commit 時 f[fld] 早就等於 v ⇒ 判成「沒變」⇒ 【不存檔】
         最小重現（實測）：只改尺寸、不碰其他欄位 → commit → IndexedDB 仍是 null
               → 下一次 reloadObjects()（同步／按〔已擺〕／重新載入）把記憶體抹回 null
               ⇒ 140 變成 null，而畫面在被抹掉之前一直顯示 140
         ⚠️ 之前沒被抓到，是因為只要同一張卡片有【別的】欄位一起提交（例如價錢），
            saveItem(f) 會把整個物件寫下去 ⇒ 尺寸被順便存到 ⇒ 症狀時有時無。
         ⇒ 改成【有效就一律存】。多一次寫入的成本遠低於靜默掉資料。 */
      f[fld]=v; touched=true; saveItem(f).catch(e=>cloudErr(e));
      continue;
    }
    // name / note：文字，空字串就是空字串
    if(f[fld]!==raw){ f[fld]=raw; touched=true; saveItem(f).catch(e=>cloudErr(e)); }
  }
  render();
  if(touched) buildList();      // 讓「缺價錢」⇄ 數字、未命名 ⇄ 名稱的顯示跟上
}
/* 舊名保留為別名：setTab／visibilitychange 兩個既有呼叫點不必改語意 */
function commitNameEdits(){ commitCardEdits(); }
/* 🔴 v0.17_i §0-5 C-6 ＋ 新引入-2｜離地（zBase）併進 w/d/h 的【浮點分支】，
   但判準不同：w/d/h 必須 > 0，而【離地可以是 0】（放在地上）。
   ⚠️ 兩處都要用這一支（cardInput 的 input handler／commitCardEdits），
      只改一處＝半套：離地填 0 會被標紅框而且不寫入，或者打錯字時 NaN 進 IndexedDB。 */
const LEN_CARD_FIELDS = ['w','d','h','zBase'];
/* ╔═ 🔴 v0.17_i 丙-2 ＋ 丙-3｜卡片上那行尺寸字：【同兩行、四件事，一次改完】════╗
   那行字（.dim）只在 itemCard() 建立一次，但它的 textContent 與 class 會被
   cardInput() 的 w/d/h input handler【整個重寫】（3929-3934，而且是 className 賦值）。
   四件事全部落在同兩行，不可分批：
     ① 修三　　「還沒填尺寸」要有可點的外觀（class）
     ② 修十三　小數不可以被 Math.round 吃掉（textContent）
     ③ §0-6 B-4　className 賦值會洗掉 ① ⇒ 一律經過同一支，讓它【重算】而不是被清掉
     ④ 修九　　沒尺寸時它是「你還缺這個」的常駐標記（O-13）
   ⇒ 兩處（itemCard 建立時／cardInput 打字時）都只呼叫 applyDim()，不各自拼字串。
   🔴 只改一處的症狀：她在展開列把寬改成 12.5 的【當下】，另一處立刻把卡片那行寫回 13
      ⇒ 在「填完重新載入」的測法下會過，在「邊填邊看」的測法下會失敗 —— 而她是邊填邊看的。
   ⚠️ 可點性綁在【元素本身】（建立時掛的 onclick），不是綁在 class 上
      ⇒ class 被重算也不會掉。（B-4 的兩個候選做法，建造者選的是這一個。）╚═══════╝ */
const dim1 = v => (v==null ? '' : String(Math.round(v*10)/10));   // 修十三：保留一位小數
function dimText(f){
  if(f.w==null || f.d==null) return '還沒填尺寸';
  return `${dim1(f.w)} × ${dim1(f.d)}` + (f.h!=null ? ` × ${dim1(f.h)}` : '') + ' cm';
}
function dimClass(f){
  /* missbtn ＝ 修三的「可點外觀」。只有缺尺寸那個狀態才給它，
     填完之後它就是一行普通的資訊（卡片本體仍然點得開，見修十四）。 */
  return (f.w==null || f.d==null) ? 'dim miss missbtn' : 'dim';
}
function applyDim(dm, f){
  if(!dm) return;
  dm.className = dimClass(f);
  dm.textContent = dimText(f);
}
/* ╔═ 🔴 v0.17_i §0-5 D-4 ＋ 新引入-3｜展開這一列並把游標送進第一個缺的欄位 ══════╗
   修三與修九【共用這一支】，不可以寫兩次。順序寫死（少一步就靜默失敗）：
     ① commitCardEdits()
     ② S.expandId / S.expandCause  ← 🔴 cause 由呼叫端給（D-3），不可沿用上一次的值
        （展開列只有在 S.expandId===f.id 時才被建立 ⇒ 不設它，欄位根本不存在）
     ③ buildList()                 ← 🔴 它第一行 box.innerHTML='' ⇒ 舊節點全丟
     ④ 之後才 querySelector → focus（在 buildList 之前抓參照再 focus ＝ 打在已脫離
        文件的節點上，不報錯、activeElement 仍是 body ⇒「展開了但游標不在裡面」）
   ⚠️ price 在 r2、不在展開列 ⇒ 那一支不需要展開，但仍然走 ③④（buildList 會重建整張卡片）。╚═╝ */
function focusFirstMissing(id, opts){
  const o=opts||{};
  commitCardEdits();
  const f=FURN.find(x=>x.id===id); if(!f) return;
  S.expandId=id; S.expandCause=o.cause||'manual';
  buildList();
  const fields=o.fields||['w','d','h','price'];
  const miss=fields.find(k=>f[k]==null);
  if(!miss) return;
  const el=document.querySelector(`.cardedit[data-id="${id}"][data-fld="${miss}"]`);
  if(!el) return;
  try{ el.closest('.icard').scrollIntoView({block:'center'}); }catch(e){}
  el.focus();
}
function badLen(fld, raw, v){
  if(raw==='') return false;
  const min = (fld==='zBase') ? 0 : Number.MIN_VALUE;   // 🔴 離地 >=0，其餘 >0
  return !isFinite(v) || v < min;
}
/* 卡片上的就地編輯欄工廠
   🔴 v0.17_i 修四 ⑩：只有 note 走 <textarea>（Ali 要備註能換行）。
      ⚠️ cardInput 是共用函式 —— 不可以整個改成 textarea，那會弄壞價錢與尺寸欄。 */
function cardInput(f, fld, opts){
  const o=opts||{};
  const inp=document.createElement(fld==='note' ? 'textarea' : 'input');
  inp.className='cardedit '+(o.cls||'');
  inp.dataset.id=f.id; inp.dataset.fld=fld;
  inp.value = o.value!=null ? o.value : (f[fld]==null ? '' : String(f[fld]));
  if(o.placeholder) inp.placeholder=o.placeholder;
  if(o.inputmode) inp.setAttribute('inputmode',o.inputmode);
  inp.onclick=e=>e.stopPropagation();
  inp.addEventListener('input',()=>{
    /* 🔴 需求 26：把【值】一起記進 Map，不要只記「哪個欄位被改了」。
       同一欄位連打多次 → Map 覆蓋，最後一次為準。 */
    _cardDirty.set(cardKey(f.id,fld), inp.value);
    const raw=inp.value.trim();
    /* 打字中：不阻止、不還原、不寫入 —— 但無效就加紅框，
       讓「這個值沒被採用」看得出來（_d §10-0b 允許狀態提示）。 */
    if(fld==='price'){
      inp.classList.toggle('bad', raw!=='' && !/^\d+$/.test(raw));
    }else if(LEN_CARD_FIELDS.includes(fld)){
      const v=parseFloat(raw);
      const bad=badLen(fld, raw, v);
      inp.classList.toggle('bad', bad);
      /* 🔴 需求 22 邊界：在清單填完尺寸 → 卡片上的「還沒填尺寸」要立刻消失。
         ⇒ 有效值當下就寫記憶體並重畫（與需求 7「即時算、失焦才存」一致：
            這裡只改記憶體與畫面，不存檔）。 */
      if(!bad){
        f[fld] = raw==='' ? null : v;
        /* 🔴 丙-2／丙-3：這裡是【第二處】。與 itemCard 走同一支 applyDim，
           不再各自拼字串（只改一處＝她邊填邊看時會被寫回整數）。 */
        const card=inp.closest('.icard');
        if(card) applyDim(card.querySelector('.dim'), f);
        render();
      }
    }
  });
  inp.addEventListener('blur',()=>commitCardEdits());
  /* 🔴 備註改成 textarea 之後，Enter 是【換行】不是存檔 ——
     沿用舊的 Enter→blur 會讓「能換行」這件事做了等於沒做。其餘欄位一行不改。 */
  if(fld!=='note')
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter') inp.blur(); });
  return inp;
}
/* 🔴 v0.17_i 修九：卡片【閃一下】（一次、短，不是持續動畫）。
   ⚠️ 必須對「buildList() 重建之後的那一張」呼叫 —— 舊節點已經不在文件上。 */
function flashCard(id){
  const c=document.querySelector(`.icard[data-id="${id}"]`);
  if(!c) return;
  c.classList.remove('flash');
  void c.offsetWidth;                      // 強制 reflow，動畫才會重新播一次
  c.classList.add('flash');
  c.addEventListener('animationend', ()=>c.classList.remove('flash'), {once:true});
}
function chipBtn(label,on,onClick){
  const b=document.createElement('button');
  b.className='chip'+(on?' on':'');
  b.textContent=label;
  b.onclick=e=>{ e.stopPropagation(); onClick(); };
  return b;
}
/* ╔═ 🔴 v0.17_i 修四 ⑩ ＋ 修一｜展開列（四列表，整張卡片寬）════════════════════╗
     第一行　[房間 ▾] 離地[ ] 寬[ ] 深[ ] 高[ ] cm　（🔴 cm 只出現一次）
     第二行　備註[textarea]
     第三行　照片 [＋]（以後版本，保留格）
     最後　　🗑（靠右，與第一行的 cm 右緣同一側）
   🔴 它掛在 .body 不掛在 .col ⇒ 不縮排、不讓給 icon 欄（§0-5 D-2 的 DOM 重組）。
   🔴 所有欄位一律走 cardInput ⇒ _cardDirty（key 是 `id::欄位`）那一套；
      【不可以】新寫一套「commit 時回頭去 DOM 撈」（那會把 v0.1.5.1 修好的坑復活）。╚═╝ */
function cardEditRow(f){
  const ed=document.createElement('div'); ed.className='cedit';
  /* 修十四 ④ 的狀態指示之二：小 ▴（只在展開時存在，純視覺） */
  const mk=document.createElement('span'); mk.className='opmark'; mk.textContent='▴';
  ed.appendChild(mk);

  const r1=document.createElement('div'); r1.className='crow1';
  const sl=document.createElement('select');
  const o0=document.createElement('option'); o0.value=''; o0.textContent='未指定';
  sl.appendChild(o0);
  ROOMS.forEach(r=>{ const o=document.createElement('option');
    o.value=r.id; o.textContent=r.name||'未命名'; sl.appendChild(o); });
  sl.value = f.room || '';
  sl.onclick=e=>e.stopPropagation();
  sl.onchange=async e=>{
    e.stopPropagation();
    commitCardEdits();                     // 先把同一列的備註存掉，再改房間
    const v=sl.value;
    if(!v){
      if(S.expandCause==='chip'){          // 選「未指定」→ 收起，動作鈕維持「擺上圖」
        S.expandId=null; S.expandCause=null; buildList(); return;
      }
      f.room=null; f.isPlaced=false;       // 手動展開時，「未指定」＝真的把房間清掉
      await saveItem(f);
      await reloadObjects(); render(); buildList(); refreshTop(); return;
    }
    f.room=v;
    /* 🔴 §0-5 E-4：S.listNote【會殘留】——setTab 不清它，只有 › 成功跳分頁那一次會清。
       ⇒ 修二的新訊息要有清除點：選到房間＝那句話講的事情已經解決了。
       ⚠️ 只加訊息不加清除點的後果：她選完房間回到清單，那句話還掛在上面。 */
    S.listNote='';
    if(S.expandCause==='chip') f.isPlaced=true;
    if(f.isPlaced) placeIntoRoomIfOutside(f);
    await saveItem(f);
    /* ╔═ 🔴🔴 v0.19_i §下-1｜指定房間之後，卡片【留在原處】═══════════════════════╗
       只改這一行：從「清成 null」改成【保留 expandId、cause 改成 'manual'】。
       🔴 不可以更早改 ⇒ 改早了上面 4647 的 `S.expandCause==='chip'` 判不成立
          ⇒ 東西不會被擺上圖，而且畫面不說任何話（N-415 就是在測這個）。 */
    if(S.expandCause==='chip'){ S.expandCause='manual'; }
    /* 🔴 §下-10 的交互：目標那一組若是收合的 ⇒ **自動展開它**
       （Ali：「如果是移動完，為了高亮他需要展開」）。🔴 要在 buildList 之前做。 */
    if(S.foldRooms[v]){ delete S.foldRooms[v]; saveFold(); }
    await reloadObjects(); render(); buildList(); refreshTop();
    /* 🔴 順序：展開 → buildList → 捲到【分組標題】→ **最後**才閃。
       閃在重建之前會被洗掉（flashCard 要對重建後的節點呼叫）。
       🔑 甲說「它動了」、乙說「它去了哪一組」——兩件事，不可以只做一件。 */
    const gh=document.querySelector(`.grp[data-room="${v}"]`);
    if(gh) gh.scrollIntoView({block:'start', behavior:'smooth'});
    flashCard(f.id);
    /* 邊界：🔴 不可以順手把游標塞進備註欄 —— 她沒有說要打字。 */
  };
  r1.appendChild(sl);
  /* 🔴 ⑨ 欄位標籤【常駐】。離地是本批新加的（需求 46 之後一直只有欄位、沒有 UI）。 */
  [['zBase','離地'],['w','寬'],['d','深'],['h','高']].forEach(([k,lab])=>{
    const box=document.createElement('div'); box.className='szbox';
    const lb=document.createElement('label'); lb.textContent=lab;
    const ip=cardInput(f,k,{cls:'sz', inputmode:'decimal',
      value: f[k]==null ? '' : String(Math.round(f[k]*10)/10)});
    box.appendChild(lb); box.appendChild(ip);
    r1.appendChild(box);
  });
  const un=document.createElement('span'); un.className='unit'; un.textContent='cm';
  r1.appendChild(un);
  ed.appendChild(r1);

  const r2=document.createElement('div'); r2.className='crow';
  const lb2=document.createElement('label'); lb2.textContent='備註';
  r2.appendChild(lb2);
  r2.appendChild(cardInput(f,'note',{cls:'note'}));
  ed.appendChild(r2);

  const r3=document.createElement('div'); r3.className='crow';
  const lb3=document.createElement('label'); lb3.textContent='照片';
  const ph=document.createElement('button'); ph.className='holdbtn';
  ph.textContent='＋'; ph.disabled=true;
  r3.appendChild(lb3); r3.appendChild(ph);
  ed.appendChild(r3);

  /* 🔴 修一：刪除入口。confirmDeleteItem 的邏輯【一行不改】，只是多一個呼叫點。
     🔴 丙-12：它是展開列裡【新增的】元素 ⇒ 要自己 stopPropagation，
        否則點它會連帶被修十四的「點卡片＝展開／收合」吃掉。 */
  const r4=document.createElement('div'); r4.className='crow trashrow';
  const del=document.createElement('button'); del.className='delbtn';
  del.textContent='🗑'; del.title='刪除這一件';
  del.onclick=e=>{ e.stopPropagation(); confirmDeleteItem(f.id); };
  r4.appendChild(del);
  ed.appendChild(r4);
  return ed;
}
function itemCard(f){
  const placed=!!f.isPlaced;
  const card=document.createElement('div');
  /* 🔴 修十四 ④：展開狀態要看得出來（底色微變，配 .cedit 的小 ▴） */
  card.className='icard'+(S.expandId===f.id ? ' open' : '');
  /* 🔴 丙-7：修十二〔檢視〕要靠 .icard[data-id] 捲動定位，不可以靠 .nm。 */
  card.dataset.id=f.id;
  const st=document.createElement('div'); st.className='stripe';
  /* 🔴 v0.17_i 乙-0 ②：已擺 → 房間色；待擺 → 無色；
     孤兒（isPlaced 但那間房已被另一台刪掉）→ 也是無色（沒有活著的房間可以取色，
     而且它會被分到「未指定房間」組）。 */
  st.style.background = (placed && roomAlive(f.room)) ? roomColor(f.room) : 'transparent';
  card.appendChild(st);
  const body=document.createElement('div'); body.className='body';
  const inb=document.createElement('div'); inb.className='in';
  /* 🔴 icon 欄【留空】：不畫邊框、不畫底色、不放佔位圖示 —— 就是內距（46px） */
  const ic=document.createElement('div'); ic.className='icon';
  /* ╔═ 🔴 v0.19_i §下-9 邊界（Ali 裁決）：**家具備註也要同一個記號** ═══════════╗
     收合的卡片上就要看得出這一件有沒有寫過備註（.cedit 只在展開時才建）。
     🔴 Ali 的硬約束：「不可以再擠掉名稱的寬度」。
     🔬 建造者實測了兩個落點，都不合格：
        ① 放進 .r1（flex:none）⇒ 名稱欄 136.3px → 116.9px（−19.4px）＝ 擠掉了
        ② .r1 內絕對定位（right:0）⇒ 名稱寬度保住了，但記號 294–312
           正好蓋住尺寸文字的尾巴（實測「100 × 60 cm」的字右緣就是 312）⇒ 蓋掉資料，更糟
     ✅ 採用【現成的 46px icon 欄】：它就在名稱左邊、本來就是空的
        ⇒ 名稱寬度一格不少、也不蓋住任何字。
     ⚠️ 這是建造者提的落點（`_i` 說「位置由建造者提」），**不是 Ali 指定的**。
        🔴 已知代價：下一批若要在這一欄放家具類別 icon，兩者會搶同一格 ⇒ 屆時要重新安排。 */
  /* 🔴 v0.20_i 下-12：從「整格 textContent」改成【左上角的小角標】。
     🔴 title 要掛在 .notetag 這個 span 上，**不可以留在 ic 上** ——
        留在 ic 上的話 title 會掛在整格 46px，之後品項 icon 進來，
        就變成「滑過家具圖示跳出『這一件有備註』」（讀坑 12）。 */
  if((f.note||'').trim()){
    const tag=document.createElement('span');
    tag.className='notetag';
    tag.textContent='🏷️';
    tag.title='這一件有備註';
    ic.appendChild(tag);
  }
  inb.appendChild(ic);

  const col=document.createElement('div'); col.className='col';
  const r1=document.createElement('div'); r1.className='r1';
  const nm=cardInput(f,'name',{cls:'nm'+(f.name?'':' ph'), placeholder:'未命名'});
  /* 缺什麼直接寫在卡片上（_d §9-1b 允許不完整，§9-2 結算前要抓）
     🔴 v0.17_i 修三：這塊字【變成可點區域】——
        Ali：「還沒填尺寸那一個位置，改成可以讓下面展開的 ui 拉，展開的向下箭頭在手機上面好難按」
     🔴 可點性掛在【元素身上】，不掛在 class 上 ⇒ 打字時 class 被重算也不會掉（§0-6 B-4）。 */
  const dm=document.createElement('span');
  applyDim(dm, f);
  dm.onclick=e=>{
    if(!(f.w==null || f.d==null)) return;      // 填完了就是一行普通資訊，交給卡片本體處理
    e.stopPropagation();                        // 🔴 不要再被修十四的「點卡片＝切換」收合掉
    focusFirstMissing(f.id, {fields:['w','d','h','price'], cause:'manual'});
  };
  r1.appendChild(nm); r1.appendChild(dm);
  col.appendChild(r1);

  const r2=document.createElement('div'); r2.className='r2';
  r2.appendChild(chipBtn('計價', !!f.isBudgeted, async()=>{
    f.isBudgeted=!f.isBudgeted; await saveItem(f); buildList();
  }));
  /* ╔═ 🔴 v0.17_i 乙-0 ①／乙-6｜一顆【會換臉的動作鈕】，取代舊的〔已擺〕chip ═══╗
     待擺 →〔擺上圖〕：按下去會把它擺上去，而且【畫面會帶你過去看】（需求 24 的三件）
     已擺 →〔收回清單〕：與平面圖上那顆同名（修五），從圖上拿下來、anchor 保留
       🔴 v0.21_i B-3（Ali 2026-09-28）：與平面圖那顆一起拿掉 ↩ —— 同一個動作、同一個名字。
          （↩ 是「返回」的通用圖示，下-26 拿掉它的理由在這裡同樣成立。）
          📌 只改字，不加 .recall 的藍框：這裡是清單卡片的 .act，旁邊沒有會混淆的〔回主畫面〕。
     🔴 不做兩段切換條：兩段裡永遠只有一段可按 ⇒ 第二段不必存在（_d §13-36 已結案）。
     🔴 它是【動作鈕】不是 chip ⇒ 不進入 _d §10-0e「點亮＝有」那套語意。 ╚═════╝ */
  /* 🔴 v0.17_i 修九（Ali 裁決走甲）＋ 丙-8：缺寬或缺深時，【擺上圖】這個方向要擋住。
     擋的標的就是這顆鈕（丙-8：規格原本寫「鎖住〔已擺〕那一段」，
     而那一段在待擺的卡片上根本不存在 ⇒ 照字面做等於沒做）。
     🔴 守衛只擋 false→true：收回那個方向不可以被擋（萬一資料不一致仍要收得回來）。 */
  const noSizeYet = (f.w==null || f.d==null);
  const act=document.createElement('button');
  act.className='act'+((!placed && noSizeYet) ? ' locked' : '');
  act.textContent = placed ? '收回清單' : '擺上圖';
  act.onclick=e=>{
    e.stopPropagation();
    if(!placed && noSizeYet){
      /* 不切分頁、不跳任何對話框：卡片閃一下（一次、短），
         然後自動展開並把游標送進【第一個缺的欄位】（與修三同一支）。
         🔴 cause='chip'：她的意圖確實是「要擺上去」，只是缺尺寸
            ⇒ 填完之後由既有的 sl.onchange／擺上圖 那條路自動擺上去是對的（D-3）。 */
      /* 🔴 順序：先 focusFirstMissing（它會 buildList ⇒ 這張卡片被整個換掉），
         再對【重建後的那一張】閃。反過來寫的話動畫會連同舊節點一起被丟掉，
         而且不報錯 —— 畫面上就是「什麼都沒發生」（O-18）。 */
      focusFirstMissing(f.id, {fields:['w','d'], cause:'chip'});
      flashCard(f.id);
      return;
    }
    setPlaced(f.id, !placed);
  };
  r2.appendChild(act);
  /* 🔴 v0.05_i §4（修四）：價錢的位置就是輸入框（含「缺價錢」那個狀態）。
     ⚠️ 不另外開對話框。「缺價錢」用 placeholder 呈現（warnA 色），
        所以「點缺價錢 → 就地打字」是同一個元素，沒有第二個狀態要維護。
     🔴 is_budgeted=false 的項目照樣能填價錢（_d §9-1：兩個布林互相獨立）。 */
  const pw=document.createElement('span'); pw.className='pricewrap';
  const cur=document.createElement('span'); cur.className='cur'; cur.textContent='$';
  cur.hidden = (f.price==null);
  const pi=cardInput(f,'price',{cls:'price', placeholder:'缺價錢', inputmode:'numeric',
    value: f.price==null ? '' : String(f.price)});
  pi.addEventListener('input',()=>{ cur.hidden = (pi.value.trim()===''); });
  pw.appendChild(cur); pw.appendChild(pi);
  r2.appendChild(pw);
  col.appendChild(r2);

  inb.appendChild(col);

  /* 🗑 v0.17_i 修十四 ①：卡片右側那顆 ▾【拿掉了】。
     Ali：「兩個按鈕沒有畫面指引，我想要整合成一個」＋ 舊抱怨「▾ 在手機上好難按」
     ⇒ 展開／收合改綁在【整張卡片】上（見下方 card.onclick），右側只留 ›。
     🔴 這是【拿掉一個現有控制項】，已明寫並經 Ali 2026-09-18 同意（obs O-27）。 */
  /* 🔴 v0.19_i §下-2：`›` → 📍（行為一行不動，go.onclick 整段原樣）。
     ⚠️ emoji 不吃 CSS color ⇒ .icard .go{color:var(--accent)} 對它失效
        ⇒ 這顆鈕會脫離「藍色＝可按」的語彙。實際長相已回報，由 Ali 決定要不要改自繪 SVG。 */
  const go=document.createElement('button'); go.className='go'; go.textContent='📍';
  /* 🔴 v0.09_i 需求 30：三條守衛，【只加訊息、不擋操作】。
     現況重現到的結果是：帶你到平面圖、面板出現、而畫面一片空白且不解釋
     ⇒ 同一片空白同時可能代表「沒有房間」「這一件還沒擺」「程式壞了」
     ⇒ 這是「用『什麼都沒有』表達某件事」的第七次變形。 */
  go.onclick=e=>{ e.stopPropagation(); commitCardEdits();
    /* ① 沒有任何存活的房間 → 不切分頁，在清單頁說出來。
       ⚠️ 需求 28／29 之後這種情況應該很少，但守衛仍要留（它是最後一道）。 */
    if(!ROOMS.length){ S.listNote='目前沒有任何房間。'; buildList(); return; }
    /* ╔═ 🔴 v0.17_i 修二｜沒指定房間時，› 不要把人丟到平面圖 ══════════════════╗
       Ali：「但如果不選房間，為什麼要跳到平面圖上面.....。」
       舊守衛只擋「一間房都沒有」⇒ 只要專案裡有任何房間，這一件自己沒有房間也照樣
       切過去，而它沒有座標 ⇒ 畫面停在空白區（O-18 第 6 次變形）。
       🔴 上面那條 !ROOMS.length 的守衛【留著】，它擋的是另一件事。兩條都要。
       🔴 cause='manual'（D-3）：她只是想看平面圖，不可以因此被自動擺上去。
       ⚠️ 建造者補充：§0-7-戊 的四批清單【沒有列到修二】（應是漏列，修二在 _i 有完整
          規格與 N-302~304）⇒ 併進第二批做，理由是它與修三／修九共用同一套
          「就地展開 ＋ 把游標送到該去的欄位」。已在測試待辦標明，請 Ali 確認。 ╚═══╝ */
    if(!roomAlive(f.room)){
      S.listNote='這一件還沒指定房間，先選一間再看平面圖。';
      S.expandId=f.id; S.expandCause='manual';
      buildList();
      const sl=document.querySelector(`.icard[data-id="${f.id}"] .cedit select`);
      if(sl){ try{ sl.closest('.icard').scrollIntoView({block:'center'}); }catch(err){} sl.focus(); }
      return;                       // 🔴 不要 setTab('plan')
    }
    /* ②③ 照樣過去、照樣選中——她可能就是要去看那個房間長怎樣。
       訊息由 syncSel() 依 room／isPlaced 產生。 */
    S.listNote='';
    select(f.id); centerOn(f); setTab('plan'); };
  inb.appendChild(go);
  body.appendChild(inb);
  /* 展開列（🔴 v0.05_i §4：房間下拉與備註【同一個展開狀態】，不做兩個獨立展開）
       · 需求 8 §3-2：room===null 時按〔擺上圖〕→ 由 S.expandCause='chip' 進來
       · 修十四    ：點卡片本體 → 由 S.expandCause='manual' 進來 */
  if(S.expandId===f.id) body.appendChild(cardEditRow(f));
  card.appendChild(body);

  /* ╔═ 🔴 v0.17_i 修十四 ②｜點卡片本體＝展開／收合 ════════════════════════════╗
     沿用原本 ▾ 的整段邏輯（commitCardEdits → 切換 expandId／expandCause → buildList），
     🔴 邏輯一行不改，只是換一個觸發元素；目標從 30px 的鈕變成整張卡片。
     不會誤觸的依據（查碼）：所有輸入框與下拉都已經 e.stopPropagation()，
     chipBtn 也有（3947），本批新增的〔動作鈕〕與 🗑 也各自加了。
     ⚠️ 建造者的一個收斂（規格只寫「.icard 的任何非輸入、非按鈕區域」）：
        點在【展開列內部】的空白／標籤上不收合 —— 否則她正在填欄位時碰到標籤，
        整列就關起來，而那正是修三／修九要把她送進去的地方。 ╚═══════════════╝ */
  card.onclick=e=>{
    if(e.target.closest && e.target.closest('.cedit')) return;
    commitCardEdits();
    if(S.expandId===f.id){ S.expandId=null; S.expandCause=null; }
    else { S.expandId=f.id; S.expandCause='manual'; }
    buildList();
  };
  return card;
}
/* is_placed false → true 的兩條邊界（需求 8） */
function inRoomBBox(rid,x,y){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  /* 🔴 v0.13_i 修七 F-9：這個函式 v0.12_i 整個漏列了。
     它靠牆算「在不在房間裡」，而匯入的牆 room 全 NULL ⇒ 需求 41 之後
     按〔已擺〕會判成「不在房間裡」⇒ 把家具丟回形心。
     ⇒ 有 poly 就用 poly 的外接矩形；沒有才回退舊算法。 */
  const r=ROOMS.find(z=>z.id===rid);
  if(r && validPoly(r.poly)){
    r.poly.forEach(q=>{ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]);
                        y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); });
    return x>x0 && x<x1 && y>y0 && y<y1;
  }
  const ws=WALLS.filter(w=>w.room===rid);
  if(!ws.length) return false;
  ws.forEach(w=>{x0=Math.min(x0,w.x1,w.x2);x1=Math.max(x1,w.x1,w.x2);
                 y0=Math.min(y0,w.y1,w.y2);y1=Math.max(y1,w.y1,w.y2);});
  /* ⚠️ 用【嚴格內部】而不是含邊界：新建項目的 anchor 是 (0,0)，
     而房間的左上角常常就是 (0,0) ⇒ 含邊界會判成「已經在房間裡」，
     那件家具就會卡在牆角（需求 7 明寫新建家具要放房間中心）。 */
  return x>x0 && x<x1 && y>y0 && y<y1;
}
function placeIntoRoomIfOutside(f){
  const a=f.anchor||{};
  if(a.type!=='free') return;
  if(inRoomBBox(f.room, a.x||0, a.y||0)) return;
  const c=roomCenter(f.room);
  if(c) f.anchor={type:'free', x:c.x, y:c.y};
}
/* ╔═ 🔴 v0.17_i §0-5 A-3 ＋ 新引入-1｜setPlaced(id, want) ═══════════════════════╗
   舊的 toggleChipPlaced 是【toggle】，不吃「要變成什麼」。
   乙-0 的動作鈕按下去是一個【確定的方向】（待擺→擺上去／已擺→收回），
   ⇒ 需要一個吃參數的版本，否則「狀態看得見了，但點它會說謊」。
   🔴 每一條分支的【內容】一行不改，只是為了吃參數而搬家（A-3 的鬆綁條款）。
   守衛順序（新引入-1 指定，不可換）：
     ① f.isPlaced===want ⇒ 什麼都不做（點「它現在就是這樣」＝沒事發生）
     ② want===false ⇒ 收回那一路【不檢查房間】（收回不需要房間）
     ③ 以下才是原本 false→true 的整段
   ⚠️ toggleChipPlaced 保留成薄殼：舊呼叫點（若有）語意不變。 ╚═══════════════╝ */
async function setPlaced(id, want){
  const f=FURN.find(x=>x.id===id); if(!f) return;
  if(!!f.isPlaced === !!want) return;
  if(want===false){
    /* 🔴 true → false：anchor 保留不動（與「清擺設」一致）——它記得上次擺哪 */
    f.isPlaced=false;
    await saveItem(f);
    await reloadObjects(); render(); buildList(); syncSel();
    return;
  }
  /* 🔴 v0.09_i 需求 30 ①：連一間存活的房間都沒有時，展開房間下拉是沒有意義的
     （下拉裡只會有「未指定」）⇒ 直接說出來，不要給她一個選不到東西的下拉。
     ⚠️ 只加訊息、不擋操作：她仍然可以做別的事。 */
  if(!ROOMS.length){ S.listNote='目前沒有任何房間。'; buildList(); return; }
  // 🔴 先要求選房間（不可擺到「沒有房間」）→ 展開同一個列，cause='chip'
  //    ⚠️ v0.07_i 需求 24 邊界：這一條路【一行不改】——仍然只展開房間下拉，
  //       不切分頁、不選中。選了房間之後才會走到下面。
  if(!f.room){ S.expandId=id; S.expandCause='chip'; buildList(); return; }
  f.isPlaced=true;
  placeIntoRoomIfOutside(f);
  await saveItem(f);
  await reloadObjects();
  /* ── 🔴 v0.07_i 需求 24：擺好之後【三件一起做】，順序不可換 ──
     Ali 原話：「我看不到這個東西在畫面上的哪裡，因此，我亂按平面圖的〔📏 改尺寸〕，
                看到裡面都是空白的，故重新填寫。她會改到清單中的數值。」
     claude 線上重現 v0.1.4.1：擺完之後 tab='list'、selId=null、面板隱藏
       ⇒ 物件本身沒問題（有擺好、尺寸保留、平面圖上有畫）
       ⇒ 缺的是【指向】：畫面沒有任何一處告訴她那件東西去哪了
       ⇒ 她只能在圖上猜，猜到另一件沒填尺寸的，就把尺寸填到那一件身上。
     ⚠️ 尺寸未填的照樣要帶過去——面板尺寸欄是空的【是正確的狀態】（它真的沒填）。 */
  clearPinState();             // 🔴 v0.1.9 R-20：這條路直接指定 selId（不經 select）⇒ 互斥要自己做
  S.selId = f.id;              // ① 選中它 ⇒ 面板直接出現、尺寸已經是它的值
  setTab('plan');              // ② 帶到它在的地方（setTab 內含 render/syncSel）
  ensureVisible(f);            // ③ 若它在畫面外 → 平移過去（🔴 不動 zoom）
  render(); buildList(); syncSel();
}
/* 薄殼：語意與舊版完全相同（「反轉」），給還在用 toggle 語意的呼叫點。 */
async function toggleChipPlaced(id){
  const f=FURN.find(x=>x.id===id); if(!f) return;
  return setPlaced(id, !f.isPlaced);
}
/* 🔴 v0.07_i 需求 24：只平移，【不動 zoom】。
   理由：zoom 是使用者剛剛自己調的，而長度比例尺是由 zoom 實算的（需求 14／_d §10-2c）
        ⇒ 擅自改 zoom 會讓她失去「我現在看的是幾分之一」這個參考。
   邊界：已完全在可見範圍內 → 什麼都不做（不要「為了置中」而抖一下）。 */
function ensureVisible(f){
  if(!onPlan(f)) return;
  const p=place(f);
  const {w,h}=svgSize();
  if(!(w>0&&h>0)) return;
  /* 用它的外接矩形（含旋轉）判斷，不是只看中心點 */
  const pts = hasSize(f) ? corners(p.x,p.y,f.w,f.d,p.ang,0) : [{x:p.x,y:p.y}];
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of pts){ const s=w2s(q.x,q.y);
    x0=Math.min(x0,s.x); x1=Math.max(x1,s.x); y0=Math.min(y0,s.y); y1=Math.max(y1,s.y); }
  const inside = x0>=SVG_PAD && y0>=SVG_PAD && x1<=w-SVG_PAD && y1<=h-SVG_PAD;
  if(inside) return;                                   // 已看得到 → 不動
  const z=S.zoom;                                      // 🔴 全程不改它
  S.panX = w/2 - p.x*z;
  S.panY = h/2 - p.y*z;
}
function groupHead(label,color,count,rid){
  const h=document.createElement('div'); h.className='grp';
  /* 🔴 v0.19_i §下-1／§下-9／§下-10：這個 dataset 是【捲回來的唯一抓手】。
     🔴 「未指定房間」的 rid 是 null ⇒ 用哨兵常數（全檔只有 NOROOM_KEY 一個定義）。 */
  const key = rid || NOROOM_KEY;
  h.dataset.room = key;
  const folded = isFolded(key);
  /* 🔴 §下-10：用【既有的那條色條】當開關，不新增按鈕；旁邊加一個【放大的】三角。
     🔑 只有色條的話外觀跟現在一模一樣 ⇒ 看不出可以點，
        而且收合中的那一組會長得跟「這間房沒有東西」一模一樣（obs O-13）。 */
  const sw=document.createElement('span'); sw.className='gsw';
  sw.setAttribute('role','button');
  sw.setAttribute('aria-expanded', folded?'false':'true');
  sw.title = folded?'展開':'收合';
  const bar=document.createElement('span'); bar.className='bar'; bar.style.background=color;
  const tri=document.createElement('span'); tri.className='fold';
  tri.textContent = folded ? '▸' : '▾';
  sw.appendChild(bar); sw.appendChild(tri);
  sw.onclick=()=>{ toggleFold(key); buildList(); };
  const nm=document.createElement('span'); nm.className='gname';
  /* 🔴 v0.20_i 下-13：【推翻】v0.19_i §下-10 的「收合時連 N 件都不要」。
     📌 Ali 的理由要留著：「現在有備註了，房間名稱應該不會爆掉」
        ⇒ 版面的裁決會隨旁邊的東西改變，不是一次定終身。
     ⚠️ 連帶：「這一組是收合的」訊號【仍然只剩 ▸ 一個】
        ⇒ 三角的放大（.grp .fold 15px）一行不改。 */
  nm.textContent = `${label}　${count} 件`;
  h.appendChild(sw); h.appendChild(nm);
  if(rid){
    // 需求 6：房間分組要能點進改名／刪除
    const b1=document.createElement('button'); b1.className='gbtn'; b1.textContent='改名';
    b1.onclick=async()=>{
      const r=ROOMS.find(x=>x.id===rid); if(!r) return;
      const v=await askDialog({title:'房間改名', body:'名稱可以留空（會顯示「未命名」）。',
        input:r.name||'', okText:'儲存'});
      if(v===false) return;
      await renameRoom(rid, v);
      render(); buildList(); refreshTop();
    };
    const b2=document.createElement('button'); b2.className='gbtn'; b2.textContent='刪除';
    b2.onclick=()=>confirmDeleteRoom(rid);
    /* 🔴 v0.19_i §下-9：第三顆〔🏷️ 備註〕。
       🔴 要看得出有沒有寫過（寫過才顯示 🏷️）。 */
    const rr=ROOMS.find(x=>x.id===rid);
    const hasNote = !!(rr && (rr.note||'').trim());
    const b3=document.createElement('button'); b3.className='gbtn';
    b3.textContent = hasNote ? '🏷️ 備註' : '備註';
    b3.title = hasNote ? '已寫過備註' : '加備註';
    b3.onclick=()=>openRoomNote(rid);
    h.appendChild(b1); h.appendChild(b2); h.appendChild(b3);
  }
  return h;
}
function buildList(){
  const box=$('listPage'); if(!box) return;
  box.innerHTML='';
  /* 🔴 v0.09_i 需求 30 ①：沒有房間時的狀態句（跟著清單頁走） */
  if(S.listNote){
    const n=document.createElement('div'); n.className='listnote';
    n.textContent=S.listNote; box.appendChild(n);
  }
  /* ╔═ 🔴 v0.17_i 修十｜分組【只看房間】，不再用「擺沒擺」切群組 ═══════════════╗
     Ali：「未擺這一選項，要放到他的指定房間裡面。本來的未擺變成未指定房間。」
     ⇒ 一件已經指定客廳、但還沒擺上去的桌子，要出現在【客廳】底下。
     🔴 丙-1：判準用 roomAlive(f.room)，【不可以】用 f.room 的 truthy ——
        孤兒（room 有值、但那間房已被另一台軟刪）的 f.room 是 truthy，
        用 truthy 判就會兩邊都收不下 ⇒ 從清單上安靜消失（O-18 的第 7 次變形，
        v0.09_i 需求 33 修好過一次）。
     🔴 「已擺／待擺」的區別改由【卡片上那顆會換臉的動作鈕 ＋ 左側色條】表達（乙-0）。
     ⚠️ groupHead 的「N 件」語意因此變了：從「已擺 N 件」變成「共 N 件」（含待擺）。
        這是預期的改變，已寫進交付必講。 ╚═══════════════════════════════════════╝ */
  /* 🔴 丙-1 ②：空狀態要搬家。舊版把「📋 還沒有項目」掛在【未擺放群組的 if 裡面】，
     拿掉那個群組之後，「有房間、一件家具都沒有」時清單頁會只剩幾個 0 件的房間標題、
     一句話都沒有 ⇒ 改成掛在 buildList() 頂層，判準是 !FURN.length。
     ⚠️ 位置選在【群組之前】（建造者決定）：她有 11 間房，放最後會被標題擠到看不見。 */
  if(!FURN.length){
    const e=document.createElement('div'); e.className='empty';
    e.innerHTML='<span class="ic">📋</span>還沒有項目';
    box.appendChild(e);
  }
  ROOMS.forEach(r=>{
    const items=FURN.filter(f=>roomAlive(f.room) && f.room===r.id);
    // 一個房間 0 件 → 分組標題仍顯示（「N 件」寫 0）
    box.appendChild(groupHead(r.name||'未命名', roomColor(r.id), items.length, r.id));
    // 🔴 §下-10：收合中就不畫卡片（標題仍在，靠 ▸ 表達「收起來了」）
    if(!isFolded(r.id)) items.forEach(f=>box.appendChild(itemCard(f)));
  });
  /* 🔴 「未指定房間」＝真的沒有房間可去的那些（room 為 null／空，以及孤兒）。
     它與「未擺放」不是同一件事：未擺放已經回到它自己的房間底下了。 */
  const noRoom=FURN.filter(f=>!roomAlive(f.room));
  if(noRoom.length){
    /* 🔴 §下-10：「未指定房間」那一組**也要有**折疊（Ali 指定），
       但它不是房間 ⇒ 沒有〔改名〕〔刪除〕〔🏷️ 備註〕（rid 傳 null 就是那個意思）。 */
    box.appendChild(groupHead('未指定房間','var(--dim)',noRoom.length,null));
    if(!isFolded(NOROOM_KEY)) noRoom.forEach(f=>box.appendChild(itemCard(f)));
  }
}
/* 需求 8 §3-1：點 (+) 直接建一筆新項目（🔴 不開挑選器——挑選器是 v0.1.5），
   並立刻捲動到那張新卡片、游標落在名稱欄。 */
async function addItemFromList(){
  const id=await addItem({});
  buildList();
  const inp=document.querySelector(`.nm[data-id="${id}"]`);
  if(inp){
    inp.closest('.icard').scrollIntoView({block:'center'});
    inp.focus();
  }
  refreshTop();
}
$('fabAdd').onclick=addItemFromList;

function centerOn(f){
  const p=place(f), r=svg.getBoundingClientRect();
  S.zoom=Math.max(S.zoom,.9);
  S.panX=r.width/2 - p.x*S.zoom;
  S.panY=r.height/2 - p.y*S.zoom;
}
