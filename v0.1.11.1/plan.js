"use strict";

function render(){
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  const defs=el('defs');
  const pat=el('pattern',{id:'clr',width:7,height:7,patternUnits:'userSpaceOnUse',
    patternTransform:'rotate(45)'});
  pat.appendChild(el('rect',{width:7,height:7,fill:'transparent'}));
  pat.appendChild(el('line',{x1:0,y1:0,x2:0,y2:7,stroke:'currentColor',
    'stroke-width':2.2,opacity:.5}));
  defs.appendChild(pat); svg.appendChild(defs);

  const g=el('g',{transform:`translate(${S.panX},${S.panY}) scale(${S.zoom})`});
  svg.appendChild(g);
  /* 🔴 需求 20：畫面座標圖層。掛在 g 之【後】⇒ 永遠蓋在世界內容上面，
     而且不受 translate/scale 影響 ⇒ 文字不會被 zoom/pan 推出畫面。 */
  _uiLayer=el('g',{'data-layer':'ui'});
  svg.appendChild(_uiLayer);
  const sel = FURN.find(f=>f.id===S.selId);

  /* ══ 疊圖順序（v0.20_i §2-3「固定幾段 ＋ 一張可排序的表」；v0.21_i 下-22 再修一次）══
     【世界座標 g】分區底 → 牆 → 樑 → 吸附預示（幽靈＋目標牆）
          → 【DRAW_ORDER 排序區塊：網格(5) → 家具(20) → 電器(30) → 弱電(50) → 燈具(51) → 標記(70)】
     【畫面座標 _uiLayer】房間名 → drawName()（家具名）→ **drawHUD()（左下角：走道示意＋比例尺）**
          → UI 文字（種子提示／錯誤，左上角）
     ⚠️ 樑【不可以】放在 render() 的末端 —— 那會蓋住家具與照片標記。
     🧊 Ali 2026-09-13 裁決「樑壓在牆上面」指的是【樑 vs 牆】這一對，
        不是「樑壓在所有東西上面」。
     🗂 v0.20_i 時「示意帶／比例尺」在 g 裡、排在網格之前；v0.21_i 起它們整組搬進 _uiLayer
        ⇒ 與世界座標的任何東西都不再有前後關係（永遠在最上層）。 */

  /* ╔═ 🔴 v0.17_i 六-d／六-d-2（Ali 2026-09-14 兩次更正後的定案）═══════════════════╗
     拖曳中 → 預判落點的那一間【poly 比較深】；放開 → 就是它，配色退回原本的樣子；
     沒有跨界 → 什麼都不亮，畫面保持安靜。
     ⭐ 理由（Ali 給的，比做法本身重要）：**手指在哪裡，回饋就要在哪裡。**
        拖曳的當下她在看平面圖，不會去看下面的面板 ⇒ 不做面板文字、不做撤銷鈕、不做遲滯值。
     🔴 §0-5 C-4：預判【不可以用手指的位置】，要用【放手後的真實落點】——
        有 snapCand 就用 snapCand 的 anchor（commitMove 真正會寫進去的那一組），
        否則才用手指。用手指的話：貼牆時亮的是【手指那一間】，放手後家具落在【牆另一側那一間】。
        一句話：預判要問 commitMove 會寫什麼，不要問手指在哪裡。
     🔴 §0-4-d ②：只動 polygon 這一個元素 —— 房間【名稱】是另一個獨立的 appendChild，
        不可以為了亮起來而把兩者綁在一起（她之後要讓名稱變成可打勾、不常駐）。
     ⚠️ 效能：每幀一次 pointInPoly × 房間數（11）。若之後變卡，這裡改成「移動超過 N 像素才重算」。╚═╝ */
  const predRoom = (()=>{
    if(!S.dragging) return null;
    const df=S.dragging.f;
    let rid;
    if(S.snapCand && S.snapCand.f.id===df.id){
      const c=S.snapCand;
      rid=roomOfAnchor(df, {type:'wall', wall:c.wall.id, along:c.along, off:0, side:c.side});
    }else{
      rid=roomAtPoint(S.dragging.gx, S.dragging.gy);
    }
    return (rid && rid!==df.room) ? rid : null;   // 沒有跨界 ⇒ 不亮
  })();
  /* ╔═ 🔴 v0.21_i 下-23｜房間名跟著 ▦ 開關（房間的色塊與外框【照畫】，只有名字跟著）═══╗
     Ali：「平面圖上面的房間 1234 如果能不顯示，最好啦。原因是文字太大。
           希望這個房間的顯示開關，和走道圖示綁在一起（我知道這 2 個的語義不一樣，
           但是他們都是屬於不常開的部分）。」 ⇒ ▦ 預設是關 ⇒ 房間名【預設就不顯示】。
     🔴 拖曳時暫時出現（活方向，見 ROOM_NAME_ON_DRAG）——她要的是【記憶線索】：
        拖完要去依房間分組的清單找那件家具 ⇒ 她需要記得「剛剛放進哪一間」。
     🔴 `&& moved`：pointerdown 時 S.dragging 就有值了，要移動超過 DRAG_PX 才算拖
        ⇒ 不加的話，這期間若有計時器觸發 render（房間重判、同步完成），房間名會閃一下。
     🔴 「未命名」的房間也跟著藏（A 類，標紅）：家具的「未命名」不受 🅰 控制是因為它是【待辦】，
        房間名沒有這個語意。
     🛑 判斷式只在這一處 —— 活方向的意思是「只有一個地方要改」。 ╚═════════════════════╝ */
  const showRoomName = L('grid') || (ROOM_NAME_ON_DRAG && !!S.dragging && moved);
  // 分區底（🔴 需求 41：用房間自己的 poly 畫，不再靠牆算）
  ROOMS.forEach(r=>{
    const ring=roomRing(r.id);
    const c=roomCenter(r.id);
    /* 需求 9／41 邊界：沒有 poly 也沒有牆 → 不畫分區（名字仍在清單分組），不是畫在 NaN */
    if(!ring && !c) return;
    const col=roomColor(r.id);
    if(ring){
      const pts=ring.map(p=>`${p.x},${p.y}`).join(' ');
      /* 三個通道沿用 §9-1d-1：填色＝房間色 12%；外框＝同一個房間色、實線、2 公分（世界座標）。
         ⚠️ 不可以用紅／橘（--warnB／--warnA）當分區色 —— 那兩個是「撞到／警示」的語意。 */
      const lit = (predRoom===r.id);     // 🔴 修六：預判落點的那一間【比較深】
      g.appendChild(el('polygon',{points:pts,
        fill:col,'fill-opacity': lit?0.34:0.12, stroke:col,
        'stroke-width': lit?4:2,'stroke-linejoin':'round'}));
    }
    /* 🔴 需求 41：房間名畫在【形心正中】（歪斜的房間往上偏 140 公分會跑到別間去）。
       🔴 F-12：不套螢幕夾限（10 間房會疊成一坨）⇒ clamp:false，畫面外就不畫。 */
    if(c && showRoomName){                // 🔴 v0.21_i 下-23
      const ps=w2s(c.x, c.y);
      uiText(ps.x, ps.y, r.name||'未命名',
        {size:15, anchor:'middle', fill:col, opacity:.95, clamp:false});
    }
  });
  // 牆（選中家具【真的貼著】的那道要高亮）
  /* 🔴 v0.22_i §12（Ali 2026-09-29）：litWall 改成「isFlushToWall(f) 為真才亮」——
     被推離牆／轉歪的家具仍掛在那道牆（place().wall 有值），但已經不是貼著 ⇒ 不亮。
     ⚠️ place().wall 的其他讀者（axis 2701／nudge／setRot）意思是「掛在哪道牆」，【不可改】。 */
  const litWall = (sel && isFlushToWall(sel)) ? place(sel).wall : null;
  WALLS.forEach(w=>{
    const on = litWall && litWall.id===w.id;
    /* 🔴 需求 42-a：粗細＝真實牆厚（公分）。牆畫在帶 scale(zoom) 的 g 裡 ⇒ 不要自己乘 zoom。
       🔴 高亮改走【顏色】通道，不再改粗細（粗細讓給厚度了）。
       🔴 linecap 從 square 改成 butt：square 會讓兩端各多出半個線寬
          ⇒ 39 公分的管道間兩端各爆出 19.5 公分，轉角會凸出來。
          ⚠️ 代價是牆角會看到小缺口 —— 那是 butt 的必然，不是畫錯（交付必講 ⑥）。 */
    g.appendChild(el('line',{x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2,
      stroke: on?'var(--accent)':'var(--wall)',
      'stroke-width': wallThick(w),'stroke-linecap':'butt',
      'stroke-dasharray': w.state==='proposed' ? '18 10' : 'none'}));
  });
  /* ── 🔴 需求 43：樑（畫在【牆之後】＝壓在牆上面，Ali 2026-09-13 裁決）──
     配套：只畫【兩邊的虛線】、中間不填 ⇒ 壓在牆上也看得到牆。
     🔴 編號必須穩定（v0.13_i 修十 F-21）：六根樑是同一次 SQL 插入，createdAt 幾乎必然相同
        ⇒ 先用 beamOrder() 排成陣列，再用那個陣列的 index，
          不可以直接用 BEAMS.forEach 的 index（BEAMS 的順序來自 IndexedDB，不保證）。 */
  beamOrder().forEach((b,i)=>{
    const filled = (b.drop != null);
    const focus  = (S.beamFocus === b.id);
    const col = focus ? 'var(--accent)' : (filled ? 'var(--warnA)' : 'var(--dim)');
    const dx=b.x2-b.x1, dy=b.y2-b.y1, L=Math.hypot(dx,dy)||1;
    const hw=(b.width||20)/2;
    const nx=-dy/L*hw, ny=dx/L*hw;
    /* 🔴 v0.15_i 修四（M-27，Ali：「樑的高亮好難看，把他從虛線改成填滿某個顏色吧」）：
       【只有被高亮的那一根】改成填滿。
       ⚠️ 範圍嚴格限定：「只畫兩邊虛線、中間不填」是 Ali 自己 2026-09-13 的裁決，
          理由是【壓在牆上也要看得到牆】⇒ 沒被高亮的五根，畫法一行不改。
          被高亮的那一根本來就是「我要你現在看它」，遮住底下的牆是可以接受的。
       🔴 四個角就是兩條側線的端點，順序要【繞一圈】1→2→2'→1'；
          寫成 1→2→1'→2' 會變成蝴蝶結（自交的沙漏形）。
       ⚠️ focus?6:3 的加粗一起被吃掉是對的：填滿之後不需要再加粗。 */
    if(focus){
      const pts=[[b.x1+nx,b.y1+ny],[b.x2+nx,b.y2+ny],
                 [b.x2-nx,b.y2-ny],[b.x1-nx,b.y1-ny]];
      g.appendChild(el('polygon',{points:pts.map(p=>p[0]+','+p[1]).join(' '),
        fill:col,'fill-opacity':.55,stroke:col,'stroke-width':2.5,'stroke-linejoin':'miter'}));
    }else{
      [1,-1].forEach(sgn=>{
        g.appendChild(el('line',{x1:b.x1+nx*sgn, y1:b.y1+ny*sgn,
          x2:b.x2+nx*sgn, y2:b.y2+ny*sgn,
          stroke:col, 'stroke-width':3, opacity:0.85,
          'stroke-dasharray':'24 14'}));
      });
    }
    /* 🔴 v0.13_i 修一（F-1）：文字要先用 w2s 轉成【畫面座標】，而且中點要自己宣告。
       ⚠️ 照 v0.12_i 的 pseudocode 抄（直接用未宣告的 cx/cy）＝ "use strict" 下
          ReferenceError ⇒ render() 在 boot() 的 try 之外 ⇒ 🔴 啟動就白畫面。
       顯示規則（Ali 2026-09-13）：沒填高度 → 常駐顯示「樑N（未填高度）」（obs O-13：
       未處理的狀態不可以長得像處理過的）；填完高度 → 不顯示，只有從設定頁按〔預覽〕
       進來的那一根才亮起來並顯示編號。 */
    if(!filled || focus){
      const mcx=(b.x1+b.x2)/2, mcy=(b.y1+b.y2)/2;
      const ps=w2s(mcx, mcy);
      uiText(ps.x, ps.y, '樑'+(i+1)+(filled?'':'（未填高度）'),
        {size:11, anchor:'middle', fill:col});
    }
  });
  // 吸附預示：目標牆 ＋ 虛線幽靈
  if(S.snapCand){
    const c=S.snapCand;
    /* 🔴 v0.13_i 修八 F-10：目標牆的高亮原本寫死 13 ⇒ 42-a 之後 39cm 那道會完全蓋住它，
       而這是本批唯一能讓 Ali 當場看出「貼對邊」的回饋。
       ⇒ 改成比牆粗一圈（wallThick+8），linecap 也要一起改 butt（v0.14_i 補七 N-8b）。 */
    /* ╔═ 🔴 v0.17_i 修七-b｜只亮【side 那一側的那一個面】，不再蓋住整道牆 ═════════╗
       Ali：「除非之後可以寫 只亮＋一側＋」
       做法：沿 wallBaseNormal × side 位移 wallThick/2（＝走到那一側的牆面），
             在那裡畫一條沿牆的亮線。
       ✅ 粗細定案 11（第一版 3.5 太細，Ali 2026-09-14 定「至少兩倍」）
       🔴 顏色與透明度【不變】（var(--ghost) ＋ opacity .85）——
          改的只有「蓋整道牆」→「只蓋一面」＋粗細。
       🔴 為什麼一定要改（不是美化）：觸發時家具已經壓在牆上 ⇒ 幽靈與手上那件只差 6cm
          ⇒ 手機 fit 時是 2 像素 ⇒ 靠比對兩個外框的回饋【失效】，
            而「哪一側」正好是唯一看不出來的那件事。 ╚═══════════════════════════╝ */
    const nb=wallBaseNormal(c.wall);
    const sd=(c.side===1||c.side===-1)? c.side : 1;
    const ox=nb.x*sd*wallThick(c.wall)/2, oy=nb.y*sd*wallThick(c.wall)/2;
    g.appendChild(el('line',{x1:c.wall.x1+ox,y1:c.wall.y1+oy,x2:c.wall.x2+ox,y2:c.wall.y2+oy,
      stroke:'var(--ghost)','stroke-width':11,opacity:.85,
      'stroke-linecap':'butt'}));
    const gp=corners(c.gx,c.gy,c.f.w,c.f.d,c.gang,0);
    g.appendChild(el('polygon',{points:gp.map(p=>`${p.x},${p.y}`).join(' '),
      fill:'none',stroke:'var(--ghost)','stroke-width':3,
      'stroke-dasharray':'10 7'}));
  }
  /* 🗂 v0.21_i 下-22：這裡原本呼叫 corridorHint(g)／lengthScale(g)，把示意帶與比例尺畫進世界座標。
     整組已搬進畫面座標的 HUD（drawHUD，在本函式最後、_uiLayer 裡）。
     ⇒ v0.20_i 那段「走道網格外緣會蓋到示意帶」的顧慮（N-509b）**隨之消失**：
        HUD 在 _uiLayer，永遠在世界座標的一切之上。 */

  /* ╔═ 🔴 v0.20_i §2-3a ③｜疊圖排序區塊 ══════════════════════════════════════════╗
     🔴 **必須傳 ctx** —— g 與 sel 是本函式的區域 const，抽出去的函式看不到它們
        （零參數 ⇒ ReferenceError ⇒ render 在 boot 的 try 之外 ⇒ 啟動白畫面）。
     🔴 `slice()` 之後才 sort —— 不要就地排序 DRAW_ORDER（那會每一幀改動常數陣列）。
     🔴 **不要在這一行做過濾**（例如 `if(shown(d.layer))`）——
        §1-1b 的「走道三檔」會被一刀切掉。各支自己判斷。 ╚═══════════════════════════╝ */
  const ctx = { g, sel };
  DRAW_ORDER.slice().sort((a,b)=>a.z-b.z).forEach(d=> d.fn(ctx));
  /* 🔴🔴 家具名稱在排序迴圈【結束之後】才畫，而且**不在 DRAW_ORDER 裡**。
     位置對疊圖沒有任何影響（它畫進 _uiLayer，永遠在 g 的一切之上），
     固定放這裡只是為了**可預測**、讓下一個人一眼看到它不在排序裡。
     🛑 不要試圖把它插進迴圈 —— 「家具與照片標記之間」這個位置在迴圈外不存在（v0.1.9 起照片標記改成 drawPins，也在迴圈外），
        「在它們之間」這個位置在迴圈外根本不存在。 */
  drawName(ctx);
  /* 🔴 v0.1.9 批 8：相簿釘子（R-22：房間名 → 家具名 → 釘子 → HUD） */
  drawPins();
  /* 🔴 v0.21_i 下-22：左下角的走道示意＋比例尺（畫面座標，永遠在最上層）。
     放在家具名之後 ⇒ 兩者重疊時 HUD 在上面，比例尺不會被名字蓋住。 */
  drawHUD();

  /* 需求 5：種子提示。依 _d §10-0b 這句是【功能說明】
     ⇒ 只留到使用者建了第一件東西為止，之後不再顯示。 */
  /* 🔴 左上角逐行堆疊（種子提示 → pull 錯誤 → 幾何格式錯誤），行高 18。 */
  let _ty = SVG_PAD+16;
  if(isSeedPristine()){
    /* 🔴 需求 20：提示句固定在平面圖【左上】（畫面座標），完全不隨 zoom／pan 跑。
       Ali 截圖裡被切成「單〕重來，或直接改它」的就是這一句。 */
    uiText(SVG_PAD+2, _ty, '這是範例。到 ⚙️ 按〔清清單〕重來，或直接改它',
      {size:12, fill:'var(--sub)', opacity:.9});
    _ty += 18;
  }
  /* 需求 15：pull 失敗必須看得到（不可被「本機全空」蓋成一個空專案）
     🔴 需求 20：這也是給人讀的文字 ⇒ 畫面座標，固定在左上第二行。 */
  if(S.dataErr){
    uiText(SVG_PAD+2, _ty, '⚠️ '+S.dataErr, {size:12, fill:'var(--warnB)', weight:600});
    _ty += 18;
  }
  /* 🔴 v0.13_i 修七 F-29 ＋ v0.14_i 補七 N-9：分區幾何格式錯誤畫在第三行。
     它放在【不會被同步清掉】的 S.geomErr 裡（S.dataErr 的清除點是 cloudSync 成功與 boot 成功）。 */
  if(S.geomErr){
    uiText(SVG_PAD+2, _ty, '⚠️ '+S.geomErr, {size:12, fill:'var(--warnB)', weight:600});
    _ty += 18;
  }
  /* 🔴 v0.1.9 R-15：雲端是新版格式 ⇒ 停推雲端。常駐一行（不隨同步成功消失）。 */
  if(CLOUD.frozen){
    uiText(SVG_PAD+2, _ty, '⚠️ '+FROZEN_MSG, {size:12, fill:'var(--warnB)', weight:600});
  }
}

/* ══════════════════════════════════════════════════════════════
   手勢（議題 A：兩案並陳，同一原型用開關切）
   ══════════════════════════════════════════════════════════════ */
const pts=new Map();
let startPt=null, moved=false, pinch0=null, hitId=null;

function furnAt(sx,sy){
  const p=s2w(sx,sy);
  const pad = GRAB_PAD_PX/S.zoom;               // 螢幕 14px 換算成公分
  for(let i=FURN.length-1;i>=0;i--){
    const f=FURN[i];
    if(!onPlan(f)) continue;
    const q=place(f);
    const m = (f.id===S.selId) ? pad : 0;       // 只有選中的才有緩衝
    const c=Math.cos(-q.ang), s=Math.sin(-q.ang);
    const dx=p.x-q.x, dy=p.y-q.y;
    const lx=dx*c-dy*s, ly=dx*s+dy*c;
    if(Math.abs(lx)<=f.w/2+m && Math.abs(ly)<=f.d/2+m) return f;
  }
  return null;
}
function canDragFurn(f){
  if(!f) return false;
  if(!hasSize(f)) return false;        // 🔴 需求 7：尺寸未填不可拖（點選仍可，供編輯）
  return S.selId===f.id;               // 🔴 需求 39：唯一路徑——要先選中才拖得動
}
svg.addEventListener('pointerdown',e=>{
  try{ svg.setPointerCapture(e.pointerId); }catch(err){}
  pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2){
    const [a,b]=[...pts.values()];
    pinch0={d:Math.hypot(a.x-b.x,a.y-b.y), z:S.zoom,
            mx:(a.x+b.x)/2, my:(a.y+b.y)/2, px:S.panX, py:S.panY};
    S.dragging=null; startPt=null; hitId=null; return;   // 進入縮放＝取消單指狀態
  }
  const r=svg.getBoundingClientRect();
  const sx=e.clientX-r.left, sy=e.clientY-r.top;
  startPt={id:e.pointerId,x:e.clientX,y:e.clientY,sx,sy,panX:S.panX,panY:S.panY};
  moved=false;
  const f=furnAt(sx,sy); hitId=f?f.id:null;
  /* 🔴 v0.1.9 R-20：按下點命中釘子 ⇒ 不啟動家具拖曳（釘子壓在已選中的家具上時，點擊要給釘子）；
     定位中一律不拖家具（進定位時已 select(null)，這裡是第二道）。 */
  const pinDown = !!S.loc || pinsAt(sx,sy).length>0;
  if(!pinDown && canDragFurn(f)){
    const q=place(f);
    S.dragging={f, gx:q.x, gy:q.y, ang:q.ang,
      ox:q.x-s2w(sx,sy).x, oy:q.y-s2w(sx,sy).y};
  }
});
svg.addEventListener('pointermove',e=>{
  if(!pts.has(e.pointerId)) return;
  pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch0 && pts.size===2){
    const [a,b]=[...pts.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    const z=Math.max(.25,Math.min(4, pinch0.z*(d/pinch0.d)));
    const r=svg.getBoundingClientRect();
    const mx=pinch0.mx-r.left, my=pinch0.my-r.top;
    S.panX = mx-(mx-pinch0.px)*(z/pinch0.z);
    S.panY = my-(my-pinch0.py)*(z/pinch0.z);
    S.zoom=z; render(); syncSel(); zLbl(); return;
  }
  if(!startPt) return;
  const dx=e.clientX-startPt.x, dy=e.clientY-startPt.y;
  if(!moved && (Math.abs(dx)>DRAG_PX||Math.abs(dy)>DRAG_PX)) moved=true;   // §2
  if(!moved) return;
  if(S.dragging){
    const r=svg.getBoundingClientRect();
    const p=s2w(e.clientX-r.left, e.clientY-r.top);
    S.dragging.gx=p.x+S.dragging.ox;
    S.dragging.gy=p.y+S.dragging.oy;
    previewMove(); render(); syncSel();
  }else{
    /* 🔴 需求 39：沒有在拖家具 ⇒ 一律平移。原 A1 的 nudgeHint 分支已整段移除——
       它那句提示會叫使用者去按一顆已經不存在的按鈕。平移是唯一路徑，不可以壞。 */
    S.panX=startPt.panX+dx; S.panY=startPt.panY+dy; render();
  }
});
function endPointer(e){
  pts.delete(e.pointerId);
  if(pts.size<2) pinch0=null;
  /* ⚠️ O-2：只處理「開始這一筆的那根手指」抬起。
     否則漏收一次 pointerup 會用上一次留下的 startPt/hitId 去做選取。 */
  const mine = startPt && startPt.id===e.pointerId;
  if(S.dragging && moved){ commitMove(); }
  else if(!moved && mine){
    const r2=svg.getBoundingClientRect();
    const wp=s2w(e.clientX-r2.left, e.clientY-r2.top);
    /* 🔴 v0.1.9 R-23：定位中「點＝移過去」接在這裡（舊的 S.pinPhoto 那一格）。
       Q-12 判定順序：兩指＝縮放 → 已選中家具＝拖曳（按下當下決定）→ 其他單指移動＝平移
                      → 沒移動就放開：定位中＞釘子（📷 亮著才算；收集全部）＞家具選取／點空白取消。 */
    if(S.loc && S.loc.phase==='locating'){ locMoveTo(wp.x, wp.y); }
    else {
      const hits = pinsAt(e.clientX-r2.left, e.clientY-r2.top);
      if(hits.length===1){ openPinCard(hits[0].albumId); }
      else if(hits.length>1){ openPinList(hits.map(h=>h.albumId)); }
      else{
        if(S.loc || S.pinSel) clearPinState();       // 定位完成後／預覽卡開著：點空白處＝取消選取（同家具）
        const f=hitId?FURN.find(x=>x.id===hitId):null;
        select(f?f.id:null);                         // 輕點＝選取 / 點空白＝取消
      }
    }
  }
  if(mine || !S.dragging){ startPt=null; hitId=null; }
  S.dragging=null; S.snapCand=null;
  render(); syncSel();
}
svg.addEventListener('pointerup',endPointer);
/* 🔴 v0.21_i（讀坑 🔴5）：舊註解寫「pointercancel＝來電/通知蓋掉：當作沒發生」——**那是錯的**。
   它走的是同一支 endPointer ⇒ 若已經拖動過（moved），**會 commitMove**（家具停在被打斷的位置）。
   ⇒ 只改註解、不改行為（O-25：註解不可以指向一個不存在的事實）。 */
svg.addEventListener('pointercancel',endPointer);   // 來電/通知蓋掉：與放手同一條路（會 commit）
/* ╔═ 🔴 v0.21_i 下-23（讀坑 🔴5）｜放手的【第三條路】═════════════════════════════════╗
   放手有三條路：pointerup、pointercancel（兩者都是 endPointer，結尾一定 render）、以及這一條。
   🔴 這一條原本清掉 S.dragging 卻**不重畫**、也沒清 S.snapCand
      ⇒ 被系統手勢搶走擷取時，拖曳中才出現的東西（房間名、幽靈、浮起來的外框）
        會一直掛在畫面上，直到下一次別的東西觸發重畫（N-614）。
   ✅ 只在【真的清掉了這一筆】時才重畫 —— 正常放手時 pointerup 已經先把 startPt 清掉，
      這裡不成立，不會多重畫一次。 ╚══════════════════════════════════════════════════╝ */
svg.addEventListener('lostpointercapture',e=>{      // 擷取被搶走＝那根手指已經不算數
  pts.delete(e.pointerId);
  if(pts.size<2) pinch0=null;
  if(startPt && startPt.id===e.pointerId){
    startPt=null; hitId=null; S.dragging=null; S.snapCand=null;
    render(); syncSel();
  }
});

/* ╔═ 🔴🔴 v0.20_i §5 下-20｜碰牆【一律】取牆角（Ali 2026-09-20 裁決【丁】）═════════╗
   Ali 原話：「我的意圖**一直都是**，雖然家具已經調整過角度，但是
              **碰牆之後，就直接用牆的角度覆蓋**。」
   她同時把「吸附」的語意定了下來（🔑 這句比規則本身重要）：
     「當之前已經把吸附意圖限制到【只有碰牆（完全碰到才算）】才會吸附的時候，
       此時的吸附我將它視為【和牆面貼齊】（家具本來就不能穿牆，除非有特例，
       或僅僅是擺放用），**特例和測試擺放我用微調**。」
   ⇒ 🔑 吸附是一個【物理事實】（家具不能穿牆），不是一個【操作手感】。

   ── 完整模型（三句，Ali 逐句確認過）────────────────────────────────────
     ① 碰牆　⇒ 貼齊牆面 ＋ 用牆的角度覆蓋（一律，沒有例外）　＝ 本函式
     ② 脫離（🧲 已貼牆 → 未貼牆）⇒ 角度留著，不可以轉回預設值　＝ 下-19（btnUnsnap）
     ③ 微調鍵 ⇒ 特例與測試擺放用；nudge() 完全不碰 rot（現況就是）
   ⚠️ 由 ①＋② 推出、且 Ali 已明確接受：**貼牆的家具被【拖動】⇒ 角度會再次被覆蓋。**
      貼牆後微調出來的角度，拖一下就沒了 —— 這是預期行為，不是 bug。

   ── 🗂 歷史：這裡曾經有一個 `flags.rotUser`，2026-09-20 被撤掉 ──────────────
   v0.1.7 §下-7 為了修「換牆之後角度回不去」而引入 `f.flags.rotUser`：
     她自己轉過 ⇒ 保留她的角度；沒表態過 ⇒ 對齊新牆。
   🔴 它被撤掉的理由（Ali 裁決【丁】，見 `_i` §10-4）：
     · 她的意圖從頭到尾就是「碰牆一律覆蓋」，rotUser 從來不是她要的
     · 而且 rotUser 是一個【一旦 true 就永遠 true】的鎖（全檔沒有任何清除點）
       ⇒ 她按過一次〔↻ 旋轉〕，那一件從此碰牆都不再取角
     · 她也否決了「用〔🧲〕清掉 rotUser」的替代案：「這樣會和畫面上的吸附打架」
       —— 🧲 的語意是「它現在貼著牆嗎」＝一個事實，不可以同時表達「角度有沒有被鎖住」
   ⚠️ 資料庫裡的舊 `flags:{"rotUser":true}` **不清除**（沒有人讀它了，清它反而是動使用者
      的資料）⇒ 下一個人看到那個殘留值時，答案在這一段。欄位 `items.flags` 本身保留
      （通用 jsonb，toRow／fromRow 一行不改）。
   🔴 **簽名不要改**（仍然吃 `f`）—— 全檔三個呼叫點（commitMove／snapBackToWall／
      previewMove）不動；改簽名會多三個要跟著改的地方，而收益是零。
      📌 `f` 目前**沒有被用到**，保留純粹是為了不動那三個呼叫點。不要把它刪掉。 ╚═════╝ */
function snapRot(absAng, wallAng, f){
  let rel=(absAng-wallAng)*180/Math.PI;
  rel=((rel%360)+360)%360;
  return (Math.round(rel/90)%4)*90;        // 🔴 下-20：一律對齊牆，不再看任何旗標
}
/* 拖曳中：找吸附候選並產生預示（不當場跳貼，維持跟手）*/
function previewMove(){
  S.snapCand=null;
  if(!L('snap')||!S.dragging) return;
  const {f,gx,gy}=S.dragging;
  if(!hasSize(f)) return;
  let best=null;
  /* ╔═ 🔴🔴 v0.19_i §下-4｜perpHalf 的角度用錯了（要改結構，不是加參數）═════════╗
     舊寫法　const ph=perpHalf(f);  ← 在 WALLS.forEach【外面】，只算一次
     f.rot 是相對於【它目前附著的那道牆】的角度，可是門檻要比的是
     「相對於【這一道候選牆】」的垂直半徑 ⇒ 候選牆是迴圈裡才選出來的
     ⇒ 「多收一個角度參數」沒有地方可以傳 ⇒ 必須把計算搬進迴圈。
     🔬 第 0 批實測（33 道真實牆、150×200 的家具）：
        水平牆 clearance −0.02（正確）／**垂直牆 +24.98（早吸 25 公分）**／
        斜牆 −24.98 ~ +17.14 ⇒ 誤差 ＝ ph_used − ph_true，與牆的角度直接相關。
        ⇒ 🔴 下-5「直牆吸附仍有小範圍」與本條【同一個根因】，本條修好就一起解決。
     🔴 1281 place() 那個呼叫點【一行不改】—— 它現在是對的（f 已經貼在那道牆）。 */
  const phFor = (wall)=>{
    const rel = S.dragging.ang - wallAngle(wall);        // 相對【這一道候選牆】的角度
    return Math.abs((f.w/2)*Math.sin(rel)) + Math.abs((f.d/2)*Math.cos(rel));
  };
  /* 🔴 需求 45-a：不再過濾房間。匯入的 33 道牆 room 全 NULL
     ⇒ 舊的 WALLS.filter(w=>w.room===f.room) 永遠沒有候選 ⇒ 根本吸不到。
     ⚠️ 配套是 SNAP_MAX_CM（需求 45-c），否則全屋 fit 時會吸到屋外那道。 */
  /* ╔═ 🔴 v0.17_i 修七-a ＋ 甲-1｜吸附觸發改成「碰到牆的【本體】才吸」═════════════╗
     Ali：「傢俱所占面積和牆面重疊的時候，才開啟吸附，設定成沒有觸碰牆，不存在吸附的意圖」
     　　　「縮小看全屋時，也是碰到才吸。」（2026-09-18 裁決）
     ⇒ 門檻 ＝ wallThick(w)/2，🔴 沒有螢幕像素下限（SNAP_MIN_PX 整條取消，不新增那個常數）。
     🔴 gap 的定義不變（gap = d - perpHalf(f)），這一行不要動。
     ⚠️ 已知代價（Ali 已被告知並接受，🔴 不是 bug）：
        全屋檢視下 wallThick/2 換算成螢幕距離只有 2 像素上下
        ⇒「縮小＝粗擺、容易吸」這個舊行為沒有了
        ⇒ 要避開吸附，用的是【吸附開關】，不是放大。 ╚═══════════════════════════╝ */
  WALLS.forEach(w=>{
    const {d,t}=distSeg(gx,gy,w);
    /* 🔴 §下-4 ①：每一道候選牆各算一次 ph（gap 的定義不變：gap = d − 垂直半徑）。 */
    const ph=phFor(w);
    const gap=d-ph;
    if(gap <= wallThick(w)/2 && (!best||gap<best.gap))
      best={w,t,gap,ph};
  });
  if(!best) return;
  const w=best.w, a=wallAngle(w);
  /* 🔴 v0.14_i 補二：這裡是【寫入端】（1336 那格是 previewMove，每幀都跑，不是放手當下）。
     算出 side 放進 S.snapCand；真正寫進 f.anchor 的是 commitMove（放手當下）。 */
  const side=sideFromPoint(w, gx, gy);
  const n=wallNormalFor(w, {side});
  /* 🔴 需求 42-b 的連帶（claude 裁決，A 類歧義：_i 沒寫幽靈要不要跟著往外移）：
     幽靈必須與 place() 算出來的最終位置一致，否則放手後家具會跳 thickness/2，
     而幽靈正是「看得出貼哪一邊」的唯一回饋。⇒ 同樣加 wallThick/2。
     ⚠️ gx/gy 只用來畫幽靈（commitMove 用的是 along/side），不進任何資料。 */
  /* ╔═ 🔴 v0.20_i §5 下-21｜幽靈的【落點】要用【對齊後】的角度算（Ali 裁決【乙】：順手修）╗
     現象（既有缺陷，建造前讀坑補驗 H 查出來的）：
       幽靈的【角度】本來就對（gang 用的是 nr），但它的【離牆距離】用的是
       `best.ph` ＝【拖曳當下、還沒對齊】的角度算出來的垂直半徑，
       而放手後 place() 用的是 perpHalf(f)，此時 f.rot 已被 snapRot 打成 0/90/180/270。
     🔬 複驗（150×200 的家具，落差隨角度變，最壞在 45° 附近）：
       rel 44.0° ⇒ nr 0°  ／ ph_drag 124.0 vs ph_snap 100.0 ⇒ 差 **24.0 cm**
       rel 45.0° ⇒ nr 90° ／ ph_drag 123.7 vs ph_snap  75.0 ⇒ 差 **48.7 cm** ← 最壞
     ⚠️ 這不是下-20 造成的，但下-20 之後「碰牆一律對齊」成為【唯一路徑】
        ⇒ 它每次都會出現（以前 rotUser 為 true 的家具不會對齊，幽靈反而是準的）
        ⇒ 而 N-526「拖到別的牆」正好會照到它 ⇒ 她會先看到一個不準的幽靈。

     🛑🛑 **迴圈裡那個 `ph`（phFor(w)）不可以動** —— 它是【觸發判斷】用的：
        `const gap = d - ph; if(gap <= wallThick(w)/2)`
        它問的是「我**現在這個角度**，有沒有碰到牆」⇒ 必須用拖曳當下的角度。
        📌 `best.ph` 只是把那個值【記錄下來】，本批之後**已經沒有人讀它**
           （落點改用下面的 phSnap）。留著它是為了不動 best 的形狀；不要以為它還在用。
        把觸發也改成用對齊後的角度 ⇒ 會變成「還沒碰到就先吸」，
        直接推翻 v0.1.6 修七-a「碰到牆本體才吸」那條已裁決的行為。
     🔑 **一個是「要不要吸」，一個是「吸上去之後在哪」——兩個問題，兩個角度。**
     🛑 along／side／gang 三個都不動（along 與 commitMove 共用、gang 本來就用 nr、
        side 由 sideFromPoint 算與角度無關）。 ╚═══════════════════════════════════════╝ */
  const along=Math.max(f.w/2, Math.min(wallLen(w)-f.w/2, best.t*wallLen(w)));
  const bx=w.x1+Math.cos(a)*along, by=w.y1+Math.sin(a)*along;
  const nr=snapRot(S.dragging.ang, a, f);            // ① 🔴 下-21：提前算（本來在最後）
  const relRad=nr*Math.PI/180;
  const phSnap=Math.abs((f.w/2)*Math.sin(relRad))
             + Math.abs((f.d/2)*Math.cos(relRad));   // ② 用【對齊後】的角度重算垂直半徑
  const dep=phSnap + wallThick(w)/2;                 // 🔴 改用 phSnap（不是 best.ph）
  S.snapCand={f, wall:w, along, side,
    gx:bx+n.x*dep, gy:by+n.y*dep, gang:a+nr*Math.PI/180};
}
/* ╔═ 🔴 v0.19_i §下-3｜「它現在在哪一間」的判定（放手與微調共用這一段）════════╗
   🔴 六-b：判不出來時【維持原本的 f.room 不變】，絕對不可以寫成 null
      （寫 null ⇒ onPlan 失敗 ⇒ 它從畫面上消失），而且要靠 S.roomGuessFailed
      這個旗標說一句話（不可以直接寫 S.selNote —— 下一幀就被蓋掉）。 */
function rejudgeRoom(f){
  const rid=roomOfAnchor(f, f.anchor);
  if(rid){
    f.room=rid;                       // 判得出來 ⇒ 跟著新房間走（外框與清單色條也會跟著換）
    S.roomGuessFailed=null;
  }else{
    S.roomGuessFailed=f.id;           // 判不出來 ⇒ 保留原值，並在 selNote 說出來
  }
}
/* ╔═ 🔴🔴 §下-3｜微調跨界要重判房間 ═══════════════════════════════════════════╗
   現況　roomOfAnchor 只有兩個呼叫點（previewMove 預判／commitMove 放手）
        ⇒ nudge() 沒有呼叫它 ⇒ **微調永遠不會重判房間**。
   🔴🔴 掛點【不可以掛 stopRepeat】：單擊的真實順序是
        pointerdown → pointerup(stopRepeat) → click → nudge()
        ⇒ 掛 stopRepeat 會比家具移動【早一步】⇒ 用移動前的位置重判
        ⇒ 要多按一次才換房間，而「多按一次就對了」看起來像修好了。
   ✅ 掛在 nudge() 尾端 ＋ debounce：連發時只在最後一次算（N-419：按住不放不會一直閃），
      單擊時也保證在移動【之後】。 */
let _rejudgeTimer=null;
function scheduleRoomRejudge(id){
  if(_rejudgeTimer) clearTimeout(_rejudgeTimer);
  _rejudgeTimer=setTimeout(()=>{
    _rejudgeTimer=null;
    const f=FURN.find(x=>x.id===id); if(!f) return;
    const before=f.room;
    rejudgeRoom(f);
    /* 🔴 重判之後要跟著做兩件，否則 N-418 做不出來：
       ① saveItem —— 房間改了但沒存 ⇒ **重開就打回原形**
       ② buildList —— 讓那張卡片跳到新的一組，否則畫面上看不出房間換了
       ⚠️ 兩件都只在【房間真的變了】那一次做（位置本身 nudge 已經存過了）
          ⇒ 一次微調不會產生兩次無謂的 saveItem。 */
    if(f.room!==before){
      saveItem(f).catch(e=>cloudErr(e));
      buildList();
    }
    render(); syncSel();
  }, 35);   // 20~50ms
}

function commitMove(){
  const {f,gx,gy,ang}=S.dragging;
  if(S.snapCand && S.snapCand.f.id===f.id){
    /* 🔴 吸附【不可以順手把家具轉正】（O-8）。以目前的絕對朝向為準反算 rot。 */
    f.rot = snapRot(ang, wallAngle(S.snapCand.wall), f);   // 🔴 v0.20_i 下-20：一律取牆角
    /* 🔴 v0.14_i 補二：commitMove 會【整個重建 anchor】
       ⇒ side 必須在這裡從 S.snapCand 寫進去，不可以指望 previewMove 寫的值還在。
       ⚠️ side 是【使用者的決定】（她把家具拖到哪一側就是表態），不是每次重算的衍生值
          —— 與 _memory_「名次與順序是資料不是衍生值」同一個形狀。 */
    f.anchor={type:'wall', wall:S.snapCand.wall.id, along:S.snapCand.along, off:0,
              side:S.snapCand.side};
  }else{
    f.anchor={type:'free', x:gx, y:gy};      // 錨點切換＝依附身分改變（_d §5-2）
    f.rot=((ang*180/Math.PI)%360+360)%360;   // 脫離牆面時同樣保持絕對朝向
  }
  /* ╔═ 🔴 v0.17_i 修六｜放手之後，自動判定它現在在哪一間 ═══════════════════════╗
     Ali：「我指定客廳，床出現在客廳，接著把它放到另一個空間，在清單中他仍然是在客廳。」
     🔴 六-b：判不出來時【維持原本的 f.room 不變】，絕對不可以寫成 null
        （寫 null ⇒ onPlan 失敗 ⇒ 它從畫面上消失），而且要說一句話
        （靠 S.roomGuessFailed 這個旗標，不可以直接寫 S.selNote —— 下一幀就被蓋掉，§0-5 A-6）。
     ⚠️ 三個判不出來的死角：沒有 poly 的房間（種子／舊資料）／貼在外牆外側／
        poly 的邊與牆體之間的浮點縫。 ╚═══════════════════════════════════════════╝ */
  rejudgeRoom(f);                     // 🔴 §下-3：抽成函式，微調那條路呼叫【同一段】
  /* 🔴 需求 4：7 處「直接 in-place 改值」一律改成「改記憶體 → 呼叫 saveItem()」 */
  saveItem(f).catch(e=>cloudErr(e));
  /* 清單的分組是依 f.room 分的 ⇒ 換房間之後清單要跟著重建（修十）。 */
  buildList();
}

/* ══════════════════════════════════════════════════════════════
   需求 12｜選中面板（重排）
   ══════════════════════════════════════════════════════════════ */
function select(id){
  /* ╔═ 🔴🔴 v0.20_i §3-1g ②｜select() 是 commitAngEdit 的**第七條入口** ═══════════════╗
     🔴 **順序不可換：先 commit，後清旗標。**
        commitFieldEdits 的守衛是 `if(!S.sizeOpen) return;`、
        commitAngEdit 的守衛是 `if(!S.angOpen) return;`
        ⇒ 先把旗標設成 false 再呼叫 ＝ 那一次 commit **必定被自己的守衛擋成 no-op**，
          而且**不會報錯**。
     🔴 **為什麼 select() 也要 commit**：點平面圖上另一件家具走的是 `endPointer → select()`，
        而**在 svg 上點擊不保證輸入框的 blur 先於 select**（手機上尤其）。
        現況的 commitFieldEdits 一直靠「原生 blur 先觸發」頂著 —— 那是瀏覽器行為，
        不是規格寫出來的保護。
        ⚠️ 這條入口只在**手機**上壞：桌機的原生 blur 會先觸發，一切看起來正常
           ⇒ 我在桌機驗 N-524/N-528 會全綠，而她在手機上會掉資料。
     🔴 不清 angOpen 的症狀：選中 A 且旋轉模式開著 → 點選 B
        ⇒ angOpen 沿用 true ⇒ **B 的面板直接展開成旋轉模式**，而她只是想看 B（N-555）。
     📌 obs O-20／O-25 的形狀：函式名字沒變，但「它現在該做的事」變多了。 ╚═══════════╝ */
  commitFieldEdits();
  commitAngEdit();
  if(id) clearPinState();            // 🔴 v0.1.9 R-20：家具與釘子互斥（選了家具 ⇒ 收掉預覽卡／定位面板）
  S.selId=id;
  S.sizeOpen=false; S.angOpen=false; S.warnOpen=false;
  S.selNote='';                      // 🔴 需求 30：訊息跟著選中狀態走
  S.selMsg='';                       // 🔴 v0.17_i：一次性動作訊息也跟著選中狀態走
  S.roomGuessFailed=null;            // 🔴 v0.17_i 六-b：換選別件 ⇒ 上一件的「判不出來」要清掉
  $('sel').classList.remove('szopen');
}

/* 需求 12：撞到多件 → 截斷成「🔴 撞到：沙發 +2」；點警示展開全部 */
function warnSummary(n){
  if(n.hit.length){
    const names=n.hit.map(x=>x.name||'未命名');
    if(S.warnOpen || names.length===1) return {cls:'c', txt:`🔴 撞到：${names.join('、')}`};
    return {cls:'c', txt:`🔴 撞到：${names[0]} +${names.length-1}`};
  }
  if(n.near.length){
    const names=n.near.map(x=>x.name||'未命名');
    if(S.warnOpen || names.length===1)
      return {cls:'w', txt:`🟠 走道不足：與 ${names.join('、')} 之間不到 ${CLEAR_CM} 公分`};
    return {cls:'w', txt:`🟠 走道不足：與 ${names[0]} +${names.length-1} 不到 ${CLEAR_CM} 公分`};
  }
  return {cls:'n', txt:'🟢 沒有碰撞，走道也夠'};
}

function syncSel(){
  syncPinUI();                       // 🔴 v0.1.9 R-20：定位面板／預覽卡／提示條（另一個元素，每幀跟著套用）
  const f=FURN.find(x=>x.id===S.selId);
  const box=$('sel');
  /* 🔴 v0.21_i §1-3 ⑤：面板顯不顯示的判準抽成 selPanelShown()，drawHUD 讀【同一支】
     ⇒ 兩邊不可能不同步（不要在這裡另寫一份條件）。 */
  if(!selPanelShown()){ box.hidden=true; return; }
  box.hidden=false;
  const p=place(f);
  $('selName').textContent = `${roomName(f.room)} · ${f.name||'未命名'}`;
  /* 🔴 v0.17_i 修五：selPos 已拿掉 —— 「貼牆／未貼牆」這個狀態長在 btnUnsnap 上（見下方）。 */

  // 微調鍵整組跟著軸轉（_d §10-2b：箭頭跟「它依附誰」走）。🔴 這段行為一行不改。
  let axis;
  if(p.wall) axis = wallAngle(p.wall);
  else if(f.rot) axis = f.rot*Math.PI/180;
  else axis = 0;
  $('pad').style.transform = `rotate(${axis*180/Math.PI}deg)`;
  $('padc').textContent = nudgeCm()+' cm';     // ← 那是【狀態】，_d §10-0b 明訂要留

  /* ╔═ 🔴🔴 v0.20_i §3-1g ①｜兩個模式的顯示狀態，**每一幀在這裡重新套用** ═══════════╗
     🔴 為什麼這一段非改不可：syncSel() **每個 pointermove、每次 render 之後都會跑**，
        而舊版這裡寫的是 `box.classList.toggle('szopen', sizeOpen)` —— **只看 sizeOpen**
        ⇒ openMode() 剛 toggle 上去的 .szopen，**下一幀立刻被關掉**
        ⇒ 旋轉模式下 .padwrap 與 .g2 又冒出來、面板高度跳動 ⇒ 直接打死 N-518。
        📌 這是 obs O-20 的形狀：改了一個東西，沒問「現在有誰靠它活著」。
     🔴 .szopen 這個 class **兩個模式共用**（它負責 display:none 掉 padwrap 與 .g2，
        見 CSS `.sel.szopen .padwrap,.sel.szopen .g2`）⇒ 不要為旋轉另外發明一個 class。
     🛑 舊的 `$('btnSize').textContent = sizeOn ? '▴ 收' : '📏 改尺寸'` **整行刪掉** ——
        它不再換字（§3-1b：兩顆在模式裡是「另一個模式的入口」，不是「收起來」）。 ╚═══════╝ */
  const sizeOn=S.sizeOpen;
  const anyOpen = S.sizeOpen || S.angOpen;
  box.classList.toggle('szopen', anyOpen);
  $('selFields').hidden = !S.sizeOpen;
  $('angFields').hidden = !S.angOpen;
  $('angHint').hidden   = !S.angOpen;
  $('btnUp').hidden     = !anyOpen;          // 第一排的〔回主畫面〕（v0.21_i 下-25）
  /* 🔴 v0.21_i 下-24 真值表：進入【任何一個】模式，兩個模式入口都換成保留格（不能互跳）。
     ⇒ 四行都只看 anyOpen。v0.20_i 的舊寫法是各看各的旗標（留一顆當互跳入口）——已作廢。
     📌 openMode() 本身不改：它仍是唯一的切換函式，只是從此只剩「平常」狀態呼叫得到它。 */
  $('btnRot').hidden    = anyOpen;
  $('holdRot').hidden   = !anyOpen;
  $('btnSize').hidden   = anyOpen;
  $('holdSize').hidden  = !anyOpen;
  /* ╔═ 🔴 v0.15_i 修一-c｜欄位【無條件】跟著選中的那一件走 ═══════════════════╗
     Ali 的原話就是正解：「如果這個版面要用來改尺寸，那本來的尺寸就要被讀進去」。
     原本這一段包在 if(sizeOn){…} 裡面
       ⇒ 面板沒開時三個 input 停在【上一件家具】的數字
       ⇒ 換選一件再按〔完成〕就被繼承（跨物件汙染）。
     填一個看不見的欄位成本是零；讓它停在別人的值，代價是資料被汙染。⇒ 拿掉 if。
     🔴 與修一-a 是【兩層正交】的防線，不可以只做一層：
        只有 a（守衛）⇒ DOM 仍是一具殘留的軀殼，將來任何人再寫一條「讀那三個欄位」
                       的碼就會再中一次；
        只有 c（無條件填）⇒ 讀到的永遠是自己的值，但守衛一旦被繞過（例如有人加了
                       第三個 commit 入口）就又破了。
     ⚠️ activeElement 那道守衛【不可以拿掉】：正在打字時不能被覆寫回去（N-234d）。╚═╝ */
  /* 🔴🔴 v0.17_i 十二-b ②｜這裡【必須】走 SZ 這個對照表，不可以再寫一份欄位清單。
     建造者自驗抓到的真缺陷（2026-09-18，第三批）：
       本函式原本內嵌 [['fw','w'],['fd','d'],['fh','h']]，與上方的 SZ 是【兩份清單】
       ⇒ SZ 加了離地、這裡沒加 ⇒ #fz 永遠停在上一次的值
       ⇒ 症狀：清單展開列把離地改成 12.5、記憶體與 IndexedDB 都是 12.5，
         而面板那格【還顯示 50】；下一次按〔完成〕就把 50 寫回去（跨物件汙染復活）。
       ⚠️ 只看畫面看不出來，是【記憶體 ＋ IndexedDB 一起讀】才抓到的（O-24）。
     🔴 修一-c 的「無條件填」與修一-a 的守衛是兩層正交防線，這一層漏了就等下一個人踩。 */
  SZ.forEach(([id,k])=>{
    if(document.activeElement!==$(id)){
      $(id).value = f[k]==null ? '' : Math.round(f[k]*10)/10;
      $(id).classList.remove('bad');
    }
  });
  /* ╔═ 🔴 v0.20_i §3-1g ④｜角度欄也要【無條件填】，形狀與 SZ 那一段一模一樣 ═════════╗
     🔴 Ali 指名了三個「欄位要跟著現實變」的時機：
        ① 按 [−1][＋1][↻90]　② **在平面圖上把家具拖去碰牆（吸附成立）**　③ 按〔🧲 已貼牆／未貼牆〕
        ⇒ 不要各寫一次：syncSel() 本來就每一幀都跑，寫在這裡就**自動涵蓋三者**。
        （她的原話：「如果是在畫面上碰牆取角度，則，這一絕對角度會跟著改變」）
     🔴🔴 **activeElement 那道守衛不可以省** —— 她正在打 `90+30` 的時候被重填成 `120`
        就等於把她的輸入吃掉（N-530）。
     ⚠️ 漏了這一段的症狀：下-19 修好之後角度確實留著了，但**面板上那個數字還停在舊值**
        ⇒ 又變成 O-24（記憶體與畫面兩層不一致）。這正是 N-562。 ╚═══════════════════╝ */
  if(document.activeElement !== $('fang')){
    $('fang').value = absDegOf(f);
    $('fang').classList.remove('bad');
  }

  /* ╔═ 🔴 v0.17_i 修五｜貼牆狀態與〔脫離牆面〕合成【一顆雙態鈕】(_d §13-46 甲案) ══╗
     已貼牆（亮底）⇄ 未貼牆（一般底）——🔴 兩態必須看得出視覺差，不能只換字。
     🔴 丙-6 ⑦：守衛從 `!p.wall || noSize` 改成【只看 noSize】——
        「未貼牆」必須是可按的狀態，否則雙態鈕的另一半永遠按不到（＝這一半等於沒做）。
     🔴 丙-6 ⑥：L('snap')（吸附圖層）熄著時這顆鈕 disabled，與那個開關的語意一致。 ╚═══╝ */
  /* ╔═ 🔴 v0.22_i §12 下-28｜亮暗看「現在真的貼著嗎」，不看「資料上掛在哪道牆」═══════╗
     flush　＝ isFlushToWall(f)（單一來源，按鈕亮暗與點擊都只讀它）
     onWall ＝ !!p.wall（＝掛在牆上，可能已被推離或轉歪）—— 只用來決定 disabled 與點擊分支
     🔴 R-43：「掛著但沒貼著」⇒〔貼回去〕不找新牆 ⇒ 不需要吸附開關（disabled 只在 free 時看 🧲）。 ╚═╝ */
  const noSize=!hasSize(f);
  const onWall=!!p.wall;
  const flush=isFlushToWall(f);
  const bu=$('btnUnsnap');
  bu.textContent = flush ? '🧲 已貼牆' : '🧲 未貼牆';
  bu.classList.toggle('magon', flush);
  bu.title = flush ? '脫離牆面'
           : onWall ? '貼回牆面'
           : (L('snap') ? '貼到最近的牆' : '吸附關著時不能貼回去');
  bu.disabled = noSize || (!onWall && !L('snap'));
  /* 🔴 修十二：第三格【依狀態換內容】——尺寸面板開著時換成〔🔍 檢視〕。
     ⚠️ 既有 CSS 是 `.sel.szopen .padwrap,.sel.szopen .g2{display:none}`
        ⇒ .g3 這三格本來就不會被藏 ⇒ 這個做法一行 CSS 都不用改，
          也不必動用 .g2 的兩個保留位（自訂角度／汲取牆角的位置原封不動留著）。 */
  $('btnView').hidden   = !sizeOn;
  bu.hidden             = sizeOn;
  $('btnView').disabled = false;
  $('btnRot').disabled    = noSize;
  [...$('pad').querySelectorAll('button')].forEach(b=>{ b.disabled=noSize; });

  // 未旋轉原貌對照（留什麼：一行都不改）
  const ob=$('origBox');
  if(hasSize(f) && isSkew(f)){
    ob.classList.add('show');
    const s=$('origSvg'); while(s.firstChild) s.removeChild(s.firstChild);
    const k=Math.min(20/f.w, 20/f.d);
    s.appendChild(el('rect',{x:-f.w*k/2,y:-f.d*k/2,width:f.w*k,height:f.d*k,
      fill:'none',stroke:'var(--sub)','stroke-width':1.4,'stroke-dasharray':'3 2'}));
    const deg=p.ang*180/Math.PI;
    const r2=el('rect',{x:-f.w*k/2,y:-f.d*k/2,width:f.w*k,height:f.d*k,
      fill:'var(--furnSel)','fill-opacity':.5,stroke:'var(--furnSel)','stroke-width':1.6,
      transform:`rotate(${deg})`});
    s.appendChild(r2);
    const approx = (f.shape && f.shape!=='rect');
    $('origTxt').innerHTML =
      `虛線＝未旋轉的原貌，實色＝現況（${Math.round(deg)}°）。`+
      (approx ? `<br>⚠️ 這件不是矩形，碰撞用矩形範圍近似，誤差集中在四個角。`
              : `<br>矩形家具的碰撞判定精確，不受角度影響。`);
  } else ob.classList.remove('show');

  // 警示列（只提示不擋 — _d 方向 #9）。與「完成」同排，高度固定一列。
  /* 🔴 v0.09_i 需求 30 ②③：為什麼平面圖上看不到它。
     ③（沒指定房間）優先於 ②（沒擺）——沒有房間是更前面的問題。 */
  const nb=$('selNote');
  let note='';
  /* 🔴 v0.09_i 需求 33：孤兒 room 走同一條訊息——
     使用者看到的效果一樣：它沒有房間可去。 */
  /* ╔═ 🔴 v0.17_i 乙-5 ＋ §0-5 A-6｜這是一個【互斥的 if 鏈】，不是「多說一句話」════╗
     syncSel 每一個 pointermove 都會跑，而這一段【無條件重算】 note
     ⇒ 直接寫 S.selNote 的話，下一幀就被清掉（畫面完全安靜，與成功長得一樣）。
     ⇒ 要多講一件事，唯一正確的做法是【在這條鏈上加一個分支】，
        而那個分支的條件要是一個【存得住的狀態旗標】。
     🔴 一次只會出現一則 ⇒ 畫面上不會多出任何一行。 ╚═══════════════════════════╝ */
  if(S.selMsg)           note=S.selMsg;          // 修五：剛剛按了〔貼到牆〕但附近沒有牆
  else if(!roomAlive(f.room)) note='這一件還沒指定房間。';
  else if(!f.isPlaced)   note='這一件還沒擺進平面圖。';
  /* 🔴 v0.17_i 六-b ＋ 乙-5：第三則（互斥）——「判不出來」不可以是一片安靜，
     否則她無從分辨「判不出來」與「這個功能根本沒做」。 */
  else if(S.roomGuessFailed===f.id)
    note=`這一件的位置判不出屬於哪一間，房間維持原本的「${roomName(f.room)}」。`;
  S.selNote=note;
  nb.textContent=note; nb.hidden=!note;

  const n=collisions(f), w=warnSummary(n), wl=$('warnLine');
  wl.className='w '+w.cls+(S.warnOpen?' open':'');
  wl.textContent=w.txt;
}

/* 微調：沿「軸」移動；步進隨縮放、下限 1 公分 */
let _rep=null, _repId=null;
function stopRepeat(){ if(_rep){ clearInterval(_rep); clearTimeout(_rep); } _rep=null; _repId=null; }
/* ╔═ 🔴🔴 v0.20_i §3-1e｜長按連發抽成 bindRepeat(el, fn) ═════════════════════════╗
   為什麼要抽：舊的 handler **綁死在 #pad**（取 b.dataset.d、呼叫 nudge()），
   而角度的 [−1][＋1] 不在 .pad 裡 ⇒ 不可能沿用。
   🛑 **也不要複製第二份** —— 那正是 obs O-34 的溫床（兩個連發實作，之後只有一個會被改）。

   🔴🔴 **語意寫死：pointerdown 只【起計時器、不動作】，單次動作靠 click。**
      ⚠️ 這是 .pad 現況的形狀，照直覺寫（pointerdown 就呼叫一次 fn）會**按一次跳兩步**：
         放開時瀏覽器**仍然會發 click** ⇒ 跑兩次
         ⇒ 微調從 1cm 變 2cm、角度從 +1 變 +2
         ⇒ 而 .pad 是**已驗收的既有功能** ⇒ 這是靜默回歸。
   🔴 `e.stopPropagation()` **不可以漏**（互動筆記 §2「單擊 vs 拖曳 ＋ stopPropagation」）：
      不補回去會被 svg 的 pointerdown 吃掉。
   ⚠️ _rep／_repId 維持**單一組模組變數**（同時只可能按住一顆）；window.blur→stopRepeat 沿用。 ╚═╝ */
function bindRepeat(el, fn){
  if(!el) return;
  el.addEventListener('pointerdown',e=>{
    if(el.disabled) return;
    e.stopPropagation();
    _repId=e.pointerId;
    _rep=setTimeout(()=>{ _rep=setInterval(fn, 90); },450);   // 按住 450ms 後開始連發
  });
  ['pointerup','pointercancel','pointerleave','lostpointercapture']
    .forEach(ev=> el.addEventListener(ev,e=>{ if(_repId===e.pointerId) stopRepeat(); }));
  el.addEventListener('click',e=>{
    if(el.disabled) return;
    e.stopPropagation();                     // §2：擋住父層
    fn();
  });
}
window.addEventListener('blur',stopRepeat);   // 切走分頁也要停
/* 🔴 .pad 改成**四次逐元素綁定**（b.dataset.d 在繫結當下 closure 起來），
   不再用容器委派 —— 因為 bindRepeat 的簽名吃的是元素。**行為必須一行不變**。 */
[...$('pad').querySelectorAll('button')].forEach(b=>{
  bindRepeat(b, ()=>nudge(b.dataset.d));
});
function nudge(dir){
  const f=FURN.find(x=>x.id===S.selId); if(!f||!hasSize(f)) return;
  const step=nudgeCm(), p=place(f);
  const axis = p.wall ? wallAngle(p.wall) : (f.rot? f.rot*Math.PI/180 : 0);
  const ux=Math.cos(axis), uy=Math.sin(axis);
  /* ⚠️ O-6：螢幕的 y 是【往下增加】。整組按鈕用 CSS rotate(axis) 轉，
     「▲ 這顆鈕視覺上指的方向」＝ 把 (0,-1) 旋轉 axis 度 ＝ (uy, -ux)。 */
  const nx=uy, ny=-ux;
  let dx=0,dy=0;
  if(dir==='r'){dx=ux*step;  dy=uy*step;}
  if(dir==='l'){dx=-ux*step; dy=-uy*step;}
  if(dir==='u'){dx=nx*step;  dy=ny*step;}
  if(dir==='d'){dx=-nx*step; dy=-ny*step;}
  if(f.anchor.type==='wall'){
    const w=wallById(f.anchor.wall);
    if(w){
      /* 🔴 v0.13_i 修四 4-c：這是 side 的【第三個讀取點】（v0.12_i 完全沒提到）。
         漏掉的話 place() 用 side、nudge() 用舊的「取任一側」
         ⇒ 有一半的牆，按微調鍵家具會往反方向跑 —— 而那是已驗收過的既有功能。 */
      const n2=wallNormalFor(w, f.anchor);
      f.anchor.along += dx*ux + dy*uy;
      f.anchor.off    = (f.anchor.off||0) + (dx*n2.x + dy*n2.y);
    }
  }else{ f.anchor.x=(f.anchor.x||0)+dx; f.anchor.y=(f.anchor.y||0)+dy; }
  saveItem(f).catch(e=>cloudErr(e));          // 需求 4：改記憶體 → 呼叫 saveItem()
  scheduleRoomRejudge(f.id);                  // 🔴 §下-3：移動【之後】才重判，且連發只算最後一次
  render(); syncSel();
}

/* ══════════════════════════════════════════════════════════════
   需求 7｜存檔顆粒度：即時算、失焦才存
     即時（input）：只重算【記憶體 ＋ 畫面】——碰撞、走道、警告顏色
     存檔          ：① blur ② Enter ③ 🔴 visibilitychange → hidden
   需求 7（v0.04_i §7）｜無效輸入：
     打字中不阻止、不還原、不寫入，但該欄位加紅框
     三個存檔觸發點：值無效 → 還原成【上一個有效值】並移除紅框
   ══════════════════════════════════════════════════════════════ */
/* 🔴 v0.17_i 十二-b ①：SZ 這個對照表多一筆【離地】。
   ⚠️ commitFieldEdits 與 syncSel 都跑這個表 ⇒ 兩邊會一起多一欄（那正是要的）。
   🔴 判準與 w/d/h 不同：離地可以是 0 ⇒ 一律經過 badLen()（與清單展開列同一支）。
   ✅ 資料層不必新增任何東西（建造者已實查）：
      LEN_FIELDS.items 已含 zBase／toRow 已送 z_base／fromRow 已讀 z_base／addItem 已有初值。 */
const SZ=[['fw','w'],['fd','d'],['fh','h'],['fz','zBase']];
SZ.forEach(([id,key])=>{
  $(id).addEventListener('input',()=>{
    const f=FURN.find(x=>x.id===S.selId); if(!f) return;
    const raw=$(id).value.trim();
    if(raw===''){                        // 尺寸從有值改成空白 → 視為 null（未填），不是 0
      f[key]=null; $(id).classList.remove('bad'); render(); syncSel(); return;
    }
    const v=parseFloat(raw);
    if(badLen(key, raw, v)){             // 無效：不寫入，保留上一個有效值，但標紅框
      $(id).classList.add('bad'); return;
    }
    $(id).classList.remove('bad');
    f[key]=v;                            // 即時重算（記憶體＋畫面），不存
    render(); syncSel();
  });
  $(id).addEventListener('blur',()=>commitFieldEdits());
  $(id).addEventListener('keydown',e=>{ if(e.key==='Enter'){ $(id).blur(); } });
});
function commitFieldEdits(){
  /* ╔═ 🔴🔴 v0.15_i 修一-a｜資料損毀級 ═════════════════════════════════════╗
     面板沒開時，fw/fd/fh 的內容【不代表這一件的資料】——
     syncSel() 原本只在 sizeOpen 時才填它們（見修一-c，那一層也修了），
     而 select() 每次選取都會把 sizeOpen 關掉、卻【不動 input 的 value】。
     ⇒ 兩種症狀：
        ① 空字串 → v=null → f.w/d/h 被清成 null 並上傳（Ali：「按完成尺寸被吃掉」）
        ② 上一件的數字還留在 DOM → 換選一件再按〔完成〕⇒【繼承別人的尺寸】
           🔴 ② 比 ① 危險：清空看得出來，繼承看不出來。
     🔴 守衛必須在【最前面】：btnDone、blur、Enter、visibilitychange 四條入口都走這裡，
        其中 visibilitychange（手機鎖屏／切 App）是會【靜默】發生的那一條。
     ⚠️ 回歸：正常改尺寸時面板必然是開的（只有 btnSize 會把 sizeOpen 打開）⇒ 存得到；
        「改到一半鎖屏」時 sizeOpen 是 true ⇒ 守衛不擋，那條救援仍然有效。 ╚══════╝ */
  if(!S.sizeOpen) return;

  const f=FURN.find(x=>x.id===S.selId); if(!f) return;
  let dirty=false;
  SZ.forEach(([id,key])=>{
    const inp=$(id);
    const raw=inp.value.trim();
    const v=raw===''? null : parseFloat(raw);
    if(badLen(key, raw, v)){             // 🔴 十二-b：離地的判準是 >=0，見 badLen
      // 🔴 無效 → 還原成上一個有效值（記憶體裡那個），移除紅框
      inp.value = f[key]==null ? '' : Math.round(f[key]*10)/10;
      inp.classList.remove('bad');
      return;
    }
    inp.classList.remove('bad');
    /* ╔═ 🛑 v0.15_i 修一-b【本輪停做，整條不動】── B 類歧義，已回報 ════════════╗
       規格要求把這裡改成 `if(f[key]!==v){ f[key]=v; dirty=true; }`（真的變了才算）。
       🔴 照做會造成【靜默掉資料】，實測證據（IndexedDB 讀回來的值）：
          改成 88 →〔完成〕⇒ 記憶體 88、**IndexedDB 還是 150** ⇒ 下一次 reloadObjects()
          會把記憶體抹回 150，而畫面在被抹掉之前一直顯示 88。
       原因：上面那個 input handler 為了「即時重算＋同屏看後果」已經把值
             【先寫進記憶體】了（f[key]=v，見 SZ.forEach）
             ⇒ commit 時 f[key] 早就等於 v ⇒ 永遠判成「沒變」⇒ 永遠不存。
       ⚠️ 這【正是】v0.1.4.2 建造者在清單卡片那條路實測抓到、並已裁決過的同一個缺陷：
          「⇒ 改成【有效就一律存】。多一次寫入的成本遠低於靜默掉資料。」
          （那段裁決的全文還在本檔 commitCardEdits() 的 w/d/h 分支裡。）
       ⇒ 依互動協定：這個選擇會改變【使用者的資料】⇒ B 類 ⇒ 這一條整條不動，其餘照做。
       📌 若要同時滿足 修一-b 的本意（沒改就不要打雲端），可行的做法是比照清單卡片：
          用一個 dirty 旗標（input handler 寫入時登記），而不是比對已經被改過的記憶體值。
          🔴 那是新機制，需要 Ali 決定，本批不自行實作。 ╚══════════════════════════╝ */
    if(f[key]!==v){ f[key]=v; }
    dirty=true;
  });
  if(dirty){ saveItem(f).catch(e=>cloudErr(e)); render(); syncSel(); }
}
/* ══════════════════════════════════════════════════════════════
   🔴 v0.20_i §3-1d~f｜角度族：正規化／顯示／寫入／解析
   ══════════════════════════════════════════════════════════════ */
/* 🔴 兩支具名函式，setRot() 與 syncSel() **共用**（不可以各寫一份）。
   🔴 absDegOf 一定要正規化：place(f).ang 來自 Math.atan2 ⇒ 值域是 (−π, π]
      ⇒ 直接換算成度，一件轉到 233° 的家具，欄位會顯示 **−127.0**
      ⇒ 與「一律正規化到 [0,360)」直接矛盾，而 N-521 會在超過 180° 時失敗。 */
const normDeg  = d => ((d % 360) + 360) % 360;
const absDegOf = f => Math.round(normDeg(place(f).ang * 180 / Math.PI) * 10) / 10;
const ANG_STEP = 1;      // 🔴 Ali 裁決：微調一次一度。寫成具名常數，之後要改 0.5 只改這一行。

/* ╔═ 🔴 v0.22_i §12／v0.21_i §6c-3 下-28｜「現在真的貼著牆嗎」的【單一來源】═══════════════╗
   讀者（只有這三個，意思都是「貼著」）：litWall（render）／〔🧲〕亮暗（syncSel）／〔🧲〕點擊（btnUnsnap）。
   🛑 place(f).wall 的另外三個讀者（syncSel axis／nudge／setRot）意思是「掛在哪道牆」，不讀這支。
   📌 obs O-40：不新增狀態、不偵測「復原」這個動作 —— 每次只看【現在的幾何】。
   容差（R-42）：
     off  < 0.25 cm　off 由 nudge 以 ±步長 累加（sin²+cos²，數學上精確），存檔取到 0.1 cm
     角度 < 0.1°　　absDegOf 四捨五入到 0.1°、setRot 再減牆角 ⇒ 斜牆（小數第二位是 5）
                    ＋1 再 −1 回來的殘差是 0.05°；< 0.05 會時過時不過（O-38 的形狀），0.1 才穩。 ╚═══╝ */
const FLUSH_OFF_CM = 0.25;
const FLUSH_DEG    = 0.1;
function isFlushToWall(f){
  if(!f) return false;
  const p = place(f);
  if(!p.wall) return false;
  const off = (f.anchor && f.anchor.off) || 0;
  const rel = normDeg(f.rot || 0) % 90;
  return Math.abs(off) < FLUSH_OFF_CM && Math.min(rel, 90 - rel) < FLUSH_DEG;
}

/* ╔═ 🔴🔴 §3-1f｜四個入口共用的唯一寫入點 ═══════════════════════════════════════╗
   🔴 **絕對不可以寫成 `f.rot = 正規化(絕對角)`** —— 那會讓貼牆的家具翻掉：
      place() 的 wall 分支是 `ang = wallAngle(w) + f.rot*π/180`
      ⇒ 把**絕對角**直接塞進 f.rot ⇒ **牆角被加兩次**
      ⇒ 她在 53.2° 的斜牆上把角度打成 120，家具會跑到 **173.2°**。
   ⇒ 所以要先把牆角**減掉**，換算回「相對於那道牆」的 rot。free 時 wallDeg=0 ⇒ 自然退化。
   ⚠️ 抽成一支的理由見 obs O-34：同一個狀態轉換有多個入口時，通常只有一個做對了。
   🛑 **不寫 flags.rotUser**（Ali 裁決【丁】，見 snapRot 上方）。 ╚═══════════════════╝ */
function setRot(f, absDeg){
  const p = place(f);                                          // 🔴 先取得目前的 anchor 狀態
  const wallDeg = p.wall ? wallAngle(p.wall)*180/Math.PI : 0;
  f.rot = normDeg(absDeg - wallDeg);
  saveItem(f).catch(e=>cloudErr(e)); render(); syncSel();
}
/* ╔═ 🔴 §3-1d｜角度欄的解析：一個**極小的求值**，不是通用算式 ═══════════════════╗
   接受的字元　數字、小數點、`+`、`-`、空白。其餘一律無效。
   求值規則　　把字串切成**帶符號的項**，全部相加。第一項沒有符號就是正的。
       `90+30` → 120 ／ `90-30` → 60 ／ `90+30-5` → 115 ／ `-30` → −30 → 正規化 → **330**
   🔑 為什麼這樣就夠：Ali 定的語意是「欄位**預填目前值**」⇒「在 90 後面接著打 +30」
      這件事自然成立，不需要另外定義一套相對語意 —— 她打完之後欄位字面上就是 `90+30`，
      而她**看得到自己打了什麼**。
   🛑🛑 **絕對不可以用 eval() 或 new Function()** —— 那個字串來自輸入框，
      而這個 App 之後要多人共享。自己寫十行切字串 ⇒ 沒有任何執行任意碼的可能。
   🔴 也**不要**支援 `*`、`/`、括號 —— 她沒有要，而每多一個符號就多一組邊界。
   回傳　數字（已正規化到 [0,360)，1 位小數）／null ＝ 無效 ╚═══════════════════════╝ */
function parseAngle(raw){
  const s=String(raw==null?'':raw).trim();
  if(s==='') return null;
  if(!/^[0-9.+\-\s]+$/.test(s)) return null;        // 只准這些字元
  const terms=s.match(/[+-]?\s*[0-9]*\.?[0-9]+/g);  // 切成帶符號的項
  if(!terms) return null;
  // 🔴 把項接回去比對，確認沒有任何字元被默默忽略（例如 `90++` 或 `9.9.9`）
  if(terms.join('').replace(/\s/g,'') !== s.replace(/\s/g,'')) return null;
  let sum=0;
  for(const t of terms){
    const v=parseFloat(t.replace(/\s/g,''));
    if(!isFinite(v)) return null;
    sum+=v;
  }
  if(!isFinite(sum)) return null;
  return Math.round(normDeg(sum)*10)/10;
}
/* ╔═ 🔴🔴 §3-1d｜commitAngEdit() 的**七條入口**，與 commitFieldEdits 完全同構 ═══════╗
   ① blur ② Enter ③ btnDone〔完成〕 ④ visibilitychange→hidden ⑤〔回主畫面〕
   ⑥ 切到另一個模式（openMode） ⑦ select()
   🔴 v0.21_i 下-24：⑥ 對使用者**已經不可達**（模式裡兩個入口都換成〔（保留）〕，
      openMode 只剩「平常」狀態呼叫得到，而那時 angOpen 必為 false ⇒ 這條 commit 是 no-op）。
      碼仍然留著呼叫 —— 它是無害的防線，萬一之後又加回互跳入口就自動生效。
      ⇒ 驗收 N-554「切模式 ⇒ 有存到」**作廢**；其餘六條照舊。
   🔴 ④ 是**資料損毀級**：手機上「失焦」不可靠 —— 直接鎖屏或切 App 可能不觸發 blur
      ⇒ 她在角度框打到一半直接鎖屏，沒有任何一行碼保證會存。
      （與 v0.15_i 修一-a 抓出來的坑**同一個形狀，只是換了一個新欄位**。）
   🔴 守衛在最前面，與 commitFieldEdits 一致 —— 面板沒開時 #fang 的內容不代表這一件的資料。 ╚═╝ */
function commitAngEdit(){
  if(!S.angOpen) return;
  const f=FURN.find(x=>x.id===S.selId); if(!f||!hasSize(f)) return;
  const inp=$('fang'); if(!inp) return;
  const v=parseAngle(inp.value);
  if(v==null){
    /* 🔴 無效 → 還原成上一個有效值（記憶體裡那個），移除紅框，不寫入。 */
    inp.value = absDegOf(f);
    inp.classList.remove('bad');
    return;
  }
  inp.classList.remove('bad');
  setRot(f, v);
}
/* 🔴 保險：手機上「失焦」不可靠——直接鎖屏或切 App 可能不觸發 blur */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    commitFieldEdits();
    commitAngEdit();          // 🔴 §3-1d 入口 ④：資料損毀級，不可以漏
    commitNameEdits();
    commitAlbumEdits();       // 🔴 v0.1.9：相簿的名字／備註（手機鎖屏時 blur 不可靠）
  }
});
/* 角度欄的三條繫結（§3-1d 入口 ①②）＋ 打字中的紅框（沿用需求 7 的顆粒度） */
if($('fang')){
  $('fang').addEventListener('input',()=>{
    /* 打字中：不阻止、不還原、不寫入 —— 但無效就加紅框，讓「這個值沒被採用」看得出來。
       🔴 與尺寸欄不同：角度**不做即時 render**（算式打到一半的中間狀態沒有意義，
          例如 `90+` ⇒ 會被判成無效；真正生效的時機是 commit）。 */
    $('fang').classList.toggle('bad', parseAngle($('fang').value)==null);
  });
  $('fang').addEventListener('blur',()=>commitAngEdit());
  $('fang').addEventListener('keydown',e=>{ if(e.key==='Enter'){ $('fang').blur(); } });
}

/* 🔴 v0.20_i §3-1｜〔↻ 旋轉〕從「按一下轉 90°」改成**模式入口**（Ali 2026-09-20 定）。
   ⚠️ 舊的 +90 行為**沒有消失**，它搬到展開列的〔↻ 90〕那一顆（見 angR90，走 setRot）。
   🔴 這裡曾經還寫過 `f.flags={...,rotUser:true}` —— 那是 flags.rotUser 全檔【唯一】的
      寫入點，已隨該旗標整族撤掉（理由見 snapRot 上方）。🛑 不要加回來。 */
$('btnRot').onclick=()=> openMode(S.angOpen ? null : 'ang');
/* ╔═ 🔴 v0.20_i §3-1e／§3-1f｜角度的三顆按鈕，全部走 setRot（唯一寫入點）═══════════╗
   四個入口都先算出**絕對角**再交給 setRot：
     [−1] 目前絕對角 − ANG_STEP ／ [＋1] ＋ANG_STEP ／ [↻90] ＋90 ／ 輸入框 解析出來的值
   （「目前絕對角」＝ absDegOf(f)）
   🔴 [−1][＋1] 走 bindRepeat ⇒ 長按連發（N-522）；[↻90] 不連發（整轉一次就是一次）。 */
function angBump(delta){
  const f=FURN.find(x=>x.id===S.selId); if(!f||!hasSize(f)) return;
  setRot(f, absDegOf(f) + delta);
}
bindRepeat($('angDec'), ()=>angBump(-ANG_STEP));
bindRepeat($('angInc'), ()=>angBump(+ANG_STEP));
$('angR90').onclick=()=>{ $('angR90').blur(); angBump(90); };   // ＝ 舊〔↻ 旋轉〕的行為，換了位置
/* ╔═ 🔴 v0.20_i §3-1g ①｜進入／切換模式的唯一函式 ═════════════════════════════════╗
   Ali：「旋轉和微調角度，我決定**視為同一個功能入口，就像改尺寸會展開長寬高一樣**。」
   ⇒ 兩個模式共用同一個骨架，而切換就是「換一組展開欄位 ＋ 換第二排」。
   🔴 v0.21_i 下-24：模式之間【不再能互跳】（兩個入口在模式裡都是〔（保留）〕）
      ⇒ 本函式只會從「平常」狀態被呼叫。本身一行不改（它仍是唯一的切換函式）。
      🗂 v0.20_i 的驗收 N-515（旋轉 → 改尺寸互跳）作廢。
   🔴 **順序不可換：先 commit（守衛還沒被關掉，存得到），後切旗標。**
      理由與 select() 那一段完全相同（守衛會把 commit 擋成 no-op 且不報錯）。
   🔴 which 為 null ⇒ 兩個都 false（＝在該模式裡再按自己那一顆就收起來）。
      ⚠️ 依 §3-1a，模式裡自己那一顆已經被換成保留格了，所以這條路平常走不到；
         留著它只是為了「萬一 DOM 還在」不要變成怪狀態。 ╚═══════════════════════════╝ */
function openMode(which){                 // which ∈ {'size','ang',null}
  commitFieldEdits();                     // 🔴 先存
  commitAngEdit();                        // 🔴 先存
  S.sizeOpen = (which === 'size');        // 後切
  S.angOpen  = (which === 'ang');
  /* 🔴 既有行為，掉了會靜默回歸：她把警示列點開看全部、再按〔改尺寸〕，
     現況會收起來；漏了就維持展開、面板再多一行。 */
  S.warnOpen = false;
  $('sel').classList.toggle('szopen', S.sizeOpen || S.angOpen);
  syncSel();
}
$('btnSize').onclick=()=> openMode(S.sizeOpen ? null : 'size');
/* 🔴 §3-1b：〔回主畫面〕（v0.21_i 下-25 改名，原〔上一頁〕）＝ commitAngEdit 的第五條入口。
   順序同樣是先存後關。v0.21_i 下-24 之後，這是離開模式、換到另一個模式的【唯一】路徑。 */
$('btnUp').onclick=()=>{
  commitFieldEdits();
  commitAngEdit();
  S.sizeOpen=false;
  S.angOpen=false;
  syncSel();
};
/* ╔═ ⚠️ v0.17_i 丙-6｜「貼回最近的牆」是一整條【新功能】，不是改文字 ═════════════╗
   舊的 btnUnsnap 是單向的（脫離得了、貼不回去）。七點規格（丙-6）全部寫死在這裡：
   ① 「最近」怎麼量：用目前 place(f) 的中心 c 掃全部 WALLS，取 gap = d - perpHalf(f) 最小者
      🔴 不可以沿用 previewMove 的算式 —— 它從 S.dragging 取 gx/gy，靜態按鈕沒有 S.dragging
   ② 🔴 距離上限 SNAP_MAX_CM(50)：超過就【不動】並在 selNote 說一句
      （沒有上限 ⇒ 在屋子中央按一下，家具會飛到三公尺外的牆上）
   ③ side = sideFromPoint(w, c) 🔴 不可以用預設值（O-8：她放在哪一側是表態過的維度）
   ④ rot = snapRot(目前絕對朝向, wallAngle(w), f) 🔴 走既有那一支，不要自己寫
      ⚠️ v0.20_i 下-20 之後語意變了：snapRot **一律取牆角**（碰牆＝貼齊＝取角，沒有例外）
      ⇒ 🔴 這條路等於「再碰一次牆」⇒ 她用〔🧲 未貼牆〕貼回去時，
        下-19 剛替她保住的那個角度**會被牆角覆蓋**。那是【預期行為】（驗收 N-564b）。
   ⑤ along 夾限比照 previewMove
   ⑥ L('snap') 熄著時這顆鈕 disabled（見 syncSel）
   ⑦ 守衛改成只看 noSize（見 syncSel） ╚═══════════════════════════════════════════╝ */
function snapBackToWall(f){
  const c=place(f);
  let best=null;
  /* 🔴 §下-4 ③：snapBackToWall 是同一個形狀 —— perpHalf 也要【相對於該候選牆】算。
     這裡家具的絕對朝向是 c.ang（place() 算出來的），不是 S.dragging.ang。 */
  WALLS.forEach(w=>{
    const {d,t}=distSeg(c.x,c.y,w);
    const rel=c.ang - wallAngle(w);
    const ph=Math.abs((f.w/2)*Math.sin(rel)) + Math.abs((f.d/2)*Math.cos(rel));
    const gap=d-ph;
    if(!best || gap<best.gap) best={w,t,gap};
  });
  if(!best || best.gap > SNAP_MAX_CM) return false;
  const w=best.w, a=wallAngle(w);
  const side=sideFromPoint(w, c.x, c.y);
  const along=Math.max(f.w/2, Math.min(wallLen(w)-f.w/2, best.t*wallLen(w)));
  f.rot = snapRot(c.ang, a, f);   // 🔴 v0.20_i 下-20：一律取牆角（見 ④ 的警語）
  f.anchor={type:'wall', wall:w.id, along, off:0, side};
  return true;
}
$('btnUnsnap').onclick=()=>{ const f=FURN.find(x=>x.id===S.selId); if(!f) return;
  const p=place(f);
  /* 🔴 v0.21_i §6c-3 ③ 下-28：點擊【三種狀態】（判準＝isFlushToWall，與亮暗同一支）
       已貼牆（flush）　　 ⇒ 脫離（下-19，下面這段一行不改）
       掛在牆上但沒貼著　 ⇒ 🆕 貼回去：off=0、相對角取最近的 90 倍數，anchor（牆／along／side）不變
       沒掛在任何牆（free）⇒ snapBackToWall（一行不改） */
  if(p.wall && !isFlushToWall(f)){
    f.anchor.off = 0;
    f.rot = (Math.round(normDeg(f.rot||0)/90) % 4) * 90;   // 相對於那道牆的角度 ⇒ 最近的 90 倍數
    S.selMsg='';
  }else if(p.wall){
    /* ╔═ 🔴🔴 v0.20_i §5 下-19｜脫離牆面【不可以弄丟角度】═══════════════════════╗
       Ali 問：「對齊牆面之後，不吸附牆，已經取好的角度會留著嗎？」⇒ 查碼：不會。
       根因　f.rot 的語意隨 anchor 改變：
             wall ⇒ rot 是【相對於那道牆】（place: ang = wallAngle + rot）
             free ⇒ rot 是【絕對角】     （place: ang = rot）
             ⇒ 只換 anchor 而不換 rot ＝ 同一個數字被換了一套座標系
             ⇒ 絕對朝向從 (牆角＋rot) 掉成 (rot) ⇒ **整個牆角掉了，而且不報錯**。
       症狀　貼在 53.2° 斜牆上（此時 rot=0）→ 按〔🧲 已貼牆〕⇒ 家具當場轉回 0 度。
             ⚠️ 用拖的就不會（commitMove 那一支有換算）⇒ 同一件事、兩條路、兩種結果。
       🔴 這一行不加，「碰牆取角」這個功能等於不存在（取完要脫離才能自由移動）。
       🛑 **不要**順手寫 flags.rotUser —— 那個旗標整族已撤（見 snapRot 上方）。
       📌 這是 obs O-34 的實例：同一個狀態轉換有三個入口（拖走／本處／刪房間），
          而錯的那一個正是「**最不像在做狀態轉換**」的這一個（它長得像只是切一個開關）。╚═╝ */
    f.rot = ((p.ang*180/Math.PI) % 360 + 360) % 360;   // 🔴 下-19：保住絕對朝向
    f.anchor={type:'free',x:p.x,y:p.y};   // 脫離牆面＝換錨點
    S.selMsg='';
  }else{
    if(!snapBackToWall(f)){
      /* 🔴 O-18：「什麼都沒發生」不可以是一種回答。說出為什麼。 */
      S.selMsg=`附近沒有牆（${SNAP_MAX_CM} 公分內），沒有貼上去。`;
      syncSel(); return;
    }
    S.selMsg='';
  }
  saveItem(f).catch(e=>cloudErr(e)); render(); syncSel(); };
/* 🔴 v0.17_i 修十二｜〔🔍 檢視〕＝ `›` 的反方向：平面圖 → 清單，捲到那一張卡片【並展開】。
   🔴 她的意圖是「把這一件的細項攤開給我看（特別是備註）」——
      只切分頁而不展開卡片＝沒有解決她的問題（同名家具一樣找很久）。
   🔴 丙-7：捲動定位沿用 addItemFromList() 既有的做法（querySelector → scrollIntoView），
      🔴 不是「沿用 › 那一側」—— › 那一側【沒有】捲動定位，方向相反。
      🔴 選擇器用 .icard[data-id]（itemCard 已加），不要靠 .nm。
   🔴 S.expandCause='manual'：若沿用上一次的值而剛好是 'chip'，她在展開列選一個房間
      就會【被自動擺上去並跳分頁】—— 而她只是想看備註。 */
$('btnView').onclick=()=>{
  const f=FURN.find(x=>x.id===S.selId); if(!f) return;
  commitFieldEdits();
  S.expandId=f.id; S.expandCause='manual';
  setTab('list');                       // setTab('list') 內部會 buildList()
  buildList();
  const c=document.querySelector(`.icard[data-id="${f.id}"]`);
  if(c) try{ c.scrollIntoView({block:'center'}); }catch(e){}
};
/* 🔴 §3-1d 入口 ③：〔完成〕也要存角度。
   📌 select(null) 內部也會再 commit 一次（第七條入口），那是無害的冪等 ——
      兩支的守衛都會在 sizeOpen/angOpen 已被清掉時擋下來。這裡明寫是為了入口表對得上。 */
$('btnDone').onclick=()=>{ commitFieldEdits(); commitAngEdit(); select(null); render(); syncSel(); };
$('btnFold').onclick=()=>{ const s=$('sel'); s.classList.toggle('mini');
  $('btnFold').textContent = s.classList.contains('mini')?'▴':'▾'; };
$('warnLine').onclick=()=>{ S.warnOpen=!S.warnOpen; syncSel(); };
/* ╔═ 🔴 v0.17_i 修五｜平面圖那顆從【刪除】改成【收回清單】 ═════════════════════╗
   Ali：「只有哪裡可以把東西丟到垃圾桶吧。我選清單。」
   🔴 前置＝修一（清單展開列已經有 🗑）。順序顛倒的話家具會變成【刪不掉而且不報錯】。
   🔴 不需要確認框 —— 這是可逆的（清單按〔擺上圖〕就回來）。
   🔴 §0-5 A-4：select(null) 要放在【重畫之前】。
      放最後的症狀：家具從圖上消失、面板還開著、微調鍵按了完全沒反應（selId 已 null），
      因為 syncSel 只在「找不到這筆」或「不在 plan 分頁」時才收面板。 ╚═══════════╝ */
$('btnDel').onclick=async()=>{
  const f=FURN.find(x=>x.id===S.selId); if(!f) return;
  f.isPlaced=false;                       // 🔴 anchor 保留（它記得上次擺哪）
  await saveItem(f).catch(e=>cloudErr(e));
  await reloadObjects();
  select(null);
  render(); buildList(); syncSel();
};
