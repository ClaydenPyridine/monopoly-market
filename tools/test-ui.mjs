/* 界面端到端测试：用 jsdom 把 HTML 真跑一遍，四人全人类打完一整局。
 * 用法：node tools/test-ui.mjs [要测试的 html，默认 index.html]
 *       node tools/test-ui.mjs dist/地产股神.html      # 顺便验证单文件版
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'index.html');
const html = fs.readFileSync(target, 'utf8');
const problems = [];

const vc = new VirtualConsole();
vc.on('jsdomError', e => problems.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  url: 'file:///' + target.replace(/\\/g, '/'),
  virtualConsole: vc,
});
const win = dom.window;
await new Promise(res => win.addEventListener('load', res));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const doc = win.document;

function need(cond, msg) { if (!cond) problems.push('断言失败：' + msg); }

/* 1. 脚本是否加载成功 */
const UI = win.eval('typeof UI !== "undefined" ? UI : null');
const CONFIG = win.eval('typeof CONFIG !== "undefined" ? CONFIG : null');
need(UI, 'UI 未定义（脚本没加载成功）');
need(CONFIG, 'CONFIG 未定义');
if (!UI) { console.log(JSON.stringify({ ok: false, problems }, null, 2)); process.exit(1); }

/* 2. 开局设置：4 个位置都设成人类，方便同步驱动 */
const sels = doc.querySelectorAll('.slot select');
need(sels.length === 4, '应有 4 个玩家槽位，实际 ' + sels.length);
sels.forEach((s, i) => { s.value = i < 4 ? 'human' : 'off'; });
/* ★ 选下拉项要按"选项里真实存在的值"来挑，不能硬写死。
   之前这里写死 '25' 和 '30000'，而 main.js 的旧写法是 `parseInt(...) || 10`——
   值对不上就**静默**回落成 10 季度 / 25000 现金，测试于是长期只跑 40% 的覆盖，没人发现。
   现在：挑不到就用当前选中项，并**断言局时确实生效**。 */
function pickOption(id, prefer) {
  const sel = doc.getElementById(id);
  const vals = Array.from(sel.options).map(o => o.value);
  sel.value = vals.indexOf(prefer) >= 0 ? prefer
    : (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].value : vals[0]);
  return parseInt(sel.value, 10);
}
const wantQuarters = pickOption('opt-quarters', '25');
const wantCash = pickOption('opt-cash', '30000');

UI.setSpeed(0.01);
doc.getElementById('btn-start').click();
need(UI.g, '点击开始后没有创建对局');
/* 局时/现金必须真的是我们选的，否则整局覆盖范围会悄悄缩水 */
need(CONFIG.maxQuarters === wantQuarters,
  '局时没生效：想要 ' + wantQuarters + '，实际 CONFIG.maxQuarters=' + CONFIG.maxQuarters);
need(CONFIG.startingCash === wantCash,
  '初始现金没生效：想要 ' + wantCash + '，实际 CONFIG.startingCash=' + CONFIG.startingCash);
need(UI.g.players.every(p => p.cash === wantCash),
  '玩家初始现金不对：' + UI.g.players.map(p => p.cash).join(','));
need(doc.getElementById('setup').classList.contains('hide'), '开局面板没有隐藏');
need(UI.tileEls.length === 40, '棋盘应有 40 格，实际 ' + UI.tileEls.length);

/* 3. 逐个回合驱动，人类决策一律点弹窗里的第一个"推荐"按钮（跳过被禁用的） */
function clickModal(re, fallbackIdx) {
  const btns = Array.from(doc.querySelectorAll('#modal-root .m-actions button')).filter(b => !b.disabled);
  const hit = btns.find(b => re.test(b.textContent));
  const b = hit || btns[fallbackIdx || 0];
  if (b) b.click();
  return !!b;
}
function clickCenter(re) {
  const btns = Array.from(doc.querySelectorAll('#center-actions button')).filter(b => !b.disabled);
  const b = btns.find(x => re.test(x.textContent));
  if (b) b.click();
  return !!b;
}

let guard = 0, turns = 0, modals = 0, stuck = null;
const phaseCount = {};
const maxQuarters = CONFIG.maxQuarters;
while (!UI.g.over && guard++ < 4000) {
  const g = UI.g;
  const ph = g.phase;
  phaseCount[ph] = (phaseCount[ph] || 0) + 1;
  if (ph === 'awaiting-roll') { turns++; await UI.doRoll(); }
  else if (ph === 'awaiting-buy') { modals++; clickModal(/买下/, 0); }
  else if (ph === 'awaiting-event') { modals++; clickModal(/接受/, 0); }
  else if (ph === 'awaiting-jail') { clickCenter(/蹲着/); }
  else if (ph === 'awaiting-trade') { UI.onEndTurn(); }
  else { stuck = ph; await sleep(5); }
}
need(guard < 4000, '回合驱动死循环了（停在阶段 ' + stuck + '，阶段分布 ' + JSON.stringify(phaseCount) + '）');
need(UI.g.over, '对局没有正常结束（当前阶段 ' + UI.g.phase + '，阶段分布 ' + JSON.stringify(phaseCount) + '）');
need(UI.g.ranking && UI.g.ranking.length === 4, '结算排名缺失');
if (!UI.g.over) {
  console.log(JSON.stringify({ ok: false, 问题: problems, 阶段分布: phaseCount }, null, 2));
  process.exit(1);
}

/* 4. DOM 抽查 */
const tiles = doc.querySelectorAll('#board .tile');
need(tiles.length === 40, 'DOM 里棋盘格数量不对：' + tiles.length);
need(doc.querySelectorAll('#board .tile .nm').length === 40, '有格子没渲染名称');
const stocks = doc.querySelectorAll('#market-list .stock');
need(stocks.length === 6, '股票行数量不对：' + stocks.length);
need(doc.querySelectorAll('#player-list .pcard').length === 4, '玩家卡片数量不对');
need(doc.querySelectorAll('#log .log-line').length > 20, '日志太少');
need(doc.getElementById('rei-value').textContent.length > 0, '地产指数没渲染');

/* 5. 二级面板（抽屉）开关 */
const app = doc.getElementById('app');
need(!doc.getElementById('drawer-market').classList.contains('open'), '股市抽屉一开始应该是收起的');
doc.getElementById('btn-market').click();
need(doc.getElementById('drawer-market').classList.contains('open'), '点股市按钮后抽屉没展开');
need(app.classList.contains('drawer-open'), '展开抽屉后 #app 没有 drawer-open');
need(doc.getElementById('btn-market').classList.contains('on'), '股市按钮没高亮');
doc.getElementById('btn-players').click();
need(doc.getElementById('drawer-players').classList.contains('open'), '玩家抽屉没展开');
need(!doc.getElementById('drawer-market').classList.contains('open'), '两个抽屉不应该同时开');
UI.closeDrawers();
need(!doc.getElementById('drawer-players').classList.contains('open'), 'closeDrawers 没关掉抽屉');
need(!app.classList.contains('drawer-open'), 'closeDrawers 没移除 drawer-open');

/* 6. 弹窗渲染不报错 */
UI.g.phase = 'awaiting-trade';
UI.tileModal(1); need(doc.querySelectorAll('#modal-root .modal').length === 1, '地块弹窗没出现');
UI.rulesModal(); need(doc.querySelectorAll('#modal-root .modal').length === 1, '规则弹窗没出现');
doc.getElementById('modal-root').innerHTML = '';
UI.renderAll();
UI.tileModal(0);
doc.getElementById('modal-root').innerHTML = '';

/* 7. 每个阶段都能渲染 */
for (const ph of ['awaiting-roll', 'awaiting-jail', 'awaiting-buy', 'awaiting-event', 'awaiting-trade', 'over']) {
  UI.g.phase = ph;
  try { UI.renderAll(); UI.renderCenter(); } catch (e) { problems.push('渲染 ' + ph + ' 抛错：' + e.message); }
}

/* 8. ★ 联机模式：按钮归属 + 绝不能本地执行
      这是回归测试——早先 UI.net 从没被赋值，导致联机时点击照样在本地跑游戏逻辑，
      表现就是"主机能替其他玩家掷骰子"。 */
const NET = win.eval('typeof NET !== "undefined" ? NET : null');
need(NET, 'NET 未定义');
if (NET) {
  NET.room = 'TESTRM'; NET.token = 'tok'; NET.seat = 2;
  UI.g.over = false;
  UI.g.phase = 'awaiting-roll';
  UI.g.current = 0;                       // 现在是玩家 0 的回合，我是座位 2
  need(!!UI.net, '联机时 UI.net 应该是真值（否则按钮会走本地逻辑）');
  need(UI.isMyTurn() === false, '不是自己回合时 isMyTurn() 必须为 false');

  const sent = [];
  const origSend = NET.send;
  NET.send = (a, p) => { sent.push({ a, p }); return Promise.resolve({ ok: true }); };

  const posBefore = UI.g.players[0].pos;
  const cashBefore = UI.g.players[0].cash;
  await UI.doRoll();
  need(sent.length === 0, '不是自己回合却发出了操作：' + JSON.stringify(sent));
  need(UI.g.players[0].pos === posBefore, '★ 不是自己回合却本地移动了棋子（＝主机替别人操作）');
  need(UI.g.players[0].cash === cashBefore, '不是自己回合却本地改动了现金');

  UI.g.phase = 'awaiting-trade';
  UI.onEndTurn();
  need(sent.length === 0, '不是自己回合却发出了结束回合');
  need(UI.g.current === 0, '不是自己回合却本地推进了回合');

  UI.g.current = 2;
  need(UI.isMyTurn() === true, '自己回合时 isMyTurn() 必须为 true');
  UI.g.phase = 'awaiting-roll';
  const posBefore2 = UI.g.players[2].pos;
  await UI.doRoll();
  need(sent.length === 1 && sent[0].a === 'roll', '自己回合没把 roll 发给服务端：' + JSON.stringify(sent));
  need(UI.g.players[2].pos === posBefore2, '联机时不该在本地执行掷骰移动');

  sent.length = 0;
  UI.g.phase = 'awaiting-trade';
  UI.onEndTurn();
  need(sent.length === 1 && sent[0].a === 'endTurn', '结束回合没发给服务端');
  sent.length = 0;
  UI.onTrade('001', 'buy');
  need(sent.length === 1 && sent[0].a === 'buyStock', '买股票没发给服务端');

  /* 地块详情：不是自己回合时，别人的地块上不该冒出任何操作按钮 */
  UI.g.current = 0;
  UI.g.phase = 'awaiting-trade';
  const tOther = UI.g.tiles.find(t => t.type === 'land' && t.owner === 0);
  if (tOther) {
    UI.tileModal(tOther.id);
    const btns = Array.prototype.map.call(
      doc.querySelectorAll('#modal-root button'), b => b.textContent.trim());
    const bad = btns.filter(x => /升级|抵押|赎回|卖给银行/.test(x));
    need(bad.length === 0, '★ 不是自己回合，却能在别人的地块上看到操作按钮：' + bad.join(' / '));
    doc.getElementById('modal-root').innerHTML = '';
  }

  /* 自己的回合：升级必须发给服务端，不能本地执行 */
  UI.g.current = 2;
  const tMine = UI.g.tiles.find(t => t.type === 'land' && t.owner === 2 && !t.mortgaged && t.level < 5);
  if (tMine) {
    // 保证买得起
    UI.g.players[2].cash = 999999;
    const lvBefore = tMine.level;
    UI.tileModal(tMine.id);
    const upBtn = Array.prototype.find.call(
      doc.querySelectorAll('#modal-root button'), b => /升级/.test(b.textContent));
    need(upBtn, '自己的地块上看不到升级按钮');
    if (upBtn) {
      sent.length = 0;
      upBtn.click();
      need(sent.length === 1 && sent[0].a === 'upgrade', '升级没发给服务端：' + JSON.stringify(sent));
      need(tMine.level === lvBefore, '★ 联机时升级在本地执行了（会和服务端状态打架）');
    }
    doc.getElementById('modal-root').innerHTML = '';
  }

  NET.send = origSend;
  NET.room = null; NET.token = null;      // 复原成单机
  UI.g.current = 0;
  UI.g.phase = 'awaiting-roll';
}

/* 9. 存读档往返 */
const before = UI.g.netWorth(UI.g.players[0]);
const clone = win.eval('Game').deserialize(UI.g.serialize());
need(clone.netWorth(clone.players[0]) === before, '存读档后净资产不一致');
need(clone.cyclePeriod > 0 && typeof clone.cycleWave === 'function', '地产周期状态没被存档');

const result = {
  ok: problems.length === 0,
  回合数: turns,
  弹窗数: modals,
  结束季度: UI.g.quarter - 1,
  冠军: UI.g.winner.name,
  冠军净资产: UI.g.netWorth(UI.g.winner),
  最终地产指数: Math.round(UI.g.rei * 10) / 10,
  破产人数: UI.g.players.filter(p => !p.alive).length,
  强制收回: UI.g.tiles.filter(t => t.marginCall).length,
  日志条数: UI.g.logs.length,
  问题: problems,
};
console.log(JSON.stringify(result, null, 2));
process.exit(problems.length ? 1 : 0);
