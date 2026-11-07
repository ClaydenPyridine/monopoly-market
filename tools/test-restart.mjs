/* 复现"打完一局后再开一局启动不了"。
 * 用法：node tools/test-restart.mjs [html]
 * 走**完整的人类操作路径**：开一局 → 打完到结束 → 点「再来一局/新游戏」→ 再开一局。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'index.html');
const html = fs.readFileSync(target, 'utf8');
const problems = [];
const step = [];

const vc = new VirtualConsole();
vc.on('jsdomError', e => problems.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  url: 'file:///' + target.replace(/\\/g, '/'), virtualConsole: vc,
});
const win = dom.window;
await new Promise(res => win.addEventListener('load', res));
const doc = win.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const need = (c, m) => { if (!c) problems.push(m); };

const UI = win.eval('typeof UI !== "undefined" ? UI : null');
const CONFIG = win.eval('typeof CONFIG !== "undefined" ? CONFIG : null');
need(UI, 'UI 未定义');
if (!UI) { console.log(JSON.stringify({ ok: false, 问题: problems }, null, 2)); process.exit(1); }

/* 点中央操作区的按钮（骰子/蹲着等在这里，不在 modal 里） */
function clickCenter(re) {
  const btns = Array.from(doc.querySelectorAll('#center-actions button')).filter(b => !b.disabled);
  const b = btns.find(x => re.test(x.textContent));
  if (b) b.click();
  return !!b;
}

/* 点弹窗里第一个可用按钮（和 test-ui 同款驱动） */
function clickModal(re, fallbackIdx) {
  const btns = Array.from(doc.querySelectorAll('#modal-root .m-actions button')).filter(b => !b.disabled);
  const hit = btns.find(b => re.test(b.textContent));
  const b = hit || btns[fallbackIdx || 0];
  if (b) b.click();
  return !!b;
}

async function playOneGame(label) {
  const sels = doc.querySelectorAll('.slot select');
  sels.forEach((s, i) => { s.value = i < 4 ? 'human' : 'off'; });
  const qEl = doc.getElementById('opt-quarters');
  if (qEl) qEl.value = Array.from(qEl.options).map(o => o.value).find(v => +v <= 20) || qEl.value;
  UI.setSpeed(0.01);
  doc.getElementById('btn-start').click();
  await sleep(120);
  need(UI.g, `${label}: 点开始后没有创建对局`);
  need(UI.g && !UI.g.over, `${label}: 新建的对局居然是已结束状态`);

  /* 按 phase 直接驱动（和 test-ui.mjs 同款）。
     早先我写成"循环点 #modal-root 里的按钮" —— 但掷骰按钮在 #center-actions，
     根本点不到，于是两局都卡在 Q1、跑满 20001 步，误报成"启动不了"。
     教训：复现脚本本身驱动错了，比不写测试更危险。 */
  let guard = 0;
  while (UI.g && !UI.g.over && guard++ < 4000) {
    const ph = UI.g.phase;
    if (ph === 'awaiting-roll') await UI.doRoll();
    else if (ph === 'awaiting-buy') clickModal(/买下|购买/, 0);
    else if (ph === 'awaiting-event') clickModal(/接受|确定/, 0);
    else if (ph === 'awaiting-jail') clickCenter(/蹲着|保释/);
    else if (ph === 'awaiting-trade') UI.onEndTurn();
    else await sleep(5);
  }
  return { guard, over: UI.g && UI.g.over, quarter: UI.g && UI.g.quarter, winner: UI.g && UI.g.winner && UI.g.winner.name };
}

/* ---------- 第一局 ---------- */
const g1 = await playOneGame('第一局');
step.push(`第一局：跑 ${g1.guard} 步，over=${g1.over}，Q${g1.quarter}，冠军 ${g1.winner}`);
need(g1.over, '第一局没能打完（测试前提不成立）');

/* ---------- 结束弹窗是否出现，按钮是什么 ---------- */
const modalBtns = Array.from(doc.querySelectorAll('#modal-root .m-actions button')).map(b => b.textContent.trim());
step.push('结束弹窗按钮：' + (modalBtns.join(' / ') || '（没有弹窗）'));

/* 模拟「再来一局」：真实实现是 location.reload()，jsdom 里不能真 reload，
   所以手动还原成 reload 之后的初始态，再走一次完整开局流程。 */
const resultModal = doc.querySelector('#modal-root .modal');
if (resultModal) resultModal.remove();

/* 第一局结束后，实时状态里可能还留着 pendingAuction / trade 之类的残留 */
step.push('第一局结束时 pendingAuction=' + !!(UI.g && UI.g.pendingAuction) +
  ' trade=' + !!(UI.g && UI.g.trade) + ' over=' + !!(UI.g && UI.g.over));

/* ---------- 点「新游戏」→ 再开一局 ---------- */
doc.getElementById('btn-new').click();
await sleep(60);
const setupShown = !doc.getElementById('setup').classList.contains('hide');
step.push('点「新游戏」后 setup 面板可见 = ' + setupShown);
need(setupShown, '点「新游戏」后 setup 面板没有显示出来');

const g2 = await playOneGame('第二局');
step.push(`第二局：跑 ${g2.guard} 步，over=${g2.over}，Q${g2.quarter}，冠军 ${g2.winner}`);
need(g2.over, `第二局没能启动或没能推进（跑了 ${g2.guard} 步，Q${g2.quarter}，over=${g2.over}）`);
need(g2.quarter > 1, `第二局卡在第 ${g2.quarter} 季度没动`);

/* ---------- 联机侧：打完的房间不该被自动重连回去 ----------
   联机下"再来一局"是 location.reload()，刷新时 tryReconnect 会用存档里的房间号+token
   自动重连。如果那个房间的对局已经结束，玩家就被拽回结算画面、回不到开局设置 ——
   用户报的"结束后再来一局无法正常启动"。
   这里把 fetch 打桩成"这个房间已经打完了"，验证 tryReconnect 必须拒绝并清掉身份。

   ★ 取不到 NET 就**直接判失败**，不许静默跳过。
   我第一版写成 `if (typeof win.NET !== 'undefined' && win.NET) { ... }`，
   结果 NET 取不到时整段被跳过、测试照样全绿 —— 等于白写。
   这正是本项目反复踩的"静默通过"坑（测试假绿比没测试更危险）。 */
const NET = win.eval('typeof NET !== "undefined" ? NET : null');
need(NET, '测试环境里取不到 NET，联机回归断言无法执行（不能算通过）');
if (NET) {
  const realFetch = win.fetch;
  const realLoad = NET.load, realSave = NET.save, realClear = NET.clear;
  /* jsdom 在 file:// 下没有 localStorage，所以直接打桩 load() 造出"上次的身份"。
     不能真去写 localStorage —— 那样 tryReconnect 第一步读不到就返回 false，
     测试会"因为错误的原因通过"（这个坑我在拍卖测试里刚踩过一次）。 */
  NET.load = () => ({ room: 'ZZZZ', token: 'tok', seat: 1, name: '甲' });
  NET.save = () => {};
  let clearedFlag = false;
  NET.clear = function () { clearedFlag = true; return realClear.apply(this, arguments); };

  const stubJoins = (over) => {
    win.fetch = async (url) => {
      const u = String(url);
      if (u.indexOf('/api/join') >= 0) {
        return { ok: true, json: async () => ({ ok: true, room: 'ZZZZ', token: 'tok', seat: 1 }) };
      }
      if (u.indexOf('/api/state') >= 0) {
        return { ok: true, json: async () => ({ state: { game: JSON.stringify({ over, quarter: over ? 35 : 5 }) } }) };
      }
      return realFetch(url);
    };
  };

  /* ① 已结束的房间：必须拒绝重连，并且清掉身份 */
  clearedFlag = false;
  stubJoins(true);
  const back = await NET.tryReconnect();
  step.push('已结束房间 tryReconnect=' + back + '，清身份=' + clearedFlag);
  need(back === false, '对局已结束的房间竟然还自动重连回去了（玩家会被困在结算画面，开不了新局）');
  need(clearedFlag, '拒绝重连时没有清掉 dgs-net 身份，下次刷新还会被接回去');

  /* ② 对照：进行中的房间必须仍然能重连（别把正常重连一起挡坏） */
  clearedFlag = false;
  stubJoins(false);
  try { NET.disconnect(); NET.room = null; NET.token = null; } catch (e) {}
  const back2 = await NET.tryReconnect();
  step.push('进行中房间 tryReconnect=' + back2 + '，清身份=' + clearedFlag);
  need(back2 === true, '进行中的房间反而连不回去了（把正常重连挡坏了）');
  need(clearedFlag === false, '连正常房间时也把身份清掉了');

  try { NET.disconnect(); } catch (e) {}
  win.fetch = realFetch;
  NET.load = realLoad; NET.save = realSave; NET.clear = realClear;
}

console.log(JSON.stringify({ ok: problems.length === 0, 过程: step, 问题: problems }, null, 2));
process.exit(problems.length ? 1 : 0);
