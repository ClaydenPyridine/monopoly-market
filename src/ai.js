/* ============================================================
 * 《地产股神》v0.2 — 电脑玩家
 * 会看周期：地价便宜时抢地盖楼，地价贵时收手、套现、还贷。
 * 会躲杠杆：被银行追缴时会先卖股票自救。
 * ============================================================ */

const AI = {
  /* ---------- 买不买这块无主地 ---------- */
  decideBuy(g, p) {
    const t = g.tile(g.pending.tileId);
    const price = g.pending.price;
    if (p.cash < price) return false;
    const after = p.cash - price;
    if (after < 1500) return false;              // 买完就揭不开锅，不买

    const fair = g.fairRei();
    const rel = fair > 0 ? g.rei / fair : 1;     // <1 便宜，>1 贵

    let score = 0.60;
    score += Math.min(0.25, (after - 1500) / CONFIG.startingCash * 0.5);
    if (t.type === 'land') {
      const prog = g.groupProgress(p.id, t.group);
      if (prog.have >= 1) score += 0.15;
      if (prog.have >= 1 && prog.have + 1 === prog.total) score += 0.20;
      if (t.group === 'nodkrai' || t.group === 'snezhnaya') score += 0.05;
    } else if (t.type === 'rail') {
      score += 0.10 * g.countType(p.id, 'rail');
    } else if (t.type === 'utility') {
      score += 0.06 * g.countType(p.id, 'utility');
    }
    score += (1 - rel) * 0.55;                   // ★ 周期择时：便宜就抄底，贵就缩手
    if (g.quarter > g.totalQuarters() * 0.7) score -= 0.12;   // 尾声少接盘
    return score > 0.5;
  },

  decideJail(g, p) {
    return p.cash > 8000;
  },

  /* ---------- 交易阶段要做什么 ---------- */
  planActions(g, p) {
    const acts = [];
    const fair = g.fairRei();
    const rel = fair > 0 ? g.rei / fair : 1;
    const cheap = rel < 0.94;         // 市场低估
    const hot = rel > 1.06;           // 市场过热
    /* ★ 托管档：p.managed = true 表示"这局是 AI 替一个不在场的人打"。
       目标不是赢，而是**别把人家打崩**——人回来了还要接着玩。
       实测教训：王烘文退出后由 AI 按"为赢而激进"的打法接管，直接破产出局。 */
    const SAFE = !!p.managed;

    /* 0. 被追缴：先卖股票凑钱，再把地赎回来 */
    const called = g.ownedTiles(p.id).filter(t => t.marginCall);
    if (called.length) {
      const need = called.reduce((a, t) => a + Math.round(t.loan * 1.1), 0);
      const codes = Object.keys(p.stocks).filter(c => (p.stocks[c] || 0) > 0 && !g.stockByCode(c).delisted);
      codes.sort((a, b) => (p.stocks[b] * g.stockPrice(g.stockByCode(b))) - (p.stocks[a] * g.stockPrice(g.stockByCode(a))));
      for (const c of codes) {
        acts.push(() => { if (p.cash < need) g.sellStock(c, p.stocks[c], p); });
      }
      for (const t of called) {
        acts.push(() => { if (p.cash >= Math.round(t.loan * 1.1)) g.redeem(t.id, p); });
      }
      // 实在赎不回来，就别再往里砸钱
      acts.push(() => { if (p.cash < 2000) this.raiseCash(g, p, 6000); });
      return acts;
    }

    /* 1. 缺钱：抵押 → 卖股票 → 卖地 */
    if (p.cash < 3000) {
      const cands = g.ownedTiles(p.id).filter(t => !t.mortgaged);
      if (cands.length) {
        cands.sort((a, b) => g.assetValue(b) - g.assetValue(a));
        const t = cands[0];
        acts.push(() => { if (p.cash < 4000) g.mortgage(t.id, p); });
      }
      const codes = Object.keys(p.stocks).filter(c => (p.stocks[c] || 0) > 0 && !g.stockByCode(c).delisted);
      codes.sort((a, b) => (p.stocks[b] * g.stockPrice(g.stockByCode(b))) - (p.stocks[a] * g.stockPrice(g.stockByCode(a))));
      for (const c of codes) {
        const qty = Math.max(1, Math.floor(p.stocks[c] / 2));
        acts.push(() => { if (p.cash < 6000) g.sellStock(c, qty, p); });
      }
    }

    /* 2. 市场过热 + 手头紧：把没开发的地卖回银行套现 */
    if (hot && p.cash < CONFIG.startingCash * 0.5) {
      const junk = g.ownedTiles(p.id)
        .filter(t => !t.mortgaged && t.type === 'land' && t.level <= 2)
        .sort((a, b) => g.assetValue(a) - g.assetValue(b));
      if (junk.length > 2) {
        const t = junk[0];
        acts.push(() => { if (p.cash < CONFIG.startingCash * 0.6) g.sellToBank(t.id, p); });
      }
    }

    /* 3. 现金充裕：赎回抵押 */
    if (p.cash > 18000) {
      for (const t of g.ownedTiles(p.id).filter(t => t.mortgaged)) {
        acts.push(() => { if (p.cash > 15000) g.redeem(t.id, p); });
      }
    }

    /* 4. 盖楼：地价便宜时才是好时机（成本 = 地价 × 系数，租金和市值都会随行情回来） */
    const cands = g.ownedTiles(p.id)
      .filter(t => t.type === 'land' && t.level < 5 && !t.mortgaged)
      .sort((a, b) => this.upgradeScore(g, b, p, rel) - this.upgradeScore(g, a, p, rel));
    let upCount = 0;
    /* ★ 托管档把现金底线抬高一截：不追求"每一分钱都投出去"，
       而是留够本金应付物业税和意外大额租金（人回来还要接着玩）。 */
    const reserve = (cheap ? 3500 : 6500) + (SAFE ? 9000 : 0);
    for (const t of cands) {
      if (upCount >= 6) break;
      const id = t.id;
      acts.push(() => {
        const cost = g.upgradeCost(g.tile(id));
        if (p.cash - cost > reserve && upCount < 6) { if (g.upgrade(id, p).ok) upCount++; }
      });
    }

    /* 5. 炒股：便宜时买，贵时落袋 */
    if (hot && p.cash > 8000) {
      const hold = Object.keys(p.stocks).filter(c => (p.stocks[c] || 0) > 0);
      hold.sort((a, b) => (p.stocks[b] * g.stockPrice(g.stockByCode(b))) - (p.stocks[a] * g.stockPrice(g.stockByCode(a))));
      if (hold.length) {
        const c = hold[0];
        const qty = Math.max(1, Math.floor(p.stocks[c] * 0.4));
        acts.push(() => g.sellStock(c, qty, p));
      }
    } else if (p.cash > 9500) {
      const budget = Math.floor((p.cash - 8000) * (cheap ? 0.7 : 0.5));
      const pool = g.stocks
        .filter(s => !s.delisted)
        .filter(s => g.stockPrice(s) <= s.base * (cheap ? 1.25 : 1.02))
        .sort((a, b) => (g.stockPrice(a) / a.base) - (g.stockPrice(b) / b.base));
      if (pool.length) {
        const s = pool[0];
        const price = g.stockPrice(s);
        const qty = Math.max(1, Math.min(30, Math.floor(budget / price)));
        if (qty > 0 && price * qty < budget) acts.push(() => g.buyStock(s.code, qty, p));
      }
      // 行情差的时候再补一只：这时候筹码最便宜
      if (cheap && pool.length > 1 && p.cash > 14000) {
        const s2 = pool[1];
        const price2 = g.stockPrice(s2);
        const qty2 = Math.max(1, Math.min(20, Math.floor(p.cash * 0.12 / price2)));
        acts.push(() => g.buyStock(s2.code, qty2, p));
      }
      // 囤一点地产 ETF：行情差的时候它最便宜，行情回来地价和它一起涨
      if (cheap && p.cash > 16000) {
        const etf = g.stockByCode('001');
        const qty = Math.max(1, Math.min(40, Math.floor(p.cash * 0.15 / g.stockPrice(etf))));
        acts.push(() => g.buyStock('001', qty, p));
      }
    }

    /* 6. 金融产品 */
    const C = CONFIG.cards;
    if (!p.products.insurance && p.cash > 14000 && g.quarter > g.totalQuarters() * 0.25) {
      acts.push(() => { if (p.cash > 12000 && !p.products.insurance) g.buyInsurance(p); });
    }
    if (!p.products.deposit && p.cash > 26000) {
      acts.push(() => { if (p.cash > 24000 && !p.products.deposit) g.buyDeposit(p); });
    }
    /* ★ 托管档跳过所有高风险产品。
       "风险投资卡"的期望是 +¥130 但 72% 会亏（标准差是期望的 35 倍）——
       自己打的时候愿意赌，替别人打的时候不能拿人家的身家去赌。
       垃圾债券有爆雷，同理跳过。 */
    if (!SAFE && !g.highRiskHeld(p)) {
      const unowned = g.tiles.filter(t => t.type === 'land' && t.owner < 0 && !g.optionOn(t.id));
      if (unowned.length && p.cash > 11000) {
        unowned.sort((a, b) => {
          const pa = g.groupProgress(p.id, a.group), pb = g.groupProgress(p.id, b.group);
          return (pb.have * 2 + b.basePrice / 2000) - (pa.have * 2 + a.basePrice / 2000);
        });
        const t = unowned[0];
        acts.push(() => { if (p.cash > C.optionCost + 9000 && !g.highRiskHeld(p)) g.buyOption(t.id, p); });
      } else if (p.cash > 9000) {
        acts.push(() => { if (p.cash > C.junkCost + 6000 && !g.highRiskHeld(p)) g.buyJunkBond(p); });
      }
    }
    if (!SAFE && p.cash > 32000) acts.push(() => { if (p.cash > C.ventureCost + 26000) g.buyVenture(p); });

    /* ★ 玩家间交易：先看有没有待我回应的报价，再考虑主动出价凑垄断。
       放在最后 → 交易是"锦上添花"，不影响它先把常规操作做完。 */
    for (const a of this.tradeActions(g, p)) acts.push(a);

    return acts;
  },

  /** 无差别筹钱（留一手，免得被物业税/追缴直接打死） */
  raiseCash(g, p, need) {
    const codes = Object.keys(p.stocks).filter(c => (p.stocks[c] || 0) > 0 && !g.stockByCode(c).delisted);
    codes.sort((a, b) => (p.stocks[b] * g.stockPrice(g.stockByCode(b))) - (p.stocks[a] * g.stockPrice(g.stockByCode(a))));
    for (const c of codes) {
      if (p.cash >= need) break;
      g.sellStock(c, Math.max(1, Math.ceil(p.stocks[c] / 2)), p);
    }
    if (p.cash < need) {
      const m = g.ownedTiles(p.id).filter(t => !t.mortgaged).sort((a, b) => g.assetValue(b) - g.assetValue(a));
      for (const t of m) { if (p.cash >= need) break; g.mortgage(t.id, p); }
    }
  },

  upgradeScore(g, t, p, rel) {
    const prog = g.groupProgress(p.id, t.group);
    let s = t.basePrice / 1200 + t.level * 0.6;
    if (prog.have === prog.total) s += 3;
    else if (prog.have >= 2) s += 1;
    s += (1 - rel) * 2.2;        // ★ 地价便宜时盖楼更划算
    return s;
  },

  /* ---------------- 破产地产拍卖 ----------------
     密封报价：每个存活玩家对每块地各出一个价。
     出价策略直接复用 tileValueFor 的垄断溢价 ——
       · **买过来能凑成垄断的地**：愿意出到估值的 85%（志在必得）
       · 普通地：只出 55%（捡便宜，捡不到就算了）
     再用"本块地的预算上限"兜底，避免为了一整包把现金掏空。 */
  auctionBids(g, p) {
    const pa = g.pendingAuction;
    if (!pa || !p.alive || p.id === pa.deadId) return {};
    const lots = g.tiles.filter(t => t.owner === pa.deadId);
    if (!lots.length) return {};
    const A = (CONFIG.auction && CONFIG.auction.minBid) || 100;
    /* 托管档更保守：出价上限压到 35%，且只对"能凑垄断"的地出手 */
    const SAFE = !!p.managed;
    const capRate = SAFE ? 0.35 : 0.6;
    /* ★ 每块地的预算上限 = 现金 × capRate（**不按地块数平摊**）。
       结算端会按报价从高到低依次扣现金，所以这里不需要自己均摊；
       就算对 8 块地都出满价，最后也只是按钱多钱少买到前面几块。
       早先按地块数平摊，出局者地一多单价就被压到地板价（8 块地只卖 ¥4,000）。 */
    const perLotCap = Math.max(A, Math.floor(p.cash * capRate));
    const bids = {};
    for (const t of lots) {
      const v = this.tileValueFor(g, p.id, t);
      const completes = t.type === 'land' && t.group
        && (g.groupTiles(t.group).filter(x => x.owner === p.id).length + 1 >= this.monopolyNeed(g, t.group));
      if (SAFE && !completes) continue;
      const rate = completes ? 0.85 : 0.55;
      const bid = Math.round(Math.min(v * rate, perLotCap) / 100) * 100;
      if (bid >= A) bids[t.id] = bid;
    }
    return bids;
  },
  /** 收齐全场的出价，交给 Game.auctionEstate 结算 */
  allAuctionBids(g) {
    const out = {};
    const pa = g.pendingAuction;
    if (!pa) return out;
    for (const p of g.players) {
      if (!p.alive || p.id === pa.deadId) continue;
      out[p.id] = this.auctionBids(g, p);
    }
    return out;
  },

  /* ---------------- 玩家间交易 ----------------
     核心：地块对"我"的价值不等于市值 —— **能凑成垄断的地，价值高得多**；
     反过来，把地卖给别人凑垄断，是双重损失。这条是 AI 会砍价、会拒绝亏本买卖的关键。 */
  monopolyNeed(g, grp) {
    const n = g.groupTiles(grp).length;
    const share = (CONFIG.monopolyShare === undefined) ? 1 : CONFIG.monopolyShare;
    return Math.max(1, Math.ceil(n * share));
  },
  /** 一块地交给 seat 值多少：基础市值 + 垄断溢价 + 已有等级的沉没价值 */
  tileValueFor(g, seat, t) {
    let v = g.assetValue(t);
    if (t.type === 'land' && t.group) {
      const grp = g.groupTiles(t.group);
      const mine = grp.filter(x => x.owner === seat).length;
      const need = this.monopolyNeed(g, t.group);
      /* 本来不是我的地 → 我拿到手会不会凑成垄断？ */
      if (t.owner !== seat && mine + 1 >= need) v *= 2.4;
      else if (t.owner !== seat && mine + 1 >= need - 1) v *= 1.35;   // 差两块也算有潜力
      /* 已经垄断的地区再囤一块，边际价值不高 */
      if (t.owner === seat && mine >= need) v *= 0.9;
    }
    if (t.level > 0) v += g.assetValue(t) * 0.12 * t.level;
    return v;
  },
  /** 评估一方交出的东西（对 seat 而言是"付出"还是"收入"）
   *  other = 交易对手的座位号。用来判断"我把这块地让出去，会不会直接送他一个垄断"。 */
  sideValue(g, seat, side, receiving, other) {
    let v = 0;
    const sgn = receiving ? 1 : -1;
    if (!side) return 0;
    v += sgn * (side.cash || 0);
    for (const id of (side.tiles || [])) {
      const t = g.tile(id);
      if (!t) continue;
      const base = this.tileValueFor(g, seat, t);
      /* ★ 卖出时的惩罚：看**买方**拿到这块地会不会凑成垄断。
         （之前这里错写成 t.owner，那是我自己，等于把自己的垄断当成惩罚，估值全歪了。） */
      let penalty = 0;
      if (!receiving && other != null && t.type === 'land' && t.group) {
        const theirs = g.groupTiles(t.group).filter(x => x.owner === other).length;
        if (theirs + 1 >= this.monopolyNeed(g, t.group)) penalty = base * 0.8;
      }
      v += sgn * (base + penalty);
    }
    for (const c in (side.stocks || {})) {
      const s = g.stockByCode(c);
      if (s) v += sgn * (side.stocks[c] | 0) * g.stockPrice(s);
    }
    for (const rs of (side.rentShares || [])) {
      const t = g.tile(rs.tileId);
      if (t) v += sgn * g.assetValue(t) * (rs.pct / 100) * 0.9;   // 分红权 ≈ 那块地价值的比例折价
    }
    return v;
  },
  /** 这笔报价对 seat 的净收益（正 = 该接受） */
  evalTrade(g, seat, from, to, give, want) {
    const iAmFrom = (seat === from);
    const other = iAmFrom ? to : from;
    const iReceive = iAmFrom ? want : give;
    const iGive = iAmFrom ? give : want;
    return this.sideValue(g, seat, iReceive, true, other) + this.sideValue(g, seat, iGive, false, other);
  },
  /** 轮到 AI 行动时：先处理待它回应的报价，再考虑主动出价 */
  tradeActions(g, p) {
    const acts = [];
    if (!CONFIG.trade || CONFIG.trade.enabled === false) return acts;
    /* (a) 有人向我报价 → 划算就接，否则拒绝（拒绝也要发出去，别让对方干等） */
    if (g.trade && g.trade.status === 'pending' && g.trade.to === p.id) {
      const net = this.evalTrade(g, p.id, g.trade.from, g.trade.to, g.trade.give, g.trade.want);
      const accept = net > 400;                  // 留一点安全边际，别接太勉强的
      acts.push(() => g.respondTrade(p.id, accept));
      return acts;
    }
    if (g.trade && g.trade.status === 'pending') return acts;   // 别人在谈，不插队
    /* ★ 托管档只应答、不主动出击：主动出价会花掉别人的钱去买地/凑垄断，
       而这种大动作应该留给本人在场时做。 */
    if (p.managed) return acts;
    /* (b) 主动出价凑垄断：找到"别人手上、我拿到就垄断"的地 */
    const wantTile = this.findMonopolyTarget(g, p);
    if (wantTile) {
      const seller = g.players[wantTile.owner];
      if (seller && seller.alive) {
        const myValue = this.tileValueFor(g, p.id, wantTile);
        const askBase = this.tileValueFor(g, seller.id, wantTile);
        /* 对方的心理底价：他知道卖给我会让我垄断，会加价 */
        const theirs = g.groupTiles(wantTile.group).filter(x => x.owner === p.id).length;
        const ask = askBase + (theirs + 1 >= this.monopolyNeed(g, wantTile.group) ? askBase * 0.5 : 0);
        const surplus = myValue - ask;
        /* 没有共赢空间就别开口（开口必被拒，还占掉唯一的那笔报价名额） */
        if (surplus > 600) {
          const target = ask + surplus * 0.5;
          let cashPay = Math.round(Math.min(p.cash * 0.6, target) / 100) * 100;
          /* ★ 现金不够就用**股票补差价** —— 这正是"地产和股票绑在一起"的玩法：
             想凑垄断但现金不足的人，得付出自己的持股。 */
          const stockOffer = {};
          let need = target - cashPay;
          if (need > 0) {
            const held = Object.keys(p.stocks)
              .filter(c => (p.stocks[c] || 0) > 0 && !g.stockByCode(c).delisted)
              .sort((a, b) => g.stockPrice(g.stockByCode(b)) - g.stockPrice(g.stockByCode(a)));
            for (const c of held) {
              if (need <= 0) break;
              const px = g.stockPrice(g.stockByCode(c));
              const n = Math.min(p.stocks[c], Math.ceil(need / px));
              if (n > 0) { stockOffer[c] = n; need -= n * px; }
            }
          }
          /* 还差太多就别开口了，免得把唯一的名额浪费在必被拒的报价上 */
          if (need <= Math.max(800, target * 0.12) && (cashPay >= 1000 || Object.keys(stockOffer).length)) {
            acts.push(() => g.proposeTrade(p.id, seller.id, { cash: cashPay, stocks: stockOffer }, { tiles: [wantTile.id] }));
          }
        }
      }
    }
    return acts;
  },
  /** 找一块"买过来就能让我垄断"的地（对方持有、未抵押、且我离垄断只差这一块） */
  findMonopolyTarget(g, p) {
    const cands = [];
    for (const t of g.tiles) {
      if (t.type !== 'land' || !t.group) continue;
      if (t.owner < 0 || t.owner === p.id || t.mortgaged) continue;
      const grp = g.groupTiles(t.group);
      const mine = grp.filter(x => x.owner === p.id).length;
      if (mine + 1 >= this.monopolyNeed(g, t.group)) cands.push({ t, mine });
    }
    if (!cands.length) return null;
    /* 优先买"我已经拿得最多"的那个地区，成交概率更高 */
    cands.sort((a, b) => b.mine - a.mine || g.assetValue(b.t) - g.assetValue(a.t));
    /* 只在自己还有余钱时动手，别把现金掏空 */
    if (p.cash < 6000) return null;
    return cands[0].t;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { AI };
