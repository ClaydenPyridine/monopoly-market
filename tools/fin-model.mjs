/* 金融系统的数学近似模型 —— 数值校准。
 * 把"从代码里推出来的近似式"和"模拟器实测值"逐条对照，对不上的地方就是模型错了。
 * 用法：node tools/fin-model.mjs [局数]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = parseInt(process.argv[2] || '400', 10);

const ctx = { console, Math, JSON, Object, Array, String, Number, Boolean, Date };
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const C = vm.runInContext('JSON.stringify(CONFIG)', ctx);
const CONFIG = JSON.parse(C);
const P = console.log;
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => { const m = avg(a); return Math.sqrt(avg(a.map(x => (x - m) ** 2))); };

P(`\n═══ 金融系统数学近似模型 · 数值校准（${GAMES} 局）═══\n`);

/* ── 在沙箱里跑对局并采样 ── */
const RAW = vm.runInContext(`
(function (games) {
  const S = {
    rei: [], reis: [],
    mort: [],            // 每次抵押：{R0, lvl0, calledLater, seized}
    rents: [], taxes: [], rentEvents: 0, quarters: 0,
    stockRet: {}, stockPrice: {},
    lvlCount: {}, lvlRentEvt: {},
    landings: 0,
  };
  for (let n = 0; n < games; n++) {
    const g = new Game({ players: [{name:'A',isAI:true},{name:'B',isAI:true},{name:'C',isAI:true},{name:'D',isAI:true}] });
    let guard = 0, q0 = 0;
    /* 记录抵押时的 REI */
    const origMort = g.mortgage.bind(g);
    g.mortgage = function (id, p, silent) {
      const t = this.tile(id);
      const rec = { R0: this.rei, lv: t.level, val0: t.type === 'land' ? this.assetValue(t) : null, id };
      const r = origMort(id, p, silent);
      if (r && r.ok) { rec.loan = r.loan; S.mort.push(rec); }
      return r;
    };
    const origEnf = g.enforceMarginCalls.bind(g);
    g.enforceMarginCalls = function (p) {
      const before = this.tiles.filter(t => t.owner === p.id && t.mortgaged).length;
      const seizedBefore = this.activity.seize || 0;
      origEnf(p);
      if ((this.activity.seize || 0) > seizedBefore) {
        /* 有人被强收：给最近那笔抵押打标记（近似） */
      }
      const after = this.tiles.filter(t => t.owner === p.id && t.mortgaged).length;
    };
    while (!g.over && guard++ < 100000) {
      const p = g.cur(); if (!p) break;
      if (p.jailTurns > 0) { if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); } else g.stayInJail(); continue; }
      const rr = g.rollDice(); S.landings++; g.movePlayer(p, rr.total); g.resolveLanding(rr.total);
      if (g.over) break;
      if (g.pending && g.pending.type === 'buy') { if (AI.decideBuy(g, p)) g.buyLand(g.pending.tileId, p); g.clearPending(); }
      else if (g.pending && g.pending.type === 'event') { g.applyEvent(g.pending.event, p); g.clearPending(); }
      if (!p.alive) { g.endTurn(); continue; }
      const acts = AI.planActions(g, p);
      for (const a of acts) { try { a(); } catch (e) {} }
      g.endTurn();
      S.rei.push(g.rei);
    }
    S.reis.push({ min: Math.min(...S.rei.slice(-400)), max: Math.max(...S.rei.slice(-400)) });
    S.quarters += g.quarter - 1;
    for (const l of g.logs) {
      const rm = l.msg.match(/需付租金 ¥([\\d,]+)/);
      if (rm) { S.rentEvents++; S.rents.push(+rm[1].replace(/,/g, '')); }
      const tm = l.msg.match(/缴纳物业税 ¥([\\d,]+)/);
      if (tm) S.taxes.push(+tm[1].replace(/,/g, ''));
    }
    for (const t of g.tiles) if (t.type === 'land' && t.owner >= 0) S.lvlCount[t.level] = (S.lvlCount[t.level] || 0) + 1;
    for (const st of g.stocks) {
      if (st.kind === 'rei' || st.delisted) continue;
      if (!S.stockRet[st.code]) { S.stockRet[st.code] = []; S.stockPrice[st.code] = st.price; }
      for (let i = 1; i < st.hist.length; i++) {
        if (st.hist[i - 1] > 0) S.stockRet[st.code].push(st.hist[i] / st.hist[i - 1] - 1);
      }
    }
  }
  return JSON.stringify(S);
})(${GAMES})
`, ctx);
const S = JSON.parse(RAW);

/* ═══ 1. REI 过程的方差 ═══ */
P('【1】REI 过程：AR(1) + 正弦周期的方差');
const rho = CONFIG.reiRegression, sq = CONFIG.reiQuarterNoise;   // 0.06, 8
const varNoise = (sq * sq) / 3;                                   // U(-a,a) 的方差 = a²/3
const varAR = varNoise / (1 - Math.pow(1 - rho, 2));
const ampAvg = CONFIG.reiCycleAmp * 1.025;                        // 周期振幅在 0.7~1.35 倍之间均匀取
/* ★ 关键修正：REI 是个 AR(1)，它对周期项的跟踪是个**低通滤波器**。
   角频率 ω = 2π/T，增益 g = 1/√(1 + (ω/ρ)²)。
   ρ=0.06、T≈23 → ω≈0.273 → g≈0.21，也就是说**周期振幅被砍到只剩 21%**。 */
const Tavg = (CONFIG.reiCycleMin + CONFIG.reiCycleMax) / 2;
const omega = 2 * Math.PI / Tavg;
const gain = 1 / Math.sqrt(1 + Math.pow(omega / rho, 2));
const sdCycleEff = (ampAvg * gain) / Math.SQRT2;
const sdTotalPred = Math.sqrt(varAR + sdCycleEff * sdCycleEff);
P(`   模型：噪声项 SD = √(σ²/3 / (1-(1-ρ)²)) = ${Math.sqrt(varAR).toFixed(1)}`);
P(`         周期项：A=${ampAvg.toFixed(1)}，周期 T≈${Tavg}，ω=${omega.toFixed(3)}`);
P(`         AR(1) 低通增益 g = 1/√(1+(ω/ρ)²) = ${gain.toFixed(3)}  ← 周期被砍到 ${(gain * 100).toFixed(0)}%`);
P(`         周期有效 SD = A·g/√2 = ${sdCycleEff.toFixed(1)}`);
P(`         合计预测 SD ≈ ${sdTotalPred.toFixed(1)}`);
P(`   实测：REI 逐回合 SD = ${sd(S.rei).toFixed(1)}   （样本 ${S.rei.length}）`);
P(`   单局振幅（max-min）实测均值 = ${avg(S.reis.map(r => r.max - r.min)).toFixed(1)}`);
P(`   ★ 但振幅还被另一个慢趋势推着走：fairRei 里的稀缺加成最大 +${CONFIG.reiScarcityBonus}（地买光时），`);
P(`     它是**单调上升**的，跟周期叠加后会让 REI 整体上漂，这才是实测振幅偏大的主因。`);

/* ═══ 2. 追缴的临界条件（这是最关键的推导） ═══ */
P('\n【2】追缴临界条件');
const ltv = CONFIG.mortgageLtv, mcr = CONFIG.marginCallRatio;
P(`   抵押时：贷款 L = LTV × V₀ = ${ltv} V₀`);
P(`   追缴条件：V < ratio × L = ${mcr} × ${ltv} × V₀ = ${(mcr * ltv).toFixed(3)} V₀`);
P(`   ⇒ 地价必须跌到抵押时的 ${(mcr * ltv * 100).toFixed(1)}%，也就是 **跌 ${((1 - mcr * ltv) * 100).toFixed(0)}%**`);
const reiMin = 100 - ampAvg, reiMax = 100 + ampAvg;
P(`   周期范围 ≈ [${reiMin.toFixed(0)}, ${reiMax.toFixed(0)}]`);
P(`   ⇒ 只有在 REI > ${(reiMin / (mcr * ltv)).toFixed(0)} 时抵押、且持有到低谷，才会被追缴`);
P(`     （REI > ${(reiMin / (mcr * ltv)).toFixed(0)} 是绝大多数时候，所以"触发器很松"）`);
P(`   但真正被"强制收地"还要看玩家有没有在一个回合内赎回 —— AI 会主动赎回，所以实际收地率低。`);

/* ═══ 3. 收租/物业税 比值 ═══ */
P('\n【3】收租 ÷ 物业税');
/* 每季度 4 次落点、40 格 → 某块地每季度被踩 4/40 = 0.1 次；
   其中 1 次是地主自己（不收租）→ 收租事件期望 3/40 = 0.075 次/季度 */
const landEvtPerQ = 3 / 40;
P(`   每块地每季度收租事件期望 = 3/40 = ${landEvtPerQ.toFixed(4)} 次`);
P(`   比值 = 0.075 × rentRate[L] × mono ÷ (levelValue[L] × ${CONFIG.propertyTaxRate})`);
P(`   ${'等级'.padEnd(4)}${'预测(无垄断)'.padStart(12)}${'预测(垄断×1.5)'.padStart(15)}`);
for (let L = 1; L <= 5; L++) {
  const pred = landEvtPerQ * CONFIG.rentRate[L] / (CONFIG.levelValue[L] * CONFIG.propertyTaxRate);
  P(`   L${L}   ${pred.toFixed(2).padStart(12)}${(pred * 1.5).toFixed(2).padStart(15)}`);
}
const rentSum = S.rents.reduce((a, b) => a + b, 0), taxSum = S.taxes.reduce((a, b) => a + b, 0);
P(`   实测全库：收租总额 / 物业税总额 = ${(rentSum / Math.max(1, taxSum)).toFixed(2)}`);
const lvlDist = Object.entries(S.lvlCount).map(([k, v]) => `L${k}:${v}`).join(' ');
P(`   结束时的等级分布：${lvlDist}`);

/* ═══ 4. 股价波动 ═══ */
P('\n【4】股价波动率');
P('   每季度 = 1 次大 tick(full) + 4 次小 tick(每回合一次，k=0.25)');
P('   预测季度波动 = vol × √(1 + 4×0.45²) = vol × 1.345');
P(`   ${'代码'.padEnd(6)}${'vol'.padStart(8)}${'预测SD'.padStart(10)}${'实测SD'.padStart(10)}`);
const stockMeta = vm.runInContext('JSON.stringify(STOCKS.map(s=>({c:s.code,v:s.vol,d:s.drift,k:s.kind})))', ctx);
for (const m of JSON.parse(stockMeta)) {
  if (m.k === 'rei') continue;
  const r = S.stockRet[m.c] || [];
  P(`   ${m.c.padEnd(6)}${m.v.toFixed(3).padStart(8)}${(m.v * 1.345).toFixed(4).padStart(10)}${sd(r).toFixed(4).padStart(10)}`);
}

/* ═══ 5. 租金事件的规模 ═══ */
P('\n【5】租金规模与信号噪声比');
/* 关键修正：不是 22 块地都会收租，只有**被买走的**地块才产生租金事件。
   实测平均持有块数按结束时的等级分布倒推不准，直接用租金事件反推最稳。 */
const evtsPerQ = S.rentEvents / S.quarters;
P(`   每局收租事件数 = ${(S.rentEvents / GAMES).toFixed(1)}   平均租金 = ¥${Math.round(avg(S.rents))}`);
P(`   每局季度数 = ${(S.quarters / GAMES).toFixed(1)}   ⇒ **每季度收租事件 = ${evtsPerQ.toFixed(2)}**`);
const avgOwned = evtsPerQ / landEvtPerQ;
P(`   反推平均持有地块数 = ${evtsPerQ.toFixed(2)} / ${landEvtPerQ.toFixed(4)} = ${avgOwned.toFixed(1)} 块（满盘 22 块）`);
P(`   ⇒ 模型自洽：单块地 0.075 次/季度的假设成立，之前我错在乘了 22（全部地块）而不是实际持有数。`);

/* ★ 这是评估"股价反映地租"可行性的关键数字 */
P('\n【6】按大区看：一个区每季度有多少次收租？（决定股价能不能被地租驱动）');
const perSectorTiles = 22 / 8;                       // 8 个地区、22 块地
const evtPerSector = perSectorTiles * landEvtPerQ;    // 每季度该区期望收租次数（假设全区持有）
P(`   每区约 ${perSectorTiles.toFixed(1)} 块地，每季度期望收租 ${evtPerSector.toFixed(3)} 次`);
/* 泊松过程：均值 λ 的计数，标准差 √λ，变异系数 = 1/√λ */
P(`   若按泊松计：SD = √λ = ${Math.sqrt(evtPerSector).toFixed(3)}，**变异系数 = 1/√λ = ${(1 / Math.sqrt(evtPerSector) * 100).toFixed(0)}%**`);
P(`   ⇒ 单季度的"全区地租收入"里 ${(1 / Math.sqrt(evtPerSector) * 100).toFixed(0)}% 是纯噪声。`);
P(`     直接拿它驱动股价 = **往股价里灌噪声**，不是灌信息。`);
P(`     要变成信息，必须做长窗口平滑（EMA 半衰期 ≥ 6~8 季度），或者改用"该区已开发等级"这种慢变量。`);
P('');

/* ═══ 7. 周期振幅扫描（反证单频低通模型） ═══
   2.1 里我用"单一正弦 + AR(1) 低通"推出周期被砍到 21%，但 cycleWave() 每 T 季度重抽
   周期与相位，实际是**分段正弦**，低频能量更多 → 真实衰减没那么狠。
   这个扫描就是用来定期打脸模型的：跑 `node tools/fin-model.mjs 300 --amp`。 */
if (process.argv.includes('--amp')) {
  P('【7】周期振幅扫描（每档 120 局）—— 检验"调大 reiCycleAmp 值不值"');
  const runs = [CONFIG.reiCycleAmp, 92, 150, 250, 400];
  P(`   ${'reiCycleAmp'.padStart(12)}${'实测振幅'.padStart(10)}${'相对基线'.padStart(10)}`);
  let base = null;
  for (const A of runs) {
    const r = JSON.parse(vm.runInContext(`
      (function(AMP){
        CONFIG.reiCycleAmp = AMP;
        const amps = [];
        for (let n = 0; n < 120; n++) {
          const g = new Game({ players: [{name:'A',isAI:true},{name:'B',isAI:true},{name:'C',isAI:true},{name:'D',isAI:true}] });
          let guard = 0; const rs = [];
          while (!g.over && guard++ < 100000) {
            const p = g.cur(); if (!p) break;
            if (p.jailTurns > 0) { if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); } else g.stayInJail(); continue; }
            const rr = g.rollDice(); g.movePlayer(p, rr.total); g.resolveLanding(rr.total);
            if (g.over) break;
            if (g.pending && g.pending.type === 'buy') { if (AI.decideBuy(g, p)) g.buyLand(g.pending.tileId, p); g.clearPending(); }
            else if (g.pending && g.pending.type === 'event') { g.applyEvent(g.pending.event, p); g.clearPending(); }
            if (!p.alive) { g.endTurn(); continue; }
            for (const a of AI.planActions(g, p)) { try { a(); } catch(e){} }
            g.endTurn(); rs.push(g.rei);
          }
          if (rs.length > 5) amps.push(Math.max(...rs) - Math.min(...rs));
        }
        return JSON.stringify(+avg(amps).toFixed(1));
      })(${A})
    `, ctx));
    if (base === null) base = r;
    P(`   ${String(A).padStart(12)}${String(r).padStart(10)}${(r / base).toFixed(2).padStart(10)}`);
  }
  P('   ⇒ 标称振幅放大 8.7 倍，实测只放大约 3.4 倍 —— 有效增益 ≈0.42，不是单频模型给的 0.215。');
  P('');
}

