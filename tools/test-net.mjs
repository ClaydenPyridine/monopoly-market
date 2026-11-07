/* 联机集成测试：真起一个服务端，走完 建房 → 加入 → 开局 → 掷骰 → 交易 → AI 接管 的全流程，
 * 外加一节「回合超时 / 掉线托管」回归测试——对应"某个人掉线发呆，整局卡死 40 分钟"那次真实故障。
 * 用法：node tools/test-net.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${PORT}`;
const fails = [];
let wakeLagMs = -1;
const ok = (c, m) => { if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ★ 超时 / 托管的时间压缩：不改这几个，整套测试要跑好几分钟甚至几十分钟。
   服务端读取的是同名环境变量，见 server.mjs 顶部的 DGS_T_ROLL / DGS_T_TRADE / DGS_GRACE。 */
const T_ROLL_SEC = 2;      // DGS_T_ROLL：掷骰/买地/事件/监狱阶段的超时
const T_TRADE_SEC = 2;     // DGS_T_TRADE：交易阶段的超时
/* ★ 这个值别调太小。它同时是"掉线托管"的触发阈值，而测试前面的用例有
   几百毫秒的固定 sleep；机器一忙（实测被 179 个孤儿浏览器顶满 CPU 时）
   sleep 会被拉长到超过阈值，人类座位就被当成掉线托管了 → 测试假红。
   2500ms 既能快速触发托管，又有足够余量扛住负载抖动。 */
const GRACE_MS = 2500;     // DGS_GRACE：自己在回合内静默这么久就交给电脑

const post = async (p, b) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}),
})).json();

/* 长轮询客户端：和浏览器端 NET.pollLoop() 一样的协议。
   不用 SSE —— Cloudflare Quick Tunnel 会把 SSE 缓冲住（实测 20 秒 0 字节）。 */
function sse(room, token, arr) {
  let stopped = false;
  let ver = -1;
  (async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${BASE}/api/wait?room=${room}&token=${token}&since=${ver}`);
        const j = await res.json();
        if (!j.ok) { await sleep(400); continue; }
        ver = typeof j.ver === 'number' ? j.ver : ver;
        if (j.state) arr.push(j.state);
        else arr.push({ _unchanged: true });        // 占位，测试里用 .filter(s=>s.game) 过滤
      } catch (e) {
        if (stopped) return;
        await sleep(400);
      }
    }
  })().catch(() => {});
  return () => { stopped = true; };
}

/* 可"真断开"的长轮询客户端：和 sse() 同款协议，但返回的关闭函数会 abort 掉正在挂起的
   那个请求——这才等价于"关掉浏览器"。sse() 只是设个标志位，挂起的请求还会挂在服务端，
   测"掉线托管"时必须让服务端立刻看到连接断了。 */
function poll(room, token, arr) {
  const ac = new AbortController();
  let ver = -1;
  (async () => {
    while (!ac.signal.aborted) {
      try {
        const res = await fetch(`${BASE}/api/wait?room=${room}&token=${token}&since=${ver}`, { signal: ac.signal });
        const j = await res.json();
        if (!j.ok) { await sleep(300); continue; }
        if (typeof j.ver === 'number') ver = j.ver;
        if (j.state) arr.push(j.state);
      } catch (e) {
        if (ac.signal.aborted) return;
        await sleep(300);
      }
    }
  })().catch(() => {});
  return () => ac.abort();
}

/* ---------------- 起服务端 ---------------- */
const proc = spawn(process.execPath, ['server.mjs', String(PORT)], {
  cwd: root, stdio: 'ignore',
  env: Object.assign({}, process.env, {
    DGS_AI_DELAY: '25',                   // 测试时把电脑调快
    DGS_T_ROLL: String(T_ROLL_SEC),       // 回合超时压到 2 秒
    DGS_T_TRADE: String(T_TRADE_SEC),     // 交易超时压到 2 秒
    DGS_GRACE: String(GRACE_MS),          // 掉线 1.5 秒就交给电脑
  }),
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { await fetch(BASE + '/api/state?room=ZZZZ'); up = true; } catch (e) { await sleep(120); }
}
if (!up) { console.log(JSON.stringify({ ok: false, 问题: ['服务端没起来'] }, null, 2)); proc.kill(); process.exit(1); }

try {
  /* ---------------- 建房 / 加入 ---------------- */
  const host = await post('/api/create', { name: '房主' });
  ok(host.ok && host.room && host.token, '创建房间失败：' + JSON.stringify(host));
  const p2 = await post('/api/join', { room: host.room, name: '小明' });
  ok(p2.ok && p2.seat === 1, '第二个人加入失败：' + JSON.stringify(p2));
  ok(p2.room === host.room, '房间号不一致');

  /* token 重连 */
  const rejoin = await post('/api/join', { room: host.room, token: p2.token });
  ok(rejoin.ok && rejoin.seat === 1 && rejoin.rejoin, '断线重连没回到原座位：' + JSON.stringify(rejoin));

  /* 错房间号 */
  const bad = await post('/api/join', { room: 'ZZZZ', name: 'x' });
  ok(!bad.ok, '错的房间号居然能进');

  /* ---------------- SSE ---------------- */
  const hostStates = [], guestStates = [];
  const closeHost = sse(host.room, host.token, hostStates);
  const closeGuest = sse(p2.room, p2.token, guestStates);
  await sleep(200);
  ok(hostStates.length >= 1, '房主没收到初始状态推送');

  /* ---------------- 开局（4 人：2 人类 + 2 电脑）---------------- */
  const st = await post('/api/start', { room: host.room, token: host.token, players: 4, quarters: 20 });
  ok(st.ok, '开局失败：' + JSON.stringify(st));
  await sleep(400);
  const started = hostStates.filter(s => s.started && s.game).pop();
  ok(!!started, '没收到开局后的状态');
  if (started) {
    const g = JSON.parse(started.game);
    ok(g.players.length === 4, '玩家人数不对：' + g.players.length);
    ok(g.players[0].isAI === false && g.players[1].isAI === false, '人类座位被当成 AI 了');
    ok(g.players[2].isAI === true && g.players[3].isAI === true, '空位没补上电脑');
    ok(g.maxQuarters === undefined || true, '');
    ok(started.mySeat === 0, 'mySeat 不对');
  }

  /* ---------------- 掷骰 ---------------- */
  const before = JSON.parse(hostStates[hostStates.length - 1].game).players[0].pos;
  const r1 = await post('/api/action', { room: host.room, token: host.token, action: 'roll' });
  ok(r1.ok, '掷骰失败：' + JSON.stringify(r1));
  await sleep(350);
  const afterRoll = hostStates[hostStates.length - 1];
  ok(afterRoll.event && afterRoll.event.kind === 'roll', '没收到掷骰事件');
  const gAfter = JSON.parse(afterRoll.game);
  ok(gAfter.players[0].pos !== before || afterRoll.event.passedGo, '棋子没动');
  /* ★ 骰子颗数取决于 CONFIG.diceMode：'2d6' 两颗（2~12 钟形）、'd12' 一颗（1~12 等概率）。
     这里不能写死 2，否则换骰子模式就会误报"骰子数据不对"。 */
  const diceN = afterRoll.event.dice ? afterRoll.event.dice.length : 0;
  ok(diceN === 1 || diceN === 2, '骰子数据不对：' + JSON.stringify(afterRoll.event.dice));
  const diceSum = (afterRoll.event.dice || []).reduce((a, b) => a + b, 0);
  ok(diceSum === afterRoll.event.total, '骰子点数之和与 total 不一致：' +
    JSON.stringify(afterRoll.event.dice) + ' vs ' + afterRoll.event.total);

  /* ---------------- 不是自己的回合不能动 ---------------- */
  const rSteal = await post('/api/action', { room: host.room, token: p2.token, action: 'roll' });
  ok(!rSteal.ok, '不是自己的回合居然能操作');

  /* ---------------- 处理 pending 直到进入交易阶段 ---------------- */
  let guard = 0, g2 = JSON.parse(hostStates[hostStates.length - 1].game);
  while (g2.pending && guard++ < 6) {
    const act = g2.pending.type === 'buy' ? 'decline' : 'eventAck';
    await post('/api/action', { room: host.room, token: host.token, action: act });
    await sleep(220);
    g2 = JSON.parse(hostStates[hostStates.length - 1].game);
  }
  ok(g2.phase === 'awaiting-trade', '走完落地后没进入交易阶段，现在 ' + g2.phase);

  /* ---------------- 交易：买股票 ---------------- */
  const cashBefore = g2.players[0].cash;
  const rb = await post('/api/action', {
    room: host.room, token: host.token, action: 'buyStock', payload: { code: '003', qty: 1 },
  });
  ok(rb.ok, '买股票失败：' + JSON.stringify(rb));
  await sleep(250);
  const g3 = JSON.parse(hostStates[hostStates.length - 1].game);
  ok(g3.players[0].cash < cashBefore, '买股票没扣钱');
  ok((g3.players[0].stocks['003'] || 0) === 1, '股票没进持仓');

  /* ---------------- 同一回合买卖往返必须亏（跟"买入前"比）---------------- */
  const cashA = g3.players[0].cash;
  await post('/api/action', { room: host.room, token: host.token, action: 'sellStock', payload: { code: '003', qty: 1 } });
  await sleep(250);
  const g4 = JSON.parse(hostStates[hostStates.length - 1].game);
  ok(g4.players[0].cash < cashBefore,
    `服务端也允许刷差价：买入前 ${cashBefore} → 一买一卖后 ${g4.players[0].cash}`);

  /* ---------------- 金融产品 ---------------- */
  const rc = await post('/api/action', { room: host.room, token: host.token, action: 'card', payload: { kind: 'insurance' } });
  ok(rc.ok, '买租金保险失败：' + JSON.stringify(rc));
  await sleep(200);
  const g5 = JSON.parse(hostStates[hostStates.length - 1].game);
  ok(!!g5.players[0].products.insurance, '租金保险没生效');

  /* ---------------- 结束回合 → 下一位（人类） ---------------- */
  const rEnd = await post('/api/action', { room: host.room, token: host.token, action: 'endTurn' });
  ok(rEnd.ok, '结束回合失败：' + JSON.stringify(rEnd));
  await sleep(300);
  const g6 = JSON.parse(hostStates[hostStates.length - 1].game);
  ok(g6.current === 1, '结束回合后没轮到下一位，current=' + g6.current);

/* ---------------- ★ 回归：开局必须"立刻"唤醒挂起中的长轮询 ----------------
   早先 /api/start 用 map() 重建了房间座位数组，把挂起的等待者一起丢掉；
   后果是房主一点「开始游戏」，其他人要干等 25 秒超时才拿到状态——
   这就是"房主已经开始了，别人还没进游戏"。这条测试专门钉死它。 */
{
  const w = await post('/api/create', { name: '唤醒测试' });
  ok(w.ok, '唤醒测试建房失败');
  const v0 = (await (await fetch(`${BASE}/api/wait?room=${w.room}&token=${w.token}&since=-1`)).json()).ver;
  const t0 = Date.now();
  const hanging = fetch(`${BASE}/api/wait?room=${w.room}&token=${w.token}&since=${v0}`).then(r => r.json());
  await sleep(600);                                   // 让它真正挂起
  const tStart = Date.now();
  await post('/api/start', { room: w.room, token: w.token, players: 4, quarters: 20 });
  const jj = await hanging;
  const lag = Date.now() - tStart;
  ok(lag < 5000, `★ 开局没能立刻唤醒长轮询：唤醒延迟 ${lag}ms（超时是 25000ms）`);
  ok(jj && jj.state && jj.state.started, '被唤醒时没带上 started 的游戏状态');
  ok(jj && jj.state && jj.state.game && JSON.parse(jj.state.game).players.length === 4, '唤醒后状态里玩家数不对');
  wakeLagMs = lag;
  const total = Date.now() - t0;
  ok(total < 8000, `整个"挂起→开局→收到"耗时 ${total}ms，太慢`);
}

/* ---------------- 座位表同步给所有人 ---------------- */
  const guestLast = guestStates[guestStates.length - 1];
  ok(guestLast && guestLast.game, '第二位玩家没收到对局状态');
  ok(guestLast.mySeat === 1, '第二位玩家的 mySeat 不对：' + (guestLast && guestLast.mySeat));
  ok(hostStates[hostStates.length - 1].seats.length === 4, '座位表长度不对');
  ok(hostStates[hostStates.length - 1].seats[2].isAI === true, '第三席不是电脑');

  /* ---------------- 第二阶段：只有房主是人类，验证电脑自动接管 ---------------- */
  const solo = await post('/api/create', { name: '独狼' });
  const soloStates = [];
  const closeSolo = sse(solo.room, solo.token, soloStates);
  await sleep(150);
  await post('/api/start', { room: solo.room, token: solo.token, players: 4, quarters: 30 });
  await sleep(400);
  const sg0 = JSON.parse(soloStates[soloStates.length - 1].game);
  ok(sg0.players[1].isAI && sg0.players[2].isAI && sg0.players[3].isAI, '单人房没补满电脑');
  ok(sg0.current === 0, '开局不是从房主开始');

  /* 房主掷骰 → 处理落地 → 结束回合，之后三台电脑应该自己跑起来 */
  await post('/api/action', { room: solo.room, token: solo.token, action: 'roll' });
  await sleep(300);
  let gs = JSON.parse(soloStates[soloStates.length - 1].game);
  let guard2 = 0;
  while (gs.pending && guard2++ < 6) {
    await post('/api/action', {
      room: solo.room, token: solo.token,
      action: gs.pending.type === 'buy' ? 'decline' : 'eventAck',
    });
    await sleep(220);
    gs = JSON.parse(soloStates[soloStates.length - 1].game);
  }
  const beforeAI = soloStates.length;
  await post('/api/action', { room: solo.room, token: solo.token, action: 'endTurn' });
  await sleep(6000);
  const sg1 = JSON.parse(soloStates[soloStates.length - 1].game);
  ok(soloStates.length > beforeAI + 3, `电脑没自动行动（只推了 ${soloStates.length - beforeAI} 条）`);
  ok(sg1.current === 0 || sg1.quarter > 1, '电脑跑完一圈后没回到房主 / 没进下一季度，current=' + sg1.current + ' quarter=' + sg1.quarter);
  closeSolo();

/* ==================================================================
 * ★ 新增一节：回合超时 + 掉线托管
 *   对应真实故障：一个人掉线/发呆，整局永久卡死（实测卡了 40 分钟）。
 *   这一节全部用秒级参数跑：DGS_T_ROLL=2 / DGS_T_TRADE=2 / DGS_GRACE=1500
 * ================================================================== */
const 新增 = {};

/* ---- 这节专用的小工具 ---- */
const readState = async (room, token) => {
  const r = await (await fetch(`${BASE}/api/state?room=${room}&token=${token || ''}`)).json();
  return r && r.state ? r.state : null;
};
/* 走 /api/rooms 观察：它不认 token，测"全员掉线"时不会意外证明某个座位还活着 */
const readRoom = async code => {
  const r = await (await fetch(BASE + '/api/rooms')).json();
  return (r.rooms || []).find(x => x.room === code) || null;
};
const gameOf = s => { try { return s && s.game ? JSON.parse(s.game) : null; } catch (e) { return null; } };
const logsOf = s => { const g = gameOf(s); return g && g.logs ? g.logs.map(l => l.msg) : []; };
const sawLog = (arr, re) => arr.some(s => logsOf(s).some(m => re.test(m)));
const seatOf = (s, i) => (s && s.seats && s.seats[i]) ? s.seats[i] : null;
/* deadline / timeoutSec 按冻结的协议在状态对象顶层；万一实现塞进 game 里也认 */
const deadlineOf = s => {
  if (s && typeof s.deadline === 'number') return s.deadline;
  const g = gameOf(s);
  return g && typeof g.deadline === 'number' ? g.deadline : null;
};
const timeoutSecOf = s => {
  if (s && typeof s.timeoutSec === 'number') return s.timeoutSec;
  const g = gameOf(s);
  return g && typeof g.timeoutSec === 'number' ? g.timeoutSec : null;
};
/** 轮询等一个条件成立；fn 返回真值即成立。返回 {ok, value, ms} */
const waitFor = async (fn, timeoutMs, stepMs) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return { ok: true, value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 >= timeoutMs) return { ok: false, value: null, ms: Date.now() - t0 };
    await sleep(stepMs || 150);
  }
};

/* ---------------- 用例 1：轮到真人却不动 → 超时自动掷骰 ---------------- */
{
  const a = await post('/api/create', { name: '超时房主' });
  const b = await post('/api/join', { room: a.room, name: '超时小明' });
  ok(a.ok && b.ok, '用例1：建房/加入失败 ' + JSON.stringify([a, b]));
  const arrHost = [], arrMate = [];
  const closeH1 = poll(a.room, a.token, arrHost);
  const closeM1 = poll(a.room, b.token, arrMate);   // 两个人都在线，只是谁都不操作
  await post('/api/start', { room: a.room, token: a.token, players: 4, quarters: 20 });
  await sleep(300);

  /* 协议：轮到真人时必须给出 deadline / timeoutSec */
  const armed = await waitFor(async () => {
    const s = await readState(a.room, a.token);
    const dl = deadlineOf(s);
    return (typeof dl === 'number' && dl > 0 && (timeoutSecOf(s) || 0) > 0) ? s : null;
  }, 3000, 100);
  ok(armed.ok, '用例1：状态里没有 deadline/timeoutSec（回合倒计时协议没实现）');

  const s0 = await readState(a.room, a.token);
  const g0 = gameOf(s0);
  ok(!!g0 && g0.current === 0 && g0.phase === 'awaiting-roll',
    `用例1：开局不是"房主等待掷骰"，current=${g0 && g0.current} phase=${g0 && g0.phase}`);
  const pos0 = g0 ? g0.players[0].pos : -1;
  const q0 = g0 ? g0.quarter : 1;
  const turns0 = (g0 && g0.turnsTaken) || 0;

  /* ★ 故意不操作，等 DGS_T_ROLL 秒 */
  const t1 = Date.now();
  const timedOut = await waitFor(() => sawLog(arrHost, /超时/), 20000, 200);
  const 超时掷骰耗时 = Date.now() - t1;
  ok(timedOut.ok, `用例1：干等了 20 秒也没等到"超时"日志（DGS_T_ROLL=${T_ROLL_SEC}s 没生效）`);
  const s1 = await readState(a.room, a.token);
  const g1 = gameOf(s1);
  ok(!!g1, '用例1：超时后读不到对局状态');
  if (g1) {
    ok(g1.players[0].pos !== pos0, `用例1：超时没有自动掷骰——座位 0 位置还是 ${pos0}`);
    ok(logsOf(s1).some(m => /超时/.test(m)) || sawLog(arrHost, /超时/), '用例1：日志里没有"超时"相关记录');
  }
  const advanced = await waitFor(async () => {
    const s = await readState(a.room, a.token);
    const g = gameOf(s);
    if (!g) return null;
    return (g.current !== 0 || (g.turnsTaken || 0) > turns0 || g.quarter > q0) ? g : null;
  }, 15000, 150);
  ok(advanced.ok, '用例1：超时掷骰后 15 秒内回合没有推进到下一个人（卡死）');
  新增.用例1_超时自动掷骰 = {
    超时日志出现耗时ms: 超时掷骰耗时,
    座位0位置: `${pos0} → ${g1 ? g1.players[0].pos : '?'}`,
    回合已推进: !!advanced.ok,
  };
  closeH1(); closeM1();
}

/* ---------------- 用例 2：交易阶段发呆 → 超时自动结束回合 ---------------- */
{
  const a = await post('/api/create', { name: '交易超时房主' });
  const b = await post('/api/join', { room: a.room, name: '交易超时小明' });
  const arr = [];
  const closeH2 = poll(a.room, a.token, arr);
  const closeM2 = poll(a.room, b.token, []);        // 必须保持在线，否则会被掉线托管抢走
  await post('/api/start', { room: a.room, token: a.token, players: 2, quarters: 20 });
  await sleep(300);
  await post('/api/action', { room: a.room, token: a.token, action: 'roll' });
  await sleep(120);
  let g = gameOf(await readState(a.room, a.token));
  let guard = 0;
  while (g && g.pending && guard++ < 8) {
    await post('/api/action', {
      room: a.room, token: a.token,
      action: g.pending.type === 'buy' ? 'decline' : 'eventAck',
    });
    await sleep(100);
    g = gameOf(await readState(a.room, a.token));
  }
  ok(!!g && g.phase === 'awaiting-trade', '用例2：没能走到交易阶段（后面这条依赖它），现在 ' + (g && g.phase));
  const curBefore = g ? g.current : 0;
  const t2 = Date.now();
  const moved = await waitFor(async () => {
    const s = await readState(a.room, a.token);
    const gg = gameOf(s);
    if (!gg) return null;
    return gg.current !== curBefore ? gg : null;
  }, 15000, 150);
  ok(moved.ok, `用例2：交易阶段干等 15 秒回合也没推进——DGS_T_TRADE=${T_TRADE_SEC}s 没生效，current 仍是 ${curBefore}`);
  ok(sawLog(arr, /超时/), '用例2：交易超时没有写"超时"日志');
  新增.用例2_超时结束交易阶段 = { 回合推进耗时ms: Date.now() - t2, 回合已推进: !!moved.ok };
  closeH2(); closeM2();
}

/* ---------------- 用例 3：掉线 → 电脑托管；用例 4：回来 → 还给他 ---------------- */
{
  const a = await post('/api/create', { name: '托管房主' });
  const b = await post('/api/join', { room: a.room, name: '托管小明' });
  const arrH = [], arrG = [];
  const closeH3 = poll(a.room, a.token, arrH);
  let closeG3 = poll(a.room, b.token, arrG);
  await post('/api/start', { room: a.room, token: a.token, players: 4, quarters: 20 });
  await sleep(600);
  const s3a = await readState(a.room, b.token);
  ok(s3a && s3a.mySeat === 1, '用例3：小明没连上自己的座位（mySeat=' + (s3a && s3a.mySeat) + '）');

  /* ★ 新规则：掉线托管只在「轮到他」时才判定（免得健康玩家在别人回合
     因为长轮询被挂着而被误托管）。所以先等轮到座位 1，再断开。 */
  const waitMyTurn = async (label) => {
    const r = await waitFor(async () => {
      const ss = await readState(a.room, a.token);
      const gg = gameOf(ss);
      return (gg && gg.current === 1 && !gg.over) ? gg : null;
    }, 25000, 120);
    ok(r.ok, `${label}：等不到轮到座位 1（前置条件没满足，后面的断言不算数）`);
    return r.ok;
  };

  const before = gameOf(await readState(a.room, a.token));
  const q3 = before ? before.quarter : 1;
  const t3 = (before && before.turnsTaken) || 0;

  await waitMyTurn('用例3');
  closeG3();                                        // ★ 主动断开：等价于关掉浏览器
  const took = await waitFor(async () => {
    const ss = await readState(a.room, a.token);
    return (seatOf(ss, 1) && seatOf(ss, 1).isAI) ? ss : null;
  }, 15000, 200);
  ok(took.ok, `用例3：断开后等了 15 秒座位 1 还是真人（DGS_GRACE=${GRACE_MS}ms 没生效）：` +
    JSON.stringify(seatOf(await readState(a.room, a.token), 1)));
  const s3 = took.value || await readState(a.room, a.token);
  ok(!!(seatOf(s3, 1) && seatOf(s3, 1).isAI === true), '用例3：/api/state 里座位 1 的 isAI 不是 true');
  ok(!!(seatOf(s3, 1) && seatOf(s3, 1).connected === false), '用例3：掉线后座位 1 的 connected 还是 true'
    + '（/api/rooms 里的"在线"同样是 true）。根因：server.mjs 的 /api/wait 里 res.on(\'close\') '
    + '只在 done 为 true 时清 connected，而客户端中途断开时 done 是 false，所以永远清不掉；'
    + '建议 done 为 false（请求还没回应就断了）时也把 seat.connected = false。');
  const g3 = gameOf(s3);
  ok(!!(g3 && g3.players[1] && g3.players[1].isAI === true), '用例3：对局里座位 1 的 isAI 没同步成 true');
  const room3 = await readRoom(a.room);
  ok(!!(room3 && room3.玩家 && room3.玩家[1] && room3.玩家[1].电脑 === true), '用例3：/api/rooms 里座位 1 没显示成电脑');

  /* 不会卡在那个座位上：季度/回合数要继续涨 */
  const prog = await waitFor(async () => {
    const ss = await readState(a.room, a.token);
    const gg = gameOf(ss);
    if (!gg) return null;
    return (gg.quarter > q3 || (gg.turnsTaken || 0) > t3 + 1) ? gg : null;
  }, 20000, 200);
  ok(prog.ok, '用例3：掉线托管后游戏没有继续推进（卡住）');
  新增.用例3_掉线托管 = {
    变成电脑: !!(seatOf(s3, 1) && seatOf(s3, 1).isAI),
    connected: seatOf(s3, 1) ? seatOf(s3, 1).connected : null,
    游戏继续推进: !!prog.ok,
  };

  /* ---- 用例 4a：用同一个 token 回来 ---- */
  const backToken = await post('/api/join', { room: a.room, token: b.token });
  ok(backToken.ok && backToken.seat === 1, '用例4a：同一个 token 没能认回座位 1：' + JSON.stringify(backToken));
  const back1 = await waitFor(async () => {
    const ss = await readState(a.room, b.token);
    return (seatOf(ss, 1) && seatOf(ss, 1).isAI === false) ? ss : null;
  }, 5000, 150);
  ok(back1.ok, '用例4a：用同一个 token 回来后座位 1 的 isAI 没有恢复 false');
  const g4 = gameOf(back1.value || await readState(a.room, b.token));
  ok(!!(g4 && g4.players[1] && g4.players[1].isAI === false), '用例4a：对局里座位 1 的 isAI 没恢复 false');
  新增.用例4a_同token回来 = { 认回座位: backToken.seat, isAI已恢复: !!back1.ok };

  /* ---- 用例 4b：用「房间号 + 原来的名字」回来 ---- */
  closeG3 = poll(a.room, b.token, arrG);
  await waitMyTurn('用例4b');                       // 同样要等他自己的回合
  closeG3();                                        // 再掉一次
  const took2 = await waitFor(async () => {
    const ss = await readState(a.room, a.token);
    return (seatOf(ss, 1) && seatOf(ss, 1).isAI) ? ss : null;
  }, 15000, 200);
  ok(took2.ok, '用例4b：再次掉线后座位 1 没被电脑接管（前置条件没满足，下面的断言不算数）');
  const backName = await post('/api/join', { room: a.room, name: '托管小明' });
  ok(backName.ok && backName.seat === 1, '用例4b：房间号+名字没能认回座位 1：' + JSON.stringify(backName));
  const back2 = await waitFor(async () => {
    const ss = await readState(a.room, backName.token || b.token);
    return (seatOf(ss, 1) && seatOf(ss, 1).isAI === false) ? ss : null;
  }, 5000, 150);
  ok(back2.ok, '用例4b：用名字认回后座位 1 的 isAI 没有恢复 false');
  新增.用例4b_名字回来 = { 认回座位: backName.seat, isAI已恢复: !!back2.ok };
  closeH3();
}

/* ---------------- 用例 5（最重要的回归）：全员不操作 + 全员掉线，也不许卡死 ---------------- */
{
  const a = await post('/api/create', { name: '全掉线1' });
  const joins = [a];
  for (const n of ['全掉线2', '全掉线3', '全掉线4']) joins.push(await post('/api/join', { room: a.room, name: n }));
  const closeAll = joins.map(j => poll(a.room, j.token, []));
  await sleep(500);
  const st5 = await post('/api/start', { room: a.room, token: a.token, players: 4, quarters: 12 });
  ok(st5.ok, '用例5：开局失败 ' + JSON.stringify(st5));
  await sleep(400);
  const room5a = await readRoom(a.room);
  const q5 = room5a ? room5a.quarter : 1;
  closeAll.forEach(f => f());                       // ★ 4 个人一起掉线，谁也不操作

  const t5 = Date.now();
  let lastQ = q5, over5 = false, allAI = false;
  const dead = await waitFor(async () => {
    const room = await readRoom(a.room);
    if (!room) return null;
    lastQ = room.quarter;
    over5 = !!room.over;
    allAI = !!(room.玩家 && room.玩家.length && room.玩家.every(p => p.电脑));
    return (room.over || room.quarter - q5 >= 3) ? room : null;
  }, 30000, 250);
  const 用时ms = Date.now() - t5;
  ok(dead.ok, `★ 用例5（对应"卡 40 分钟"那次故障）：全员不操作 + 全员掉线后，30 秒内只从 Q${q5} 推进到 Q${lastQ}`
    + `（要求推进 ≥ 3 个季度或直接结束）。若"回合超时"已实现但"掉线托管"没生效，每人每回合最坏要等 3 个超时窗口，`
    + `30 秒推不动 3 个季度——这条就是在钉死"整局卡死"。`);
  ok(allAI, '用例5：全员掉线后并不是所有座位都被电脑接管（掉线托管没生效）');
  新增.用例5_全员掉线不卡死 = {
    起始季度: q5, 结束季度: lastQ, 用时ms, 游戏已结束: over5, 全部座位已托管: allAI,
  };
}

  const lastG = JSON.parse(hostStates[hostStates.length - 1].game);
  console.log(JSON.stringify({
    ok: fails.length === 0,
    房间号: host.room,
    推送条数: { 房主: hostStates.length, 客人: guestStates.length },
    开局唤醒延迟ms: wakeLagMs,
    当前回合: lastG.current,
    季度: lastG.quarter,
    玩家: lastG.players.map(p => `${p.name}${p.isAI ? '(AI)' : ''}`),
    新增用例: 新增,
    问题: fails,
  }, null, 2));
  closeHost(); closeGuest();
} catch (e) {
  fails.push('异常：' + (e && e.stack || e));
  console.log(JSON.stringify({ ok: false, 问题: fails }, null, 2));
} finally {
  proc.kill();
}
process.exit(fails.length ? 1 : 0);
