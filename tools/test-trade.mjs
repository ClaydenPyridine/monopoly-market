/* 玩家间交易的真·联机端到端验证：真起服务端、两个客户端、走完整协议。
 * 覆盖：报价 → 对方收到 → 接受 → 资产真的换手；以及拒绝 / 撤回 / 非法报价。
 * 用法：node tools/test-trade.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 起一个专用测试服务端。
   ★ 两个坑都踩过：
     ① 固定端口 —— 上一轮的 server 还没释放端口，下一轮就连到**旧服务端**上，
        症状是"甲一直买不到地"这种莫名其妙的失败；
     ② 固定 sleep(1800) 等就绪 —— 机器一忙就不够。
   所以：随机高位端口 + 轮询 /api/rooms 直到真的起来。 */
const PORT = 8900 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const problems = [];
const ok = (c, m) => { if (!c) problems.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server.mjs', String(PORT)], {
  cwd: root,
  env: Object.assign({}, process.env, {
    DGS_T_ROLL: '60', DGS_T_TRADE: '60', DGS_GRACE: '60000', DGS_AI_DELAY: '50',
  }),
  stdio: 'ignore',
});
/* 等它真的开始监听（最多 15 秒） */
let ready = false;
for (let i = 0; i < 75; i++) {
  try {
    const r = await fetch(BASE + '/api/rooms');
    if (r.ok) { ready = true; break; }
  } catch { /* 还没起来 */ }
  await sleep(200);
}
if (!ready) {
  srv.kill();
  console.log(JSON.stringify({ ok: false, 问题: [`测试服务端没能在端口 ${PORT} 上起来`] }, null, 2));
  process.exit(1);
}

const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
};
const readState = async (room, token) => {
  const r = await fetch(`${BASE}/api/state?room=${room}&token=${encodeURIComponent(token)}`);
  return r.json();
};
const gameOf = s => { try { return JSON.parse(s.state.game); } catch { return null; } };

/* ★ 不要用固定 sleep 等状态变化 —— 机器一忙就飘（这台机器上实测过一次）。
   统一用轮询：条件成立就立刻返回，超时才判失败。 */
const waitFor = async (fn, ms = 8000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
};


try {
  /* ---- 建房：2 个真人 + 2 电脑 ---- */
  const a = await post('/api/create', { name: '甲' });
  const b = await post('/api/join', { room: a.room, name: '乙' });
  ok(a.ok && b.ok, '建房/加入失败');
  ok(b.seat === 1, '乙的座位不是 1，而是 ' + b.seat);
  await post('/api/start', { room: a.room, token: a.token, players: 4, quarters: 30 });
  await sleep(600);

  let st = await readState(a.room, a.token);
  let g = gameOf(st);
  ok(!!g, '开局后读不到对局');
  ok(g.players[0].name === '甲' && g.players[1].name === '乙', '座位名字不对');

  /* 先让甲拿到一块地（用管理接口塞不了地，所以直接驱动：甲的回合掷骰买地） */
  const drive = async (tok, who, onBuy) => {
    const cur = g.players[g.current];
    if (!cur || cur.name !== who) return false;
    if (g.phase === 'awaiting-roll') await post('/api/action', { room: a.room, token: tok, action: 'roll' });
    else if (g.phase === 'awaiting-buy') await post('/api/action', { room: a.room, token: tok, action: onBuy });
    else if (g.phase === 'awaiting-event') await post('/api/action', { room: a.room, token: tok, action: 'eventAck' });
    /* ★ 坐牢分支不能漏 —— 漏了的话这一回合永远推不动，循环空转到 guard 用完，
       然后 myTile 是 undefined 直接抛异常（踩过）。 */
    else if (g.phase === 'awaiting-jail') await post('/api/action', { room: a.room, token: tok, action: 'payJail' });
    else if (g.phase === 'awaiting-trade') await post('/api/action', { room: a.room, token: tok, action: 'endTurn' });
    return true;
  };
  let guard = 0;
  /* ★ 循环条件必须和下面要找的东西**完全一致**：要的是 type==='land' 的地。
     早先写成"甲有任何地块就停"，于是甲先买到传送锚点/元素站（type 是 rail/utility）
     循环就以为成了，myTile 却是 undefined —— 时红时绿全看骰子先踩到哪种，很难查。 */
  const ownsLand = () => g.tiles.some(t => t.owner === 0 && t.type === 'land');
  while (!ownsLand() && guard++ < 120) {
    const moved = await drive(a.token, '甲', 'buy');
    if (!moved) await drive(b.token, '乙', 'decline');
    await sleep(200);
    st = await readState(a.room, a.token);
    g = gameOf(st) || g;
    if (g.over) break;
  }
  const myTile = g.tiles.find(t => t.owner === 0 && t.type === 'land');
  ok(!!myTile, `甲一直没能买到地（跑了 ${guard} 轮，第 ${g.quarter} 季度，阶段 ${g.phase}，` +
    `甲名下地块 ${g.tiles.filter(t => t.owner === 0).map(t => t.name + '/' + t.type).join(',') || '无'}）`);
  if (!myTile) throw new Error('前置条件失败，后续断言无法进行');

  /* ---- 用例 1：报价 + 接受 → 地和钱都要换手 ---- */
  const price = 3000;
  const cashA0 = Math.round(g.players[0].cash), cashB0 = Math.round(g.players[1].cash);
  const r1 = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade',
    payload: { to: 1, give: { tiles: [myTile.id] }, want: { cash: price } },
  });
  ok(r1.ok, '甲发起报价失败：' + JSON.stringify(r1));
  const sawOffer = await waitFor(async () => {
    const ss = await readState(a.room, b.token);
    const gg = gameOf(ss);
    return (gg && gg.trade && gg.trade.status === 'pending') ? gg : null;
  });
  ok(!!sawOffer, '乙没等到待回应的报价');
  st = await readState(a.room, b.token); g = sawOffer || gameOf(st);
  ok(g.trade && g.trade.from === 0 && g.trade.to === 1, '报价双方不对：' + JSON.stringify(g.trade));

  /* 不是收款方的人不能应答 */
  const badResp = await post('/api/action', { room: a.room, token: a.token, action: 'respondTrade', payload: { accept: true } });
  ok(!badResp.ok, '发起人居然能自己接受自己的报价');

  const r2 = await post('/api/action', { room: a.room, token: b.token, action: 'respondTrade', payload: { accept: true } });
  ok(r2.ok, '乙接受失败：' + JSON.stringify(r2));
  const done1 = await waitFor(async () => {
    const ss = await readState(a.room, a.token);
    const gg = gameOf(ss);
    return (gg && gg.tiles.find(t => t.id === myTile.id).owner === 1) ? gg : null;
  });
  ok(!!done1, '成交后地块没换主人');
  st = await readState(a.room, a.token); g = done1 || gameOf(st);
  ok(Math.round(g.players[0].cash) === cashA0 + price, '甲没收到钱：' + cashA0 + ' → ' + g.players[0].cash);
  ok(Math.round(g.players[1].cash) === cashB0 - price, '乙没扣钱：' + cashB0 + ' → ' + g.players[1].cash);
  ok(!g.trade, '成交后报价没有被清掉');

  /* ---- 用例 2：拒绝 ---- */
  const r3 = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade',
    payload: { to: 1, give: { cash: 500 }, want: {} },
  });
  ok(r3.ok, '第二次报价失败：' + JSON.stringify(r3));
  await sleep(300);
  const r4 = await post('/api/action', { room: a.room, token: b.token, action: 'respondTrade', payload: { accept: false } });
  ok(r4.ok, '乙拒绝失败');
  const gone1 = await waitFor(async () => {
    const gg = gameOf(await readState(a.room, a.token));
    return (gg && !gg.trade) ? gg : null;
  });
  ok(!!gone1, '拒绝后报价应该清空');

  /* ---- 用例 3：非法报价要被挡住 ---- */
  const rNotMine = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade',
    payload: { to: 1, give: { tiles: [g.tiles.find(t => t.owner === 1).id] }, want: {} },
  });
  ok(!rNotMine.ok, '拿别人的地报价居然成功了');
  const rEmpty = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade', payload: { to: 1, give: {}, want: {} },
  });
  ok(!rEmpty.ok, '空报价居然成功了');
  const rTooMuch = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade',
    payload: { to: 1, give: { cash: 99999999 }, want: {} },
  });
  ok(!rTooMuch.ok, '现金不足的报价居然成功了');
  const rSelf = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade', payload: { to: 0, give: { cash: 100 }, want: {} },
  });
  ok(!rSelf.ok, '和自己交易居然成功了');

  /* ---- 用例 4：同时只允许一笔待回应报价 ---- */
  const ok1 = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade', payload: { to: 1, give: { cash: 100 }, want: {} },
  });
  ok(ok1.ok, '清空后重新报价失败：' + JSON.stringify(ok1));
  const ok2 = await post('/api/action', {
    room: a.room, token: a.token, action: 'proposeTrade', payload: { to: 1, give: { cash: 200 }, want: {} },
  });
  ok(!ok2.ok, '居然允许同时挂两笔报价');
  await post('/api/action', { room: a.room, token: a.token, action: 'cancelTrade', payload: {} });
  const gone2 = await waitFor(async () => {
    const gg = gameOf(await readState(a.room, a.token));
    return (gg && !gg.trade) ? gg : null;
  });
  ok(!!gone2, '撤回后报价应该清空');

  /* ---- 用例 5：地租分红权 ---- */
  const r5 = await post('/api/action', {
    room: a.room, token: b.token, action: 'proposeTrade',
    payload: { to: 0, give: { rentShares: [{ tileId: myTile.id, pct: 30 }] }, want: { cash: 800 } },
  });
  ok(r5.ok, '分红权报价失败：' + JSON.stringify(r5));
  await sleep(300);
  const r6 = await post('/api/action', { room: a.room, token: a.token, action: 'respondTrade', payload: { accept: true } });
  ok(r6.ok, '分红权成交失败：' + JSON.stringify(r6));
  const hasShare = await waitFor(async () => {
    const gg = gameOf(await readState(a.room, a.token));
    return (gg && gg.tiles.find(t => t.id === myTile.id).rentShare) ? gg : null;
  });
  ok(!!hasShare, '分红权没记到地块上');
  st = await readState(a.room, a.token); g = hasShare || gameOf(st);
  const t2 = g.tiles.find(t => t.id === myTile.id);
  ok(t2.rentShare && t2.rentShare.pct === 30 && t2.rentShare.to === 0, '分红权内容不对：' + JSON.stringify(t2.rentShare));
  const r7 = await post('/api/action', {
    room: a.room, token: b.token, action: 'proposeTrade',
    payload: { to: 0, give: { rentShares: [{ tileId: myTile.id, pct: 20 }] }, want: { cash: 100 } },
  });
  /* 已经卖掉的分红权不允许再卖一次（proposeTrade 阶段就会挡住，比等到接受更早） */
  ok(!r7.ok, '已经卖过的分红权居然还能再报价一次');
  await sleep(200);
  st = await readState(a.room, a.token);
  g = gameOf(st);
  ok(g.tiles.find(t => t.id === myTile.id).rentShare.pct === 30, '分红权被第二次报价改掉了');

} catch (e) {
  problems.push('抛异常：' + (e && e.stack || e));
} finally {
  srv.kill();
}

console.log(JSON.stringify({ ok: problems.length === 0, 问题: problems }, null, 2));
process.exit(problems.length ? 1 : 0);
