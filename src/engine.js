/* ============================================================
 * 《地产股神》v0.1 — 规则引擎
 * 纯逻辑，不碰 DOM，可以在 Node 里跑无头模拟。
 * ============================================================ */

function rnd(a, b) { return a + Math.random() * (b - a); }
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function floor100(x) { return Math.max(100, Math.floor(x / 100) * 100); }
function round10(x) { return Math.round(x / 10) * 10; }
function money(n) { return '¥' + Math.round(n).toLocaleString('en-US'); }

class Game {
  constructor(setup) {
    const C = CONFIG;
    /* ★ 必须是**快照副本**，不能是引用。
       早先是 `this.config = C`，等于每个对局和全局 CONFIG 是同一个对象，于是：
         ① 同一服务端开两个房间时，后开房间的局时/初始现金会**覆盖**先开的；
         ② 存档恢复后全局 CONFIG 退回默认值，而 endTurn 读的是 CONFIG.maxQuarters，
            于是**任何恢复过的对局都会提前结束**（实测 PGVS 在 Q36 被砍，上限本是 50）。
       改成副本后，每局设置只属于自己；读配置统一走 this.totalQuarters()。 */
    this.config = Object.assign({}, C);

    this.players = (setup.players || []).map((p, i) => ({
      id: i,
      name: p.name || ('玩家' + (i + 1)),
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isAI: !!p.isAI,
      /* ★ managed = "AI 在替一个不在场的人打"，和"本来就是电脑玩家"是两回事。
         托管档要保守（留现金、不碰高风险卡、不主动交易），因为目标是别把人打崩。 */
      managed: !!p.managed,
      cash: C.startingCash,
      pos: 0,
      jailTurns: 0,
      alive: true,
      stocks: {},
      products: { junk: null, option: null, insurance: null, deposit: null },
      productStats: { venture: 0, junk: 0, option: 0, insurance: 0, deposit: 0 },
      lastRoll: null,
    }));

    this.tiles = TILES.map(t => ({
      id: t.id, type: t.type, name: t.name, short: t.short,
      group: t.group || null, basePrice: t.basePrice || 0,
      owner: -1, level: 0, mortgaged: false, loan: 0, marginCall: false,
    }));

    this.stocks = STOCKS.map(s => ({
      code: s.code, name: s.name, sector: s.sector, kind: s.kind, desc: s.desc,
      drift: s.drift, vol: s.vol, base: s.base,
      price: s.price, hist: [Math.round(s.price)],
      rebounded: false, delisted: false, swanCooldown: 0,
    }));

    this.rei = C.reiStart;
    this.reiHist = [C.reiStart];
    this.reiTradeUsed = 0;
    /* ★ 地产周期：一局里会经历好几轮「繁荣 → 过热 → 衰退 → 复苏」 */
    this.cycleT = 0;
    this.cyclePeriod = Math.round(rnd(C.reiCycleMin, C.reiCycleMax));
    this.cycleAmp = C.reiCycleAmp;

    this.quarter = 1;
    this.current = 0;
    this.actedThisQuarter = [];
    this.phase = 'awaiting-roll';
    this.pending = null;
    this.dice = [0, 0];
    this.lastPips = 7;
    this.logs = [];
    this.uid = 0;
    this.over = false;
    this.winner = null;
    this.ranking = null;
    this.activity = this.freshActivity();
    this.log(`游戏开始，共 ${this.players.length} 位玩家，每人初始现金 ${money(C.startingCash)}`, 'quarter');
  }

  /* ---------------- 基础工具 ---------------- */
  freshActivity() {
    return { buyLand: 0, upgrade: 0, mortgage: 0, redeem: 0, bankrupt: 0, rentCount: 0, rentTotal: 0, sellLand: 0, seize: 0 };
  }
  log(msg, kind) {
    this.logs.push({ id: ++this.uid, q: this.quarter, msg, kind: kind || 'info' });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }
  tile(i) { return this.tiles[i]; }
  cur() { return this.players[this.current]; }
  alivePlayers() { return this.players.filter(p => p.alive); }
  stockByCode(code) { return this.stocks.find(s => s.code === code); }
  stockPrice(s) { return s.kind === 'rei' ? Math.round(this.rei * 10) / 10 : Math.round(s.price * 10) / 10; }
  syncReiStock() {
    const s = this.stocks.find(x => x.kind === 'rei');
    if (s) s.price = this.rei;
  }
  groupTiles(group) { return this.tiles.filter(t => t.group === group && t.type === 'land'); }
  ownsGroup(pid, group) {
    const g = this.groupTiles(group);
    if (!g.length) return false;
    /* ★ 垄断门槛可配（CONFIG.monopolyShare，默认 2/3）。
       原因：真人实测三局**一次垄断都没发生**，而多组地块已经卡在 2/3
       （NFYD 璃月 2-1-2、EW85 蒙德 3-0）。全持在 25 个季度内基本做不到，
       于是"凑齐一个地区"这个核心策略目标形同虚设。
       注意 2 块地的地区（至冬）：share=2/3 → ceil(1.33)=2，仍然要全拿。 */
    const share = (CONFIG.monopolyShare === undefined) ? 1 : CONFIG.monopolyShare;
    const need = Math.max(1, Math.ceil(g.length * share));
    return g.filter(t => t.owner === pid).length >= need;
  }
  groupProgress(pid, group) {
    const g = this.groupTiles(group);
    return { have: g.filter(t => t.owner === pid).length, total: g.length };
  }
  countType(pid, type) { return this.tiles.filter(t => t.type === type && t.owner === pid).length; }
  ownedTiles(pid) { return this.tiles.filter(t => t.owner === pid); }

  /* ---------------- 价格 ---------------- */
  /** 地价（买地价 / 租金基数）：随地产指数浮动 */
  landPrice(t) {
    if (!t.basePrice) return 0;
    return floor100(t.basePrice * this.rei / 100);
  }
  /** 市值（含盖楼投入） */
  assetValue(t) {
    const P = this.landPrice(t);
    if (t.type === 'land') {
      const lv = t.level >= 1 ? t.level : 1;
      return floor100(P * CONFIG.levelValue[lv]);
    }
    return P;
  }
  upgradeCost(t) {
    return floor100(this.landPrice(t) * CONFIG.upgradeCostRate[t.level + 1]);
  }
  rentOf(t, pips) {
    const C = CONFIG;
    const scale = this.rei / 100;
    if (t.type === 'rail') {
      const n = Math.max(1, this.countType(t.owner, 'rail'));
      return round10(C.railRent[Math.min(n, 4)] * scale);
    }
    if (t.type === 'utility') {
      return round10(pips * C.utilityRentPerPip * scale);
    }
    let rent = this.landPrice(t) * C.rentRate[t.level];
    if (this.ownsGroup(t.owner, t.group)) rent *= C.groupRentBonus;
    return round10(rent);
  }

  netWorth(p) {
    let v = p.cash;
    for (const t of this.tiles) {
      if (t.owner !== p.id) continue;
      v += this.assetValue(t) - (t.mortgaged ? t.loan : 0);
    }
    for (const s of this.stocks) {
      const n = p.stocks[s.code] || 0;
      if (n > 0 && !s.delisted) v += n * this.stockPrice(s);
    }
    return Math.round(v);
  }

  /* ---------------- 地产指数 ---------------- */
  adjustRei(delta) {
    const C = CONFIG;
    let v = this.rei + delta;
    if (v < C.reiMin) {
      v = C.reiMin + (C.reiMin - v) * 0.5;
      this.log(`地产指数跌破 ${C.reiMin}，政策托底，强力反弹`, 'good');
    }
    if (v > C.reiMax) {
      v = C.reiMax - (v - C.reiMax) * 0.5;
      this.log(`地产指数冲破 ${C.reiMax}，调控降温`, 'warn');
    }
    this.rei = Math.max(C.reiMin, Math.min(C.reiMax, v));
    this.syncReiStock();
  }
  /** 通过买卖地产 ETF 推动指数（每季度有上限，防止刷分） */
  adjustReiByTrade(pts) {
    if (pts === 0) return;
    const cap = CONFIG.reiTradeCap;
    const room = cap - Math.abs(this.reiTradeUsed);
    if (room <= 0) return;
    const want = Math.sign(pts) * Math.min(Math.abs(pts), room);
    this.reiTradeUsed += want;
    this.adjustRei(want);
  }
  /** 当前周期波动值（正=景气，负=衰退） */
  cycleWave() {
    if (!this.cyclePeriod) return 0;
    return Math.sin(Math.PI * 2 * (this.cycleT / this.cyclePeriod)) * this.cycleAmp;
  }
  cycleLabel() {
    const w = this.cycleWave();
    if (w > 12) return { name: '繁荣', cls: 'up' };
    if (w < -12) return { name: '衰退', cls: 'down' };
    return { name: '平稳', cls: '' };
  }
  /** 当前地产指数的"合理值"：起点 + 稀缺加成 + 周期 */
  fairRei() {
    const lands = this.tiles.filter(t => t.type === 'land');
    const owned = lands.filter(t => t.owner >= 0).length;
    return CONFIG.reiStart + (owned / lands.length) * CONFIG.reiScarcityBonus + this.cycleWave();
  }

  updateRei() {
    const C = CONFIG;
    /* 推进地产周期 */
    this.cycleT++;
    if (this.cycleT >= this.cyclePeriod) {
      this.cycleT = 0;
      this.cyclePeriod = Math.round(rnd(C.reiCycleMin, C.reiCycleMax));
      this.cycleAmp = Math.round(rnd(C.reiCycleAmp * 0.7, C.reiCycleAmp * 1.35));
      this.log(`【周期】新一轮地产周期启动：预计持续约 ${this.cyclePeriod} 个季度，振幅 ±${this.cycleAmp}`, 'quarter');
    }
    const before = this.rei;
    const fair = this.fairRei();
    let delta = (fair - this.rei) * C.reiRegression + rnd(-C.reiQuarterNoise, C.reiQuarterNoise);
    const a = this.activity;
    /* ★ 活跃度项**去中心化**（reiActivityBaseline）。
       实测（4197 个季度）：这一项平均每季度 **+1.08**，占确定性漂移的 77%；
       而周期有效振幅只有 ±19 —— 于是"正常打牌"产生的单向上漂把周期彻底压死，
       真人局里 REI 从 94 一路涨到 132（8 个季度 +40%）就是这么来的。
       原因：正项（买地 0.78 次/季、升级 1.89 次/季）是每个人一直在做的事，
       负项（抵押 0.49、破产极罕见）几乎不发生，所以它天生偏向正。
       现在减去"正常活跃度"的基线，让这一项在常规对局里**均值为 0**：
       只有**异常**活跃（抢地、爆买、集体破产）才会推动指数。
       把 reiActivityBaseline 设为 0 即恢复旧行为（A/B 用）。 */
    delta += a.buyLand * 0.5 + a.upgrade * 0.8 + a.redeem * 1.0
      - a.mortgage * 1.5 - a.bankrupt * 5 - (a.sellLand || 0) * 1.5 - (a.seize || 0) * 3
      - (C.reiActivityBaseline || 0);
    this.adjustRei(delta);
    const cl = this.cycleLabel();
    this.log(`【季度】地产指数 ${before.toFixed(1)} → ${this.rei.toFixed(1)}（${this.rei >= before ? '+' : ''}${(this.rei - before).toFixed(1)}）· 周期位置：${cl.name}`,
      this.rei >= before ? 'good' : 'warn');
    this.reiHist.push(Math.round(this.rei * 10) / 10);
    if (this.reiHist.length > 60) this.reiHist.shift();
    this.activity = this.freshActivity();
    this.reiTradeUsed = 0;
  }

  /* ---------------- 持有成本：物业税 ---------------- */
  /** 局末加压系数：从 propertyTaxLateFrom 线性涨到 propertyTaxLateMult。
   *  目的是把"追缴 → 强制收地 → 破产"这些高潮提前到真人真能打到的季度，
   *  而不是靠砍短局时（实测砍短只会让高潮的相对位置更靠后）。 */
  lateTaxMult() {
    const C = CONFIG;
    const from = C.propertyTaxLateFrom === undefined ? 1 : C.propertyTaxLateFrom;
    const mult = C.propertyTaxLateMult === undefined ? 1 : C.propertyTaxLateMult;
    const total = (this.config && this.config.maxQuarters) || C.maxQuarters || 50;
    const prog = Math.min(1, (this.quarter - 1) / total);
    if (prog <= from) return 1;
    return 1 + ((prog - from) / (1 - from)) * (mult - 1);
  }
  chargePropertyTax() {
    const C = CONFIG;
    const late = this.lateTaxMult();
    const rate = C.propertyTaxRate * late;
    let total = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      let base = 0;
      for (const t of this.tiles) {
        if (t.owner !== p.id) continue;
        base += this.assetValue(t) * (t.mortgaged ? C.propertyTaxMortgagedFactor : 1);
      }
      if (base <= 0) continue;
      const tax = Math.round(base * rate / 100) * 100;
      if (tax <= 0) continue;
      total += tax;
      this.charge(p, tax, 'bank');
      this.log(`${p.name} 缴纳物业税 ${money(tax)}（地产市值 ${money(base)} × ${(C.propertyTaxRate * 100).toFixed(1)}%）`, 'warn');
    }
    if (total > 0) this.log(`本季度共征收物业税 ${money(total)}`, 'info');
  }

  /* ---------------- 杠杆风险：市值跌破贷款线 → 追缴 ---------------- */
  markMarginCalls() {
    const C = CONFIG;
    for (const t of this.tiles) {
      if (t.owner < 0 || !t.mortgaged) { t.marginCall = false; continue; }
      const under = this.assetValue(t) < t.loan * C.marginCallRatio;
      if (under && !t.marginCall) {
        t.marginCall = true;
        this.log(`⚠️ ${this.players[t.owner].name} 的 ${t.name} 市值跌到 ${money(this.assetValue(t))}，低于贷款 ${money(t.loan)} 的 ${Math.round(C.marginCallRatio * 100)}%——银行发出追缴，下回合结束前不赎回就会被收走`, 'bad');
      } else if (!under) {
        t.marginCall = false;
      }
    }
  }
  enforceMarginCalls(p) {
    if (!p || !p.alive) return;
    for (const t of this.tiles) {
      if (t.owner !== p.id || !t.mortgaged || !t.marginCall) continue;
      if (this.assetValue(t) >= t.loan * CONFIG.marginCallRatio) { t.marginCall = false; continue; }
      this.log(`🏦 银行强制收回 ${p.name} 的 ${t.name}（贷款 ${money(t.loan)} 一并勾销），地块重新挂牌`, 'bad');
      t.owner = -1; t.level = 0; t.mortgaged = false; t.loan = 0; t.marginCall = false;
      this.activity.seize = (this.activity.seize || 0) + 1;
    }
  }

  /* ---------------- 股市 ---------------- */
  marketTick(full) {
    const C = CONFIG;
    for (const s of this.stocks) {
      if (s.delisted) continue;
      if (s.kind === 'rei') {
        s.hist.push(Math.round(this.rei * 10) / 10);
        if (s.hist.length > 40) s.hist.shift();
        continue;
      }
      const k = full ? 1 : 0.25;
      const reversion = ((s.base - s.price) / s.base) * (full ? 0.06 : 0.02);
      let ret = s.drift * k + s.vol * (full ? 1 : 0.45) * gauss() + reversion;
      if (full) ret += ((this.rei - 100) / 100) * 0.25;
      s.price = Math.max(1, s.price * (1 + ret));

      s.hist.push(Math.round(s.price));
      if (s.hist.length > 40) s.hist.shift();

      if (full) this.checkExtremes(s);
    }
    if (full) this.syncReiStock();
  }
  checkExtremes(s) {
    // 黑天鹅：涨太多时可能崩一下
    if (s.swanCooldown > 0) s.swanCooldown--;
    if (s.price >= s.base * 1.8 && s.swanCooldown === 0 && Math.random() < 0.3) {
      s.price *= 0.85;
      for (const o of this.stocks) if (o !== s && !o.delisted && o.kind !== 'rei') o.price *= 0.96;
      this.adjustRei(-4);
      s.swanCooldown = 3;
      this.log(`【黑天鹅】${s.name} 高位崩盘 −15%，大盘跟跌`, 'bad');
    }
    // 强势反弹：跌破起始价一半，一只股只反弹一次
    if (s.price <= s.base * 0.5 && !s.rebounded) {
      s.price *= 1.03;
      s.rebounded = true;
      this.log(`【强势反弹】${s.name} 跌破半价，资金抄底 +3%`, 'good');
    }
    if (s.price > s.base * 0.6) s.rebounded = false;
    // 退市
    if (s.price <= 1) {
      s.delisted = true;
      let lost = 0;
      for (const p of this.players) {
        const n = p.stocks[s.code] || 0;
        if (n > 0) { lost += n; p.stocks[s.code] = 0; }
      }
      this.log(`【退市】${s.name} 股价归零，${lost} 股全部清零`, 'bad');
    }
  }
  isTopPriceStock(s) {
    let top = null;
    for (const o of this.stocks) {
      if (o.delisted) continue;
      if (!top || this.stockPrice(o) > this.stockPrice(top)) top = o;
    }
    return top === s;
  }
  applyTradeImpact(s, qty, side) {
    const C = CONFIG;
    if (side === 'buy') {
      const pct = Math.min(C.stockMaxOrderImpact, C.stockBuyImpact * qty);
      s.price = s.price * (1 + pct);
      if (s.kind === 'rei') this.adjustReiByTrade(Math.min(C.etfReiOrderCap, C.etfReiBuyImpact * qty) * this.rei);
    } else {
      let pct = Math.min(C.stockMaxOrderImpact, C.stockSellImpact * qty);
      if (this.isTopPriceStock(s)) pct += Math.min(0.02, C.stockSellTopExtra * qty);
      s.price = Math.max(1, s.price * (1 - pct));
      if (s.kind === 'rei') this.adjustReiByTrade(-Math.min(C.etfReiOrderCap, C.etfReiSellImpact * qty) * this.rei);
    }
  }
  /** 预估成交价（吃下滑点之后的价格），不改状态 */
  fillPrice(s, qty, side) {
    const C = CONFIG;
    const cur = this.stockPrice(s);
    if (side === 'buy') {
      const pct = Math.min(C.stockMaxOrderImpact, C.stockBuyImpact * qty);
      return cur * (1 + pct);
    }
    let pct = Math.min(C.stockMaxOrderImpact, C.stockSellImpact * qty);
    if (this.isTopPriceStock(s)) pct += Math.min(0.02, C.stockSellTopExtra * qty);
    return Math.max(1, cur * (1 - pct));
  }
  /* ★ 定价模型：先推动价格，再按推动后的价格成交。
     所以你买到的永远是被自己推高的价，卖出永远是被自己砸低的价，
     同一回合内买卖往返必亏，反复刷差价这条路被从根上堵死。 */
  buyStock(code, qty, p) {
    p = p || this.cur();
    const C = CONFIG;
    const s = this.stockByCode(code);
    if (!s || s.delisted) return { ok: false, msg: '该股票已退市' };
    let want = Math.floor(qty);
    if (want <= 0) return { ok: false, msg: '股数不对' };

    /* 买不起就自动缩量到能买得起的股数 */
    const perShare = this.fillPrice(s, 1, 'buy') * (1 + C.stockCommission);
    let q = Math.min(want, Math.floor(p.cash / perShare));
    while (q > 0 && p.cash < this.fillPrice(s, q, 'buy') * q * (1 + C.stockCommission)) q--;
    if (q <= 0) return { ok: false, msg: '现金不足' };

    this.applyTradeImpact(s, q, 'buy');            // 先推动价格
    const price = this.stockPrice(s);              // 再按推动后的价格成交
    const cost = Math.round(price * q * (1 + C.stockCommission));
    if (p.cash < cost) { this.applyTradeImpact(s, q, 'sell'); return { ok: false, msg: '现金不足' }; }
    p.cash -= cost;
    p.stocks[code] = (p.stocks[code] || 0) + q;
    this.log(`${p.name} 买入 ${s.name} ${q} 股 @${price.toFixed(1)}（含手续费），花费 ${money(cost)}`, 'trade');
    return { ok: true, cost, price, qty: q, partial: q < want };
  }
  sellStock(code, qty, p, silent) {
    p = p || this.cur();
    const C = CONFIG;
    const s = this.stockByCode(code);
    if (!s) return { ok: false, msg: '没有这只股票' };
    if (s.delisted) return { ok: false, msg: '该股票已退市' };
    const have = p.stocks[code] || 0;
    const q = Math.min(Math.floor(qty), have);
    if (q <= 0) return { ok: false, msg: '没有持仓' };

    this.applyTradeImpact(s, q, 'sell');           // 先砸价
    const price = this.stockPrice(s);              // 再按砸完的价成交
    const gain = Math.round(price * q * (1 - C.stockCommission));
    p.cash += gain;
    p.stocks[code] = have - q;
    if (!silent) this.log(`${p.name} 卖出 ${s.name} ${q} 股 @${price.toFixed(1)}（扣手续费），回收 ${money(gain)}`, 'trade');
    return { ok: true, gain, price, qty: q };
  }

  /* ---------------- 分红 ---------------- */
  triggerDividends(t, rent) {
    const D = CONFIG.dividend;
    const hits = [];
    /* ★ 地产 ↔ 股票联动加强：这块地所属地区**被垄断**时，它触发的地产类分红翻倍。
       原来的分红只看"哪个地区 + 租金够不够高"，跟"谁把它做成了垄断"毫无关系，
       所以买地和买股票是两条互不相干的线。现在垄断者能从对应股票上吃到额外分红，
       "垄断 + 持股"变成一条完整策略。 */
    const mono = (t.type === 'land' && t.owner >= 0 && t.group && this.ownsGroup(t.owner, t.group));
    const mult = mono && CONFIG.dividendMonopolyMult ? CONFIG.dividendMonopolyMult : 1;
    if (t.type === 'rail') hits.push(['005', D.rail]);
    else if (t.type === 'utility') hits.push(['004', D.utility]);
    else if (t.type === 'land') {
      hits.push(['001', Math.round(D.estate * mult)]);
      if (t.group === 'fontaine' && rent >= D.techTrigger) hits.push(['003', Math.round(D.tech * mult)]);
      if (t.group === 'liyue' && rent >= D.retailTrigger) hits.push(['006', Math.round(D.retail * mult)]);
    }
    for (const [code, per] of hits) {
      const s = this.stockByCode(code);
      if (!s || s.delisted) continue;
      let total = 0;
      for (const p of this.players) {
        const n = p.stocks[code] || 0;
        if (n > 0) { const amt = n * per; p.cash += amt; total += amt; }
      }
      if (total > 0) this.log(`【分红】${s.name} 每股派 ${per}，共派出 ${money(total)}`, 'dividend');
    }
    this.activity.rentCount++;
    this.activity.rentTotal += rent;
  }
  payBankDividend() {
    const D = CONFIG.dividend;
    const per = Math.min(D.bankCap, D.bankPerEvent * this.activity.rentCount);
    if (per <= 0) return;
    const s = this.stockByCode('002');
    let total = 0;
    for (const p of this.players) {
      const n = p.stocks['002'] || 0;
      if (n > 0) { const amt = n * per; p.cash += amt; total += amt; }
    }
    if (total > 0) this.log(`【派息】北国银行 按本季 ${this.activity.rentCount} 笔租金，每股派 ${per}，共 ${money(total)}`, 'dividend');
  }

  /* ---------------- 金融产品 ---------------- */
  optionOn(tileId) {
    for (const p of this.players) {
      if (p.alive && p.products.option && p.products.option.tileId === tileId) {
        return { holder: p.id, marks: p.products.option.marks };
      }
    }
    return null;
  }
  highRiskHeld(p) { return !!(p.products.junk || p.products.option); }
  cardState(p) {
    const C = CONFIG.cards;
    return {
      highRisk: this.highRiskHeld(p),
      junk: p.products.junk, option: p.products.option,
      insurance: p.products.insurance, deposit: p.products.deposit,
      costs: { venture: C.ventureCost, junk: C.junkCost, option: C.optionCost, insurance: C.insuranceCost, deposit: C.depositAmount },
    };
  }
  /** 风险投资卡：买完立刻掷 2 颗骰开奖 */
  buyVenture(p) {
    const C = CONFIG.cards;
    if (p.cash < C.ventureCost) return { ok: false, msg: '现金不足' };
    /* ★ 每回合限 1 张。原来只查现金、不限张数，实测一局被刷了 **304 张**、
       投入 ¥1,216,000（初始资金 + 人工注资的 3.6 倍），整局变成按老虎机。
       限制之后它回归"每回合一次的小赌"，也给交易阶段减负。 */
    const used = p.ventureThisTurn || 0;
    const cap = CONFIG.venturePerTurn === undefined ? 1 : CONFIG.venturePerTurn;
    if (used >= cap) return { ok: false, msg: `风险投资卡每回合最多买 ${cap} 张，本回合已经用完了` };
    p.ventureThisTurn = used + 1;
    p.cash -= C.ventureCost;
    p.productStats.venture++;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const total = d1 + d2;
    const row = C.ventureTable.filter(r => total >= r.min && total <= r.max)[0] || C.ventureTable[0];
    p.cash += row.pay;
    const delta = row.pay - C.ventureCost;
    this.log(`🎲 ${p.name} 买下风险投资卡，掷出 ${d1}+${d2}=${total}：${row.text}（${delta >= 0 ? '+' : ''}${money(delta)}）`,
      delta >= 0 ? 'good' : 'bad');
    return { ok: true, dice: [d1, d2], total, pay: row.pay, text: row.text, delta };
  }
  buyJunkBond(p) {
    const C = CONFIG.cards;
    if (this.highRiskHeld(p)) return { ok: false, msg: '高风险产品总共只能持有一张' };
    if (p.cash < C.junkCost) return { ok: false, msg: '现金不足' };
    p.cash -= C.junkCost;
    p.products.junk = { laps: 0 };
    p.productStats.junk++;
    this.log(`${p.name} 买入垃圾债券：每圈额外领 ${money(C.junkPayment)}，但每圈有 1/6 概率爆雷作废`, 'trade');
    return { ok: true };
  }
  buyOption(tileId, p) {
    const C = CONFIG.cards;
    const t = this.tile(tileId);
    if (!t || t.type !== 'land') return { ok: false, msg: '只能锁定地产地块' };
    if (t.owner >= 0) return { ok: false, msg: '这块地已经名花有主' };
    if (this.highRiskHeld(p)) return { ok: false, msg: '高风险产品总共只能持有一张' };
    if (this.optionOn(tileId)) return { ok: false, msg: '这块地已经被人锁定了' };
    if (p.cash < C.optionCost) return { ok: false, msg: '现金不足' };
    p.cash -= C.optionCost;
    p.products.option = { tileId, marks: C.optionMarks };
    p.productStats.option++;
    this.log(`${p.name} 花 ${money(C.optionCost)} 锁定 ${t.name}：${C.optionMarks} 圈内自己踩到半价买、别人踩到要多付 ${money(C.optionFee)} 给你`, 'trade');
    return { ok: true };
  }
  buyInsurance(p) {
    const C = CONFIG.cards;
    if (p.products.insurance) return { ok: false, msg: '已经有一张租金保险了' };
    if (p.cash < C.insuranceCost) return { ok: false, msg: '现金不足' };
    p.cash -= C.insuranceCost;
    p.products.insurance = { paid: 0 };
    p.productStats.insurance++;
    this.log(`${p.name} 买下租金保险：下次付租金只付 ${Math.round(C.insuranceSelfRate * 100)}%，其余由银行补给房东（单次上限 ${money(C.insuranceBankCap)}）`, 'trade');
    return { ok: true };
  }
  buyDeposit(p) {
    const C = CONFIG.cards;
    if (p.products.deposit) return { ok: false, msg: '已经有一张定期存单了' };
    if (p.cash < C.depositAmount) return { ok: false, msg: '现金不足' };
    p.cash -= C.depositAmount;
    p.products.deposit = { amount: C.depositAmount, marks: C.depositMarks };
    p.productStats.deposit++;
    this.log(`${p.name} 存入 ${money(C.depositAmount)} 的 ${C.depositMarks} 圈定期存单，到期拿回 ${money(Math.round(C.depositAmount * C.depositRate))}`, 'trade');
    return { ok: true };
  }
  redeemDeposit(p) {
    const C = CONFIG.cards;
    const d = p.products.deposit;
    if (!d) return { ok: false, msg: '没有定期存单' };
    const back = Math.max(0, d.amount - C.depositPenalty);
    p.cash += back;
    p.products.deposit = null;
    this.log(`${p.name} 提前赎回定期存单，只拿回 ${money(back)}（净亏 ${money(d.amount - back)}）`, 'warn');
    return { ok: true, back };
  }
  /** 经过起点时结算按圈计息的产品 */
  onPassGo(p) {
    const C = CONFIG.cards;
    let extra = 0;
    if (p.products.junk) {
      const d = 1 + Math.floor(Math.random() * 6);
      if (d <= C.junkTrapFaces) {
        p.products.junk = null;
        this.log(`💥 ${p.name} 的垃圾债券爆雷作废了！（掷出 ${d}）`, 'bad');
      } else {
        p.cash += C.junkPayment;
        extra += C.junkPayment;
        p.products.junk.laps++;
        this.log(`垃圾债券派息 +${money(C.junkPayment)}（已领 ${p.products.junk.laps} 圈）`, 'dividend');
      }
    }
    if (p.products.deposit) {
      p.products.deposit.marks--;
      if (p.products.deposit.marks <= 0) {
        const pay = Math.round(p.products.deposit.amount * C.depositRate);
        p.cash += pay;
        extra += pay;
        this.log(`💰 ${p.name} 的定期存单到期，拿回 ${money(pay)}`, 'good');
        p.products.deposit = null;
      }
    }
    if (p.products.option) {
      p.products.option.marks--;
      if (p.products.option.marks <= 0) {
        const t = this.tile(p.products.option.tileId);
        p.products.option = null;
        this.log(`⌛ ${p.name} 对 ${t ? t.name : '?'} 的地产期权到期作废`, 'warn');
      }
    }
    return extra;
  }

  /* ---------------- 金钱与破产 ---------------- */
  gain(p, amount) { p.cash += Math.round(amount); }
  charge(p, amount, creditor) {
    amount = Math.round(amount);
    if (amount <= 0) return 0;
    if (p.cash < amount) this.forceRaise(p, amount);
    const paid = Math.min(p.cash, amount);
    p.cash -= paid;
    if (typeof creditor === 'number' && this.players[creditor]) this.players[creditor].cash += paid;
    if (paid < amount) this.declareBankrupt(p, creditor, amount - paid);
    return paid;
  }
  forceRaise(p, need) {
    let guard = 0;
    while (p.cash < need && guard++ < 300) {
      const codes = Object.keys(p.stocks).filter(c => (p.stocks[c] || 0) > 0 && !this.stockByCode(c).delisted);
      if (codes.length) {
        codes.sort((a, b) => (p.stocks[b] || 0) - (p.stocks[a] || 0));
        this.sellStock(codes[0], p.stocks[codes[0]], p, true);
        this.log(`${p.name} 被迫卖出 ${this.stockByCode(codes[0]).name} 筹钱`, 'warn');
        continue;
      }
      const m = this.tiles.filter(t => t.owner === p.id && !t.mortgaged);
      if (m.length) {
        m.sort((a, b) => this.assetValue(b) - this.assetValue(a));
        this.mortgage(m[0].id, p, true);
        this.log(`${p.name} 被迫抵押 ${m[0].name} 筹钱`, 'warn');
        continue;
      }
      if (p.products && p.products.deposit) {
        this.redeemDeposit(p);
        this.log(`${p.name} 被迫提前赎回定期存单筹钱`, 'warn');
        continue;
      }
      break;
    }
    return p.cash >= need;
  }
  declareBankrupt(p, creditor, shortfall) {
    p.alive = false;
    this.activity.bankrupt++;
    const toPlayer = typeof creditor === 'number' && this.players[creditor] && this.players[creditor].alive;
    /* ★ 破产地产拍卖（CONFIG.auction.enabled）：
       开拍时**先不动地产**，把它们留在出局者名下、挂一个待拍卖标记，
       由 server / 调参器收完报价再调 auctionEstate 结算。
       为什么要这样：原来的两种处理（整包白送债权人 / 凭空回归银行）**都没有价格发现**——
       白送会让领先者滚雪球，回归银行则直接从对局里抽走资产（通缩）。
       拍卖让"最想要这块地的人"（通常是想凑垄断的人）出价拿走它。 */
    if (CONFIG.auction && CONFIG.auction.enabled) {
      const lots = this.tiles.filter(t => t.owner === p.id);
      if (lots.length) {
        this.pendingAuction = { deadId: p.id, deadName: p.name, creditor: toPlayer ? creditor : -1, q: this.quarter };
        this.log(`🔨 ${p.name} 的 ${lots.length} 块地产进入拍卖（一轮密封报价）`, 'warn');
        this._bankruptFallback = null;
        return;
      }
    }
    for (const t of this.tiles) {
      if (t.owner !== p.id) continue;
      if (toPlayer) { t.owner = creditor; t.mortgaged = false; t.loan = 0; }
      else { t.owner = -1; t.level = 0; t.mortgaged = false; t.loan = 0; }
    }
    p.stocks = {};
    p.cash = 0;
    this.log(`💀 ${p.name} 资不抵债，破产出局（欠 ${money(shortfall)}）`, 'bad');
  }

  /* ---------------- 破产地产拍卖 ----------------
     一轮**密封报价**：每个存活玩家对每块地各出一个价，同时揭晓，最高者得。
     为什么不用公开加价：多人同时加价要协调回合，网络延迟下必然乱；
     密封报价一轮定胜负，实现简单、也逼玩家一开始就报真实底价（类似次价拍卖的直觉）。

     bids = { 座位号: { 地块id: 出价 } }

     规则：
       · 只有**现金够付**的报价才算数（不能卖地筹钱 —— 否则有钱人随手清场）
       · 低于 minBid 的报价视为弃权
       · 无人出价的地回归银行（和原逻辑一致）
       · 成交款给债权人；没有债权人则收归银行 */
  auctionEstate(bids) {
    const pa = this.pendingAuction;
    if (!pa) return { ok: false, msg: '当前没有待拍卖的资产' };
    const A = (CONFIG.auction && CONFIG.auction.minBid) || 100;
    const lots = this.tiles.filter(t => t.owner === pa.deadId);
    const alive = this.players.filter(p => p.alive && p.id !== pa.deadId);

    /* ★ 把所有有效报价摊平，**按价格从高到低依次结算，边结算边扣现金**。
       这样一个人即使对 8 块地都出了价，也不会把钱花超 ——
       早先的写法是"每块地各自判断现金够不够"，但一起结算就会透支；
       而把预算按地块数平摊又会把单价压到地板价（实测 8 块地只卖 ¥4,000）。
       排序结算两个问题都解决：高价地先被拿走，剩下的钱自然只能买剩下的地。 */
    const offers = [];
    for (const t of lots) {
      for (const p of alive) {
        const raw = bids && bids[p.id] ? bids[p.id][t.id] : 0;
        const price = Math.max(0, Math.round(raw || 0));
        if (price >= A) offers.push({ tileId: t.id, seat: p.id, price });
      }
    }
    offers.sort((a, b) => b.price - a.price || a.tileId - b.tileId);

    const taken = {};                                  // 每块地被谁买走
    for (const o of offers) {
      if (taken[o.tileId] !== undefined) continue;      // 已被更高价拿走
      const p = this.players[o.seat];
      if (p.cash < o.price) continue;                   // 现金不够（前面的地块已经花掉了）
      p.cash -= o.price;
      taken[o.tileId] = o;
    }

    const detail = [];
    let total = 0, sold = 0;
    for (const t of lots) {
      const win = taken[t.id];
      t.mortgaged = false; t.loan = 0; t.marginCall = false;
      if (win) {
        t.owner = win.seat;
        total += win.price; sold++;
        detail.push({ tileId: t.id, name: t.name, to: win.seat, price: win.price });
        this.log(`🔨 ${t.name} 被 ${this.players[win.seat].name} 以 ${money(win.price)} 拍得`, 'trade');
      } else {
        t.owner = -1; t.level = 0;
        detail.push({ tileId: t.id, name: t.name, to: -1, price: 0 });
        this.log(`🔨 ${t.name} 无人出价，回归银行`, 'info');
      }
    }
    /* 成交款归属：优先还债权人（相当于破产清偿），没有就收归银行 */
    if (total > 0) {
      const cred = this.players[pa.creditor];
      if (pa.creditor >= 0 && cred && cred.alive) {
        cred.cash += total;
        this.log(`🔨 拍卖共得 ${money(total)}，作为清偿付给 ${cred.name}`, 'good');
      } else {
        this.log(`🔨 拍卖共得 ${money(total)}（无债权人，收归银行）`, 'info');
      }
    }
    this.activity.auctionSold = (this.activity.auctionSold || 0) + sold;
    this.activity.auctionTotal = (this.activity.auctionTotal || 0) + total;
    this.pendingAuction = null;
    return { ok: true, sold, total, lots: lots.length, detail };
  }
  /** 没有报价（或拍卖没开）时的兜底：按老规矩把地交出去 */
  resolveAuctionFallback() {
    const pa = this.pendingAuction;
    if (!pa) return { ok: false };
    const toPlayer = pa.creditor >= 0 && this.players[pa.creditor] && this.players[pa.creditor].alive;
    for (const t of this.tiles) {
      if (t.owner !== pa.deadId) continue;
      if (toPlayer) { t.owner = pa.creditor; t.mortgaged = false; t.loan = 0; }
      else { t.owner = -1; t.level = 0; t.mortgaged = false; t.loan = 0; }
      t.marginCall = false;
    }
    this.pendingAuction = null;
    return { ok: true, fallback: true };
  }

  /* ---------------- 玩家间交易 ----------------
     报价语义：from 拿出 give 里的东西，换 to 的 want 里的东西。
       give/want = { cash: 数字, tiles: [地块id], stocks: {代码:股数},
                     rentShares: [{tileId, pct}] }
     `rentShares` = 把某块地的"地租分红权"卖出去：成交后，那块地每次收租，
     约定比例会从房东手里划给持有人。这是"投资别人的地"的通道。 */
  /** 校验一方能否拿出 give 里的东西。返回 null 表示通过，否则返回原因。 */
  _canGive(seat, side) {
    const p = this.players[seat];
    if (!p || !p.alive) return '玩家已出局';
    if (!side) return null;
    if ((side.cash || 0) < 0) return '金额不能为负';
    if (side.cash && p.cash < side.cash) return `${p.name} 现金不足（需要 ${side.cash}，只有 ${Math.round(p.cash)}）`;
    for (const id of (side.tiles || [])) {
      const t = this.tile(id);
      if (!t) return '地块不存在';
      if (t.owner !== seat) return `${t.name} 不是 ${p.name} 的`;
      if (t.mortgaged) return `${t.name} 正在抵押中，不能交易（先赎回）`;
    }
    for (const code in (side.stocks || {})) {
      const n = side.stocks[code] | 0;
      if (n <= 0) continue;
      if ((p.stocks[code] || 0) < n) return `${p.name} 的 ${code} 持股不足（要 ${n}，只有 ${p.stocks[code] || 0}）`;
    }
    for (const rs of (side.rentShares || [])) {
      const t = this.tile(rs.tileId);
      if (!t || t.owner !== seat) return '分红权只能由地主本人出售';
      if (t.rentShare) return `${t.name} 的分红权已经卖过了`;
      const pct = rs.pct | 0;
      if (pct < CONFIG.trade.minRentSharePct || pct > CONFIG.trade.maxRentSharePct) {
        return `分红比例要在 ${CONFIG.trade.minRentSharePct}%~${CONFIG.trade.maxRentSharePct}% 之间`;
      }
    }
    return null;
  }
  /** 报价里"有东西"才算有效，避免空报价骚扰 */
  _sideEmpty(side) {
    if (!side) return true;
    if ((side.cash || 0) > 0) return false;
    if ((side.tiles || []).length) return false;
    for (const c in (side.stocks || {})) if ((side.stocks[c] | 0) > 0) return false;
    if ((side.rentShares || []).length) return false;
    return true;
  }
  proposeTrade(from, to, give, want) {
    if (!CONFIG.trade.enabled) return { ok: false, msg: '本局关闭了玩家间交易' };
    const a = this.players[from], b = this.players[to];
    if (!a || !b || !a.alive || !b.alive) return { ok: false, msg: '玩家无效' };
    if (from === to) return { ok: false, msg: '不能和自己交易' };
    if (this.trade && this.trade.status === 'pending') return { ok: false, msg: '已经有一笔待回应的报价了，先等对方回应或撤回' };
    if (this._sideEmpty(give) && this._sideEmpty(want)) return { ok: false, msg: '报价两边都是空的' };
    let bad = this._canGive(from, give); if (bad) return { ok: false, msg: bad };
    bad = this._canGive(to, want); if (bad) return { ok: false, msg: bad };
    this.trade = {
      from, to,
      give: this._normSide(give), want: this._normSide(want),
      status: 'pending', q: this.quarter,
    };
    this.log(`🤝 ${a.name} 向 ${b.name} 报价：${this._sideText(give)} ↔ ${this._sideText(want)}`, 'trade');
    return { ok: true, trade: this.trade };
  }
  _normSide(s) {
    s = s || {};
    const stocks = {};
    for (const c in (s.stocks || {})) if ((s.stocks[c] | 0) > 0) stocks[c] = s.stocks[c] | 0;
    return {
      cash: Math.max(0, Math.round(s.cash || 0)),
      tiles: (s.tiles || []).slice(),
      stocks,
      rentShares: (s.rentShares || []).map(r => ({ tileId: r.tileId, pct: r.pct | 0 })),
    };
  }
  _sideText(s) {
    s = this._normSide(s);
    const bits = [];
    if (s.cash) bits.push(money(s.cash));
    if (s.tiles.length) bits.push(s.tiles.map(id => this.tile(id).name).join('+'));
    for (const c in s.stocks) bits.push(`${c}×${s.stocks[c]}`);
    for (const r of s.rentShares) bits.push(`${this.tile(r.tileId).name} ${r.pct}% 分红权`);
    return bits.length ? bits.join(' + ') : '（什么也不给）';
  }
  /** 把一方的资产真正交出去。★ 注意：现金和股票必须**同时给对手加上** ——
   *  早期版本只做了扣减，结果每笔交易都把现金和股票凭空销毁（端到端测试抓到的）。 */
  _transfer(seat, side) {
    const p = this.players[seat];
    const q = this.players[this._theOther(seat)];
    if (side.cash) { p.cash -= side.cash; q.cash += side.cash; }
    for (const id of side.tiles) {
      const t = this.tile(id);
      t.owner = this._theOther(seat);
      t.marginCall = false;
    }
    for (const code in side.stocks) {
      const n = side.stocks[code];
      p.stocks[code] = (p.stocks[code] || 0) - n;
      q.stocks[code] = (q.stocks[code] || 0) + n;
    }
    for (const rs of side.rentShares) {
      const t = this.tile(rs.tileId);
      t.rentShare = { to: this._theOther(seat), pct: rs.pct };
    }
  }
  _theOther(seat) { return this.trade.from === seat ? this.trade.to : this.trade.from; }
  respondTrade(seat, accept) {
    const tr = this.trade;
    if (!tr || tr.status !== 'pending') return { ok: false, msg: '没有待回应的报价' };
    if (seat !== tr.to) return { ok: false, msg: '这笔报价不是给你的' };
    const a = this.players[tr.from], b = this.players[tr.to];
    if (!accept) {
      tr.status = 'rejected';
      this.log(`🤝 ${b.name} 拒绝了 ${a.name} 的报价`, 'info');
      this.trade = null;
      return { ok: true, accepted: false };
    }
    /* 成交前重新校验一次：报价期间对方可能已经把地抵押/把股票卖了 */
    let bad = this._canGive(tr.from, tr.give); if (bad) return { ok: false, msg: '对方已经变卦：' + bad };
    bad = this._canGive(tr.to, tr.want); if (bad) return { ok: false, msg: bad };
    this._transfer(tr.from, tr.give);
    this._transfer(tr.to, tr.want);
    const sum = `${a.name} 给出 ${this._sideText(tr.give)}，${b.name} 给出 ${this._sideText(tr.want)}`;
    this.log(`🤝 成交！${sum}`, 'trade');
    this.activity.trade = (this.activity.trade || 0) + 1;
    this.trade = null;
    return { ok: true, accepted: true };
  }
  cancelTrade(seat) {
    const tr = this.trade;
    if (!tr || tr.status !== 'pending') return { ok: false, msg: '没有待回应的报价' };
    if (seat !== tr.from && seat !== tr.to) return { ok: false, msg: '这笔报价和你无关' };
    this.log(`🤝 ${this.players[seat].name} 撤回了报价`, 'info');
    this.trade = null;
    return { ok: true };
  }
  /** 分红权持有人（活着才算），没有就返回 -1 */
  rentShareHolder(t) {
    const rs = t && t.rentShare;
    if (!rs || !(rs.pct > 0)) return -1;
    if (rs.to === t.owner) return -1;
    const h = this.players[rs.to];
    return (h && h.alive) ? rs.to : -1;
  }

  /* ---------------- 回合流程 ---------------- */
  beginTurn() {
    this.pending = null;
    const p = this.cur();
    if (!p || !p.alive) { this.advanceTurn(); return; }
    if (p.jailTurns > 0) this.phase = 'awaiting-jail';
    else this.phase = 'awaiting-roll';
  }
  payJail(fine) {
    const p = this.cur();
    const amount = fine == null ? CONFIG.jailFine : fine;
    if (p.cash < amount) return { ok: false, msg: '现金不足，只能继续蹲着' };
    p.cash -= amount;
    p.jailTurns = 0;
    this.phase = 'awaiting-roll';
    this.log(`${p.name} 缴纳保释金 ${money(amount)} 离开梅洛彼得堡`, 'warn');
    return { ok: true };
  }
  stayInJail() {
    const p = this.cur();
    p.jailTurns = Math.max(0, p.jailTurns - 1);
    this.log(`${p.name} 放弃保释，本回合留在梅洛彼得堡（${p.jailTurns > 0 ? '下回合继续' : '下回合恢复行动'}）`, 'warn');
    this.endTurn();
    return { ok: true };
  }
  sendToJail(p) {
    p.pos = 10;
    p.jailTurns = CONFIG.jailSkipTurns;
    this.log(`${p.name} 被通缉，关进梅洛彼得堡，停留 ${p.jailTurns} 回合`, 'bad');
  }

  rollDice() {
    /* ★ 骰子模式（CONFIG.diceMode）：
       '2d6' = 经典钟形，2~12，**6/7/8 占 44.4%**，2 和 12 各只占 2.8%；
       'd12' = 等概率 1~12，每点 8.33%。
       实测反馈（群聊）：2d6 下"都一直走 678，导致有些格子几乎走不到，
       上一局玩了两小时还有不少地没买"。d12 让格子覆盖均匀得多。
       注意：`doubles` 只用于界面显示，没有玩法效果，所以 d12 不需要它。 */
    const mode = CONFIG.diceMode === '2d6' ? '2d6' : 'd12';
    let dice, total, doubles;
    if (mode === '2d6') {
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      dice = [d1, d2]; total = d1 + d2; doubles = d1 === d2;
    } else {
      const d = 1 + Math.floor(Math.random() * 12);
      dice = [d]; total = d; doubles = false;
    }
    this.dice = dice;
    this.lastPips = total;
    const p = this.cur();
    p.lastRoll = dice.slice();
    return { dice: dice.slice(), total, doubles, mode };
  }
  movePlayer(p, steps) {
    const from = p.pos;
    const path = [];
    for (let k = 1; k <= steps; k++) path.push((from + k) % 40);
    const passedGo = from + steps >= 40;
    p.pos = (from + steps) % 40;
    if (passedGo) {
      this.gain(p, CONFIG.salary);
      this.log(`${p.name} 经过冒险家协会，领取委托报酬 ${money(CONFIG.salary)}`, 'good');
      this.onPassGo(p);          // 垃圾债券派息 / 存单计息 / 期权标记
    }
    return { path, passedGo, from, to: p.pos };
  }

  /** 落地结算；返回本次落地的说明，必要时设置 pending 交给 UI 决策 */
  resolveLanding(pips) {
    const p = this.cur();
    const t = this.tile(p.pos);
    this.pending = null;
    let result = { tile: t, kind: 'none' };

    switch (t.type) {
      case 'go':
        this.gain(p, CONFIG.salary);
        this.log(`${p.name} 正好停在冒险家协会，额外领取 ${money(CONFIG.salary)}`, 'good');
        result = { tile: t, kind: 'go' };
        break;

      case 'land': case 'rail': case 'utility': {
        if (t.owner === -1) {
          const opt = this.optionOn(t.id);
          let price = this.landPrice(t);
          let optionFee = 0, halfPrice = false;
          if (opt && opt.holder === p.id) {
            halfPrice = true;
            price = Math.round(price * CONFIG.cards.optionDiscount / 100) * 100;
            this.log(`${p.name} 踩中自己锁定的 ${t.name}，可以半价 ${money(price)} 买下`, 'good');
          } else if (opt) {
            optionFee = CONFIG.cards.optionFee;
            this.log(`${t.name} 被 ${this.players[opt.holder].name} 的期权锁定，买下要多付 ${money(optionFee)}`, 'warn');
          } else {
            this.log(`${p.name} 停在无主的 ${t.name}，售价 ${money(price)}`, 'info');
          }
          this.pending = { type: 'buy', tileId: t.id, price, optionHolder: opt ? opt.holder : -1, optionFee, halfPrice };
          result = { tile: t, kind: 'buy', price, optionFee, halfPrice };
        } else if (t.owner === p.id) {
          const canUp = t.type === 'land' && t.level < 5 && !t.mortgaged;
          const cost = canUp ? this.upgradeCost(t) : 0;
          if (canUp) this.log(`${p.name} 回到自己的 ${t.name}，可以花 ${money(cost)} 升级`, 'info');
          else this.log(`${p.name} 回到自己的 ${t.name}`, 'info');
          result = { tile: t, kind: 'self', canUpgrade: canUp, cost };
        } else if (t.mortgaged) {
          this.log(`${t.name} 正在抵押中，免租通过`, 'info');
          result = { tile: t, kind: 'mortgaged' };
        } else {
          const owner = this.players[t.owner];
          const rent = this.rentOf(t, pips);
          const group = t.type === 'land' && this.ownsGroup(t.owner, t.group);
          this.log(`${p.name} 停在 ${owner.name} 的 ${t.name}，需付租金 ${money(rent)}${group ? '（垄断加成 ×1.5）' : ''}`, 'warn');
          let bankPaid = 0;
          if (rent > 0 && p.products.insurance) {
            const self = Math.round(rent * CONFIG.cards.insuranceSelfRate);
            bankPaid = Math.min(rent - self, CONFIG.cards.insuranceBankCap);
            p.products.insurance = null;
            this.log(`🛡 ${p.name} 的租金保险生效：自己只付 ${money(rent - bankPaid)}，银行赔 ${money(bankPaid)} 给房东`, 'good');
          }
          this.charge(p, rent - bankPaid, t.owner);
          if (bankPaid > 0 && owner.alive) owner.cash += bankPaid;
          /* ★ 地租分红权：按约定比例，从房东**实收**的租金里划一部分给持有人。
             刻意放在 charge 之后做，完全不碰 charge/破产/强制变卖那条路径 —— 最安全。
             房东现金不足时按实际有的给（不会出现负现金）。 */
          const shareTo = this.rentShareHolder(t);
          if (shareTo >= 0) {
            const holder = this.players[shareTo];
            const pool = Math.max(0, rent - bankPaid);
            const cut = Math.min(Math.round(pool * t.rentShare.pct / 100), Math.max(0, Math.floor(owner.cash)));
            if (cut > 0) {
              owner.cash -= cut;
              holder.cash += cut;
              this.log(`📜 ${t.name} 的地租分红：${holder.name} 分得 ${money(cut)}（${t.rentShare.pct}%），${owner.name} 留下 ${money(pool - cut)}`, 'dividend');
            } else {
              this.log(`📜 ${t.name} 的地租分红：房东现金不足，${holder.name} 这次没分到`, 'warn');
            }
          }
          this.triggerDividends(t, rent);
          result = { tile: t, kind: 'rent', rent, owner: owner.name, bankPaid };
        }
        break;
      }

      case 'tax': {
        let tax;
        if (t.id === 4) tax = Math.min(CONFIG.incomeTaxCap, Math.round(p.cash * CONFIG.incomeTaxRate));
        else tax = CONFIG.luxuryTax;
        this.log(`${p.name} 缴纳${t.name} ${money(tax)}`, 'warn');
        this.charge(p, tax, 'bank');
        result = { tile: t, kind: 'tax', tax };
        break;
      }

      case 'chance': case 'fate': {
        const ev = this.drawEvent(t.type);
        this.pending = { type: 'event', event: ev, cardType: t.type };
        this.log(`${p.name} 抽到「${ev.title}」：${ev.text}`, t.type === 'chance' ? 'good' : 'warn');
        result = { tile: t, kind: 'event', event: ev };
        break;
      }

      case 'gotojail':
        this.sendToJail(p);
        result = { tile: t, kind: 'jail' };
        break;

      case 'jail':
        this.log(`${p.name} 只是来探监，什么也没发生`, 'info');
        result = { tile: t, kind: 'visit' };
        break;

      case 'parking':
        this.log(`${p.name} 在免费停车场歇了一回合`, 'info');
        result = { tile: t, kind: 'parking' };
        break;
    }

    if (this.over) return result;
    if (this.pending && this.pending.type === 'buy') this.phase = 'awaiting-buy';
    else if (this.pending && this.pending.type === 'event') this.phase = 'awaiting-event';
    else this.phase = 'awaiting-trade';
    return result;
  }

  drawEvent(cardType) {
    const bias = cardType === 'chance' ? CHANCE_BIAS : FATE_BIAS;
    const pool = EVENTS.filter(e => bias.includes(e.title));
    const full = Math.random() < 0.8 ? pool : EVENTS;
    let total = 0;
    for (const e of full) total += e.weight;
    let r = Math.random() * total;
    for (const e of full) { r -= e.weight; if (r <= 0) return e; }
    return full[0];
  }

  applyEvent(ev, p) { this.applyEffect(ev.effect, p); }
  applyEffect(effect, p) {
    if (!effect) return;
    switch (effect.type) {
      case 'rei':
        this.adjustRei(effect.delta);
        this.log(`地产指数 ${effect.delta > 0 ? '+' : ''}${effect.delta} → ${this.rei.toFixed(1)}`, effect.delta > 0 ? 'good' : 'warn');
        break;
      case 'stockAll':
        for (const s of this.stocks) if (!s.delisted && s.kind !== 'rei') s.price = Math.max(1, s.price * (1 + effect.pct));
        this.log(`全部股票 ${effect.pct > 0 ? '+' : ''}${(effect.pct * 100).toFixed(0)}%`, effect.pct > 0 ? 'good' : 'warn');
        break;
      case 'stockSector': {
        const s = this.stocks.find(x => x.sector === effect.sector && x.kind !== 'rei');
        if (s && !s.delisted) {
          s.price = Math.max(1, s.price * (1 + effect.pct));
          this.log(`${s.name} ${effect.pct > 0 ? '+' : ''}${(effect.pct * 100).toFixed(0)}% → ${this.stockPrice(s).toFixed(1)}`, effect.pct > 0 ? 'good' : 'warn');
        }
        break;
      }
      case 'stockRandomSector': {
        const pool = this.stocks.filter(x => x.kind !== 'rei' && !x.delisted);
        if (pool.length) {
          const s = pool[Math.floor(Math.random() * pool.length)];
          s.price = Math.max(1, s.price * (1 + effect.pct));
          this.log(`${s.name} 因违规被查，${(effect.pct * 100).toFixed(0)}%`, 'bad');
        }
        break;
      }
      case 'cash':
        if (effect.amount >= 0) { this.gain(p, effect.amount); this.log(`${p.name} 获得 ${money(effect.amount)}`, 'good'); }
        else { this.charge(p, -effect.amount, 'bank'); this.log(`${p.name} 支出 ${money(-effect.amount)}`, 'warn'); }
        break;
      case 'cashPct': {
        const amt = Math.round(p.cash * Math.abs(effect.pct));
        this.charge(p, amt, 'bank');
        this.log(`${p.name} 按现金 ${(Math.abs(effect.pct) * 100).toFixed(0)}% 缴纳 ${money(amt)}`, 'warn');
        break;
      }
      case 'perLand': {
        const n = this.ownedTiles(p.id).length;
        const amt = n * Math.abs(effect.cash);
        if (effect.cash >= 0) { this.gain(p, amt); this.log(`${p.name} 名下 ${n} 处地产，获得 ${money(amt)}`, 'good'); }
        else { this.charge(p, amt, 'bank'); this.log(`${p.name} 名下 ${n} 处地产，支出 ${money(amt)}`, 'warn'); }
        break;
      }
      case 'perLevel': {
        let lv = 0;
        for (const t of this.tiles) if (t.owner === p.id && t.type === 'land') lv += t.level;
        const amt = lv * Math.abs(effect.cash);
        if (effect.cash >= 0) this.gain(p, amt);
        else this.charge(p, amt, 'bank');
        this.log(`${p.name} 名下房产共 ${lv} 级，${effect.cash >= 0 ? '获得' : '支出'} ${money(amt)}`, effect.cash >= 0 ? 'good' : 'warn');
        break;
      }
      case 'jail':
        this.sendToJail(p);
        break;
      case 'combo':
        for (const e of effect.list) this.applyEffect(e, p);
        break;
    }
  }

  clearPending() {
    this.pending = null;
    if (!this.over) this.phase = 'awaiting-trade';
  }

  /* ---------------- 交易动作 ---------------- */
  buyLand(tileId, p) {
    p = p || this.cur();
    const t = this.tile(tileId);
    if (!t || t.owner !== -1) return { ok: false, msg: '这块地已经被买走了' };
    const C = CONFIG.cards;
    const opt = this.optionOn(tileId);
    let price = this.landPrice(t);
    let fee = 0;
    if (opt && opt.holder === p.id) price = Math.round(price * C.optionDiscount / 100) * 100;
    else if (opt) fee = C.optionFee;
    const total = price + fee;
    if (p.cash < total) return { ok: false, msg: '现金不足' };
    p.cash -= total;
    if (fee > 0 && opt) {
      this.players[opt.holder].cash += fee;
      this.log(`${p.name} 额外支付 ${money(fee)} 期权费给 ${this.players[opt.holder].name}`, 'warn');
    }
    if (opt) this.players[opt.holder].products.option = null;   // 地被买走，期权作废
    t.owner = p.id;
    t.level = t.type === 'land' ? 1 : 0;
    t.mortgaged = false;
    t.loan = 0;
    this.activity.buyLand++;
    this.log(`${p.name} 以 ${money(price)} 买下 ${t.name}${opt && opt.holder === p.id ? '（期权半价）' : ''}`, 'good');
    return { ok: true, price, fee };
  }
  upgrade(tileId, p) {
    p = p || this.cur();
    const t = this.tile(tileId);
    if (!t || t.owner !== p.id) return { ok: false, msg: '不是你的地块' };
    if (t.type !== 'land') return { ok: false, msg: '只有地产可以盖楼' };
    if (t.level >= 5) return { ok: false, msg: '已经是最高等级' };
    if (t.mortgaged) return { ok: false, msg: '抵押中的地块不能升级' };
    /* ★ 每回合限盖 CONFIG.upgradesPerTurn 次（默认 1）。
       原来没有限制：有钱就能把一块地一口气顶到 5 级，等于瞬间造出一个"踩到就死"的格子
       （群聊反馈："不能一次性堆叠"）。注意**远程盖楼是允许的** —— 不站在那块地上也能盖，
       这条只限次数，不限位置。 */
    const usedU = p.upgradesThisTurn || 0;
    const capU = CONFIG.upgradesPerTurn === undefined ? 99 : CONFIG.upgradesPerTurn;
    if (usedU >= capU) return { ok: false, msg: `每回合最多盖 ${capU} 次楼，本回合已经用完了` };
    const cost = this.upgradeCost(t);
    if (p.cash < cost) return { ok: false, msg: '现金不足' };
    p.upgradesThisTurn = usedU + 1;
    p.cash -= cost;
    t.level++;
    this.activity.upgrade++;
    this.log(`${p.name} 把 ${t.name} 升级为「${CONFIG.levels[t.level]}」，花费 ${money(cost)}`, 'good');
    return { ok: true, cost, level: t.level };
  }
  mortgage(tileId, p, silent) {
    p = p || this.cur();
    const t = this.tile(tileId);
    if (!t || t.owner !== p.id) return { ok: false, msg: '不是你的地块' };
    if (t.mortgaged) return { ok: false, msg: '已经抵押过了' };
    const loan = floor100(this.assetValue(t) * CONFIG.mortgageLtv);
    t.mortgaged = true;
    t.loan = loan;
    p.cash += loan;
    this.activity.mortgage++;
    if (!silent) this.log(`${p.name} 抵押 ${t.name}，贷出 ${money(loan)}（赎回需 ${money(Math.round(loan * 1.1))}）`, 'warn');
    return { ok: true, loan };
  }
  redeem(tileId, p) {
    p = p || this.cur();
    const t = this.tile(tileId);
    if (!t || t.owner !== p.id) return { ok: false, msg: '不是你的地块' };
    if (!t.mortgaged) return { ok: false, msg: '没有抵押' };
    const cost = Math.round(t.loan * (1 + CONFIG.mortgageInterest));
    if (p.cash < cost) return { ok: false, msg: `赎回需要 ${money(cost)}，现金不足` };
    p.cash -= cost;
    t.mortgaged = false;
    t.loan = 0;
    t.marginCall = false;
    this.activity.redeem++;
    this.log(`${p.name} 赎回 ${t.name}，支付 ${money(cost)}`, 'good');
    return { ok: true, cost };
  }
  /** 主动把地卖回给银行（比抵押更彻底，但会压低地产指数） */
  sellToBank(tileId, p) {
    p = p || this.cur();
    const t = this.tile(tileId);
    if (!t || t.owner !== p.id) return { ok: false, msg: '不是你的地块' };
    if (t.mortgaged) return { ok: false, msg: '抵押中的地块要先赎回才能卖' };
    const price = Math.round(this.assetValue(t) * CONFIG.sellToBankRate / 100) * 100;
    p.cash += price;
    const wasLevel = t.level;
    t.owner = -1; t.level = 0; t.mortgaged = false; t.loan = 0; t.marginCall = false;
    this.activity.sellLand = (this.activity.sellLand || 0) + 1;
    this.log(`${p.name} 把 ${wasLevel > 1 ? CONFIG.levels[wasLevel] + '级的 ' : ''}${t.name} 卖回银行，回收 ${money(price)}`, 'warn');
    return { ok: true, price };
  }

  /* ---------------- 回合推进 ---------------- */
  advanceTurn() {
    if (this.checkGameOver()) return;
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const cand = (this.current + k) % n;
      const c = this.players[cand];
      if (c.alive && !this.actedThisQuarter.includes(cand)) { this.current = cand; this.beginTurn(); return; }
    }
    // 本季度所有人都行动过了
    this.quarterEnd();
    if (this.over) return;
    this.actedThisQuarter = [];
    for (let k = 1; k <= n; k++) {
      const cand = (this.current + k) % n;
      if (this.players[cand].alive) { this.current = cand; this.beginTurn(); return; }
    }
  }
  /* ★ 本局的季度上限。**永远用这个**，别直接读 CONFIG.maxQuarters ——
     全局值是"上一次开局用的设置"，恢复存档或多房间并存时和本局不一致，
     踩过的坑：PGVS 那局上限 50，恢复存档后全局退回默认 35，于是 Q36 就被判结束了。 */
  totalQuarters() {
    const v = (this.config && this.config.maxQuarters) || CONFIG.maxQuarters || 50;
    return v > 0 ? v : 50;
  }
  endTurn() {
    if (this.over) return;
    const p = this.cur();
    if (p && p.alive) {
      this.enforceMarginCalls(p);
      this.actedThisQuarter.push(p.id);
      p.ventureThisTurn = 0;          // ★ 风险投资卡的"每回合限 1 张"在这里重置
      p.upgradesThisTurn = 0;         // ★ 盖楼的"每回合限 N 次"同样在这里重置
    }
    this.marketTick(false);
    this.adjustRei(rnd(-CONFIG.reiTurnNoise, CONFIG.reiTurnNoise));
    this.turnsTaken = (this.turnsTaken || 0) + 1;
    this.advanceTurn();
  }
  quarterEnd() {
    this.log(`════ 第 ${this.quarter} 季度结算 ════`, 'quarter');
    this.marketTick(true);
    this.payBankDividend();
    this.chargePropertyTax();
    this.updateRei();
    this.markMarginCalls();
    this.quarter++;
    if (this.quarter > this.totalQuarters()) this.checkGameOver(true);
  }
  checkGameOver(force) {
    if (this.over) return true;
    const alive = this.alivePlayers();
    if (!force && alive.length > 1) return false;
    this.over = true;
    this.phase = 'over';
    const rank = this.players.slice().sort((a, b) => this.netWorth(b) - this.netWorth(a));
    this.ranking = rank.map(p => ({
      name: p.name, color: p.color, alive: p.alive,
      cash: Math.round(p.cash), net: this.netWorth(p),
      lands: this.ownedTiles(p.id).length,
      stocks: Object.values(p.stocks).reduce((a, b) => a + b, 0),
    }));
    this.winner = rank[0];
    this.log(`🏁 游戏结束！${this.winner.name} 以净资产 ${money(this.netWorth(this.winner))} 胜出`, 'quarter');
    return true;
  }

  /* ---------------- 存读档 ---------------- */
  /** logLimit：只带最后 N 条日志。联机每次推送都要用它——
   *  否则 500 条日志会让每个状态包涨到 45KB，其中 33KB 是无用的历史。 */
  serialize(logLimit) {
    if (!logLimit || this.logs.length <= logLimit) return JSON.stringify(this);
    const o = Object.assign({}, this);
    o.logs = this.logs.slice(-logLimit);
    return JSON.stringify(o);
  }
  static deserialize(json) {
    const g = Object.create(Game.prototype);
    Object.assign(g, JSON.parse(json));
    return g;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Game, rnd, gauss, floor100, money };
