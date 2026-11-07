/* ============================================================
 * 地产股神 · 联机服务端（零依赖，只用 node:http）
 *
 *   node server.mjs            # 默认 http://0.0.0.0:8787
 *   node server.mjs 9000
 *
 * 局域网：同 WiFi 的朋友浏览器打开 http://<你的内网IP>:8787
 * 异地：见 README 的「异地联机」一节（Tailscale / cloudflared）
 *
 * 协议：SSE 推状态 + POST 发操作。权威状态在服务端，AI 也由服务端驱动。
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || '8787', 10);
/* 电脑每步之间的间隔，测试时可以调快：DGS_AI_DELAY=40 node server.mjs */
const AI_DELAY = Math.max(10, parseInt(process.env.DGS_AI_DELAY || '700', 10));
/* 单文件版：首页直接发它，1 次请求搞定（源码版要 7 次） */
const BUNDLE = path.join(root, 'dist', '地产股神.html');
const hasBundle = fs.existsSync(BUNDLE);

/* ---------------- 回合超时 / 掉线托管 ----------------
   为什么要有：真实发生过一局因为某个玩家掉线，整局卡死 40 分钟。
   超时秒数按实测的玩家思考时长定：
     掷骰/买地/事件/监狱 —— 真人 P99 才 59 秒，90 秒几乎不误伤
     交易阶段           —— 真人中位 54 秒、P99 207 秒，所以给 180 秒 */
const T_ROLL = Math.max(1, parseInt(process.env.DGS_T_ROLL || '90', 10));
const T_TRADE = Math.max(1, parseInt(process.env.DGS_T_TRADE || '180', 10));
/* 掉线超过这么久就交给电脑接管。
   ★ 只在「轮到他 + 静默这么久」时才判定，不是随时盯着每个人。
   ★ 另外：有挂起中的长轮询一定算"人在"——长轮询最多会被挂 25 秒，
     如果只看 lastSeen，健康玩家会被误判掉线（这个坑踩过一次）。 */
const GRACE = Math.max(500, parseInt(process.env.DGS_GRACE || '60000', 10));
/* 每次推送只带最后 N 条日志，否则状态包会有 3/4 是无用的历史 */
const WIRE_LOGS = parseInt(process.env.DGS_WIRE_LOGS || '120', 10);
/* 断线救援：node server.mjs 8787 --restore logs/存档-XXXX-Q14.json
   会把存档里的对局原样恢复，并把标记了「接管」的座位交给电脑。 */
const RESTORE_FILE = (() => {
  const i = process.argv.indexOf('--restore');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
/* 补偿/发钱：node server.mjs 8787 --restore 存档.json --pay "名字=40000"
   可以传多次。启动时一次性发到位，省得为了改一笔钱重启两次。 */
const PAY_ARGS = (() => {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--pay' && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
})();

/* ---------------- 把游戏代码装进 VM ---------------- */
const ctx = {
  console, Math, JSON, Object, Array, String, Number, Boolean, Date, isNaN,
  parseInt, parseFloat, setTimeout, clearTimeout,
};
vm.createContext(ctx);
for (const f of ['src/data.js', 'src/engine.js', 'src/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const Game = vm.runInContext('Game', ctx);
const AI = vm.runInContext('AI', ctx);
const CONFIG = vm.runInContext('CONFIG', ctx);

/* ---------------- 房间 ---------------- */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let c = '';
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(c));
  return c;
}
function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function newRoom() {
  const room = {
    code: makeCode(), seq: 0, ver: 0, started: false, seats: [], game: null,
    event: null, aiActs: null, aiActsFor: -1, lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

/* ---------------- 从存档恢复对局（断线救援）----------------
   把存档里的对局原样塞回一个同号房间；标记了「接管」的座位会
   把 game.players[i].isAI 设成 true，服务端的 stepAI 就会自动替它出牌。 */
function restoreRoom(file) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(abs)) throw new Error('找不到存档文件：' + abs);
  const snap = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!snap.room || !snap.game) throw new Error('存档格式不对（缺少 room / game）');

  const room = {
    code: String(snap.room).toUpperCase(), seq: 0, ver: 0, started: true,
    seats: [], game: null, event: null, aiActs: null, aiActsFor: -1, lastActive: Date.now(),
  };
  room.game = Game.deserialize(snap.game);

  (snap.seats || []).forEach((s, i) => {
    const isAI = !!s.isAI || !!s.接管;
    /* token 一律清空：服务端重启后原来的 token 已经没了，
       客户端会走「房间号 + 名字」认回座位那条路。
       lastSeen 故意设成 45 秒后：恢复对局时所有人都不在线，
       给他们 45 秒 + GRACE 的时间重新连进来，别一启动就把人托管了。 */
    room.seats.push({
      token: null, name: s.name || ('玩家' + i), isAI, connected: false, res: null,
      joinedAt: Date.now(), lastSeen: Date.now() + 45000,
    });
    if (room.game.players[i]) room.game.players[i].isAI = isAI;
  });

  /* 座位数比存档里的玩家少就补齐，避免下标错位 */
  while (room.seats.length < room.game.players.length) {
    const i = room.seats.length;
    room.seats.push({ token: null, name: room.game.players[i].name, isAI: true, connected: false, res: null });
    room.game.players[i].isAI = true;
  }

  rooms.set(room.code, room);
  return room;
}

function stateFor(room, seat) {
  const me = seat >= 0 ? room.seats[seat] : null;
  return {
    room: room.code,
    seq: room.seq,
    started: room.started,
    turn: room.game ? room.game.current : -1,
    mySeat: seat,
    seats: room.seats.map(s => ({
      name: s.name, isAI: !!s.isAI, connected: !!s.connected, autoAI: !!s.autoAI,
    })),
    game: room.game ? room.game.serialize(WIRE_LOGS) : null,
    event: room.event,
    /* ★ 回合倒计时：前端拿这个画倒计时条。null = 这步没有时限 */
    deadline: room.deadline || null,
    timeoutSec: room.deadlineSec || 0,
    /* ★ 我自己是不是正被电脑托管。**只认掉线托管(autoAI)**：
       管理员静默托管(adminAI)不弹横幅也不自动抢回，否则人在电脑前坐着，
       客户端会一直把座位抢回去，AI 根本代打不了。 */
    myAI: me ? !!(me.isAI && me.autoAI) : null,
    /* ★ 破产拍卖窗口状态。客户端靠它知道"能不能出价、还剩几秒"——
       只推 pendingAuction 是不够的：破产挂起和窗口开启之间隔着一次看门狗扫描（≤500ms），
       这段空窗期客户端如果抢先出价会被拒（端到端测试就是这么抓到的）。 */
    auction: (room.auction && room.game && room.game.pendingAuction) ? {
      open: true,
      deadId: room.game.pendingAuction.deadId,
      deadName: room.game.pendingAuction.deadName,
      deadline: room.auction.deadline,
      windowMs: (CONFIG.auction && CONFIG.auction.windowMs) || 25000,
      mySubmitted: (me && room.auction.submitted[seat] !== undefined) ? !!room.auction.submitted[seat] : null,
      submittedCount: Object.keys(room.auction.submitted).length,
      /* ★ 分母用服务端的口径，别让客户端自己数。
         服务端判"是否所有人都交票"用的是 alive && !isAI && 非出局者 ——
         客户端如果按"存活且非 AI"自己数，在"出局者算不算""AI 接管后 isAI 有没有变"
         这两处会和这里不一致，于是进度条永远到不了 n/n。 */
      totalHumans: room.game.players.filter(p => p.alive && !p.isAI && p.id !== room.game.pendingAuction.deadId).length,
    } : null,
  };
}

/** 当前阶段的超时秒数 */
function phaseTimeout(g) {
  return g.phase === 'awaiting-trade' ? T_TRADE : T_ROLL;
}

/** 每次状态变化都调一次：阶段/回合换了就重新起表，没换就保持原截止时间。
 *  电脑的回合不设倒计时（它自己会走）。 */
function armDeadline(room) {
  const g = room.game;
  if (!g || g.over) { room.deadline = null; room.deadlineKey = null; return; }
  const p = g.cur();
  if (!p || p.isAI) { room.deadline = null; room.deadlineKey = null; return; }
  const key = g.current + '|' + g.phase;
  if (room.deadlineKey === key && room.deadline) return;   // 同一步不要重置计时
  room.deadlineKey = key;
  room.deadlineSec = phaseTimeout(g);
  room.deadline = Date.now() + room.deadlineSec * 1000;
}

function push(room, ev) {
  room.lastActive = Date.now();
  room.seq++;
  room.ver = (room.ver || 0) + 1;      // ★ 版本号：长轮询靠它判断"有没有变化"
  armDeadline(room);                    // ★ 每次变化都重新校准回合倒计时
  if (ev) { ev.seq = room.seq; room.event = ev; }

  /* 1) 还在用 SSE 的客户端（局域网下最省事）——立刻写一帧 */
  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    if (!s.res) continue;
    try {
      s.res.write('data: ' + JSON.stringify(stateFor(room, i)) + '\n\n');
    } catch (e) { s.res = null; s.connected = false; }
  }

  /* 2) 挂起中的长轮询——立刻兑现，客户端收到后会马上再发一个请求。
        用队列而不是单个槽位：万一客户端重连时同时挂了两个请求，
        单个槽位会让前一个被覆盖、只能干等 25 秒超时。 */
  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    if (!s.waiters || !s.waiters.length) continue;
    const list = s.waiters;
    s.waiters = [];
    for (const w of list) {
      clearTimeout(w.timer);
      try { w.respond(); } catch (e) {}
    }
  }
}

/* ---------------- AI 回合驱动 ---------------- */
function aiAct(room) {
  const g = room.game;
  const p = g.cur();
  if (!p || !p.alive) { g.endTurn(); return null; }
  if (room.aiActsFor !== g.current) { room.aiActsFor = g.current; room.aiActs = null; }

  if (g.phase === 'awaiting-jail') {
    if (AI.decideJail(g, p)) { if (!g.payJail().ok) g.stayInJail(); }
    else g.stayInJail();
    return null;
  }
  if (g.phase === 'awaiting-roll') {
    const r = g.rollDice();
    const mv = g.movePlayer(p, r.total);
    const ev = { kind: 'roll', seat: g.current, dice: r.dice, total: r.total, path: mv.path, by: 'ai' };
    g.resolveLanding(r.total);
    return ev;
  }
  if (g.pending && g.pending.type === 'buy') {
    const t = g.tile(g.pending.tileId);
    if (AI.decideBuy(g, p)) g.buyLand(t.id, p);
    else g.log(`${p.name} 放弃购买 ${t.name}`, 'info');
    g.clearPending();
    return null;
  }
  if (g.pending && g.pending.type === 'event') {
    g.applyEvent(g.pending.event, p);
    g.clearPending();
    return null;
  }
  if (g.phase === 'awaiting-trade') {
    if (!room.aiActs) room.aiActs = AI.planActions(g, p);
    if (room.aiActs.length) {
      const fn = room.aiActs.shift();
      try { fn(); } catch (e) { /* 单步失败忽略 */ }
      return null;
    }
    room.aiActs = null;
    g.endTurn();
    return null;
  }
  g.endTurn();
  return null;
}

function stepAI(room, delay) {
  const g = room.game;
  if (!g || g.over) return;
  const p = g.cur();
  if (!p || !p.isAI) return;
  setTimeout(() => {
    if (room.game !== g || g.over) return;
    const ev = aiAct(room);
    push(room, ev);
    if (!g.over) stepAI(room, delay);
    else room.started = true;
  }, delay);
}

/* ---------------- 超时兜底 + 掉线托管 ---------------- */

/** 超时后替玩家执行"最保守"的动作。
 *  原则：绝不替玩家做花钱的决定 —— 该放弃就放弃，但掷骰子是零损失的。 */
function forceAdvance(room) {
  const g = room.game;
  if (!g || g.over) return;
  const p = g.cur();
  if (!p || p.isAI) return;
  const phase = g.phase;
  let what = '';
  let ev = null;

  if (phase === 'awaiting-roll') {
    const r = g.rollDice();
    const mv = g.movePlayer(p, r.total);
    ev = { kind: 'roll', seat: g.current, dice: r.dice, total: r.total, path: mv.path, by: 'timeout' };
    g.resolveLanding(r.total);
    what = '掷骰子';
  } else if (phase === 'awaiting-jail') {
    g.stayInJail();                       // 不替他交保释金
    what = '继续蹲着';
  } else if (g.pending && g.pending.type === 'buy') {
    const t = g.tile(g.pending.tileId);
    g.log(`${p.name} 放弃购买 ${t.name}`, 'info');
    g.clearPending();
    what = '放弃购买';
  } else if (g.pending && g.pending.type === 'event') {
    g.applyEvent(g.pending.event, p);     // 卡片是随机给的，接受没有选择余地
    g.clearPending();
    what = '接受卡片';
  } else if (phase === 'awaiting-trade') {
    g.endTurn();
    what = '结束回合';
  }
  if (!what) return;
  g.log(`⏱ ${p.name} 超时未操作，已自动${what}`, 'bad');
  room.event = ev;
  push(room, ev);
  room.event = null;
  stepAI(room, AI_DELAY);
}

/** 掉线托管：只在「轮到他」且「确实没动静」时才交给电脑。
 *
 *  两条关键规则（都是踩过坑之后定的）：
 *  1. **有挂起中的长轮询 = 人一定在。** 长轮询在服务端最多会被挂 25 秒，
 *     只看 lastSeen 的话，健康玩家撑过 15 秒就会被误托管。
 *  2. **只在该玩家自己的回合判定。** 别人回合时他不需要做任何动作，
 *     盯着他"有没有动静"既无意义又会误伤——等他回合到了再看，
 *     反正在那之前没人需要等他。 */
function checkAutoAI(room, now) {
  const g = room.game;
  if (!g || g.over) return;
  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    if (s.isAI) continue;                                  // 本来就是电脑
    /* 规则 1：请求正挂在服务端 → 人一定在，直接续命 */
    if ((s.waiters && s.waiters.length) || s.res) { s.lastSeen = now; continue; }
    /* 规则 2：不是他的回合就不判定 */
    if (g.current !== i) continue;
    const last = s.lastSeen || s.joinedAt || now;
    if (now - last <= GRACE) continue;

    s.isAI = true;
    s.autoAI = true;                                       // 标记成"可被认回"，玩家回来要还给他
    if (g.players[i]) { g.players[i].isAI = true; g.players[i].managed = true; }   // ★ 托管=保守档
    g.log(`🤖 ${s.name} 掉线超过 ${Math.round(GRACE / 1000)} 秒，已由电脑接管`, 'bad');
    console.log(`[房间 ${room.code}] 座位 ${i} ${s.name} 在自己的回合静默超时 → 电脑接管`);
    push(room, null);
    stepAI(room, AI_DELAY);
  }
}

/** 玩家接管回自己的座位 */
function takeBack(room, i) {
  const s = room.seats[i];
  if (!s) return;
  const wasAuto = !!s.autoAI;
  const wasAdmin = !!s.adminAI;
  s.isAI = false;
  s.autoAI = false;
  s.adminAI = false;          // ★ 静默托管也要在这里清掉
  s.discAt = 0;
  s.lastSeen = Date.now();
  if (room.game && room.game.players[i]) {
    room.game.players[i].isAI = false;
    room.game.players[i].managed = false;      // ★ 人回来了就不再是托管档
    if (wasAuto) room.game.log(`👤 ${s.name} 回来了，重新接管自己的座位`, 'good');
    else if (wasAdmin) room.game.log(`👤 ${s.name} 回来了，接手自己的座位`, 'good');
  }
}

/* ---------------- 破产地产拍卖（联机侧） ----------------
   引擎只负责"挂起 + 结算"，出价的收集与计时在服务端。
   流程：破产 → engine 挂 pendingAuction → 这里开 25 秒收票窗口（AI 立刻出票）
        → 窗口结束（或所有人都交了）→ 无条件调一次 auctionEstate。
   ★ 必须"无条件"：窗口期内地块仍挂在出局者名下，若因为没人出价就跳过结算，
     pendingAuction 会永远挂着、客户端弹窗永远不关（队友提前指出过这个坑）。 */
function openAuction(room) {
  const g = room.game;
  if (!g || !g.pendingAuction) return;
  const win = (CONFIG.auction && CONFIG.auction.windowMs) || 25000;
  room.auction = { deadline: Date.now() + win, bids: {}, submitted: {}, openedAt: Date.now() };
  /* AI（以及被托管的人）立刻出票，不等窗口 */
  for (const p of g.players) {
    if (!p.alive || p.id === g.pendingAuction.deadId) continue;
    if (p.isAI) {
      try { room.auction.bids[p.id] = AI.auctionBids(g, p) || {}; } catch (e) { room.auction.bids[p.id] = {}; }
      room.auction.submitted[p.id] = true;
    }
  }
  console.log(`[房间 ${room.code}] 破产拍卖开始：${g.pendingAuction.deadName} 的资产，${win / 1000} 秒窗口`);
  push(room, null);
  maybeResolveAuction(room);          // 若场上全是 AI，开完立刻结算
}

/** 所有人都交票了就提前结算 */
function maybeResolveAuction(room) {
  const g = room.game;
  if (!g || !g.pendingAuction || !room.auction) return false;
  const humans = g.players.filter(p => p.alive && !p.isAI && p.id !== g.pendingAuction.deadId);
  const allIn = humans.every(p => room.auction.submitted[p.id]);
  if (allIn) { resolveAuction(room); return true; }
  return false;
}

function resolveAuction(room) {
  const g = room.game;
  if (!g || !g.pendingAuction) { room.auction = null; return; }
  const ac = room.auction;
  let r;
  try {
    r = g.auctionEstate(ac ? ac.bids : {});
  } catch (e) {
    console.error('拍卖结算出错，走兜底：', e && e.message);
    r = g.resolveAuctionFallback();
  }
  room.auction = null;
  console.log(`[房间 ${room.code}] 拍卖结算：卖出 ${r && r.sold || 0} 块，共 ${r && r.total || 0}`);
  push(room, null);
}

/* 看门狗：每 500ms 扫一遍所有房间 */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.game || room.game.over) continue;
    /* ★ 拍卖：有挂起就开窗口；窗口到期就结算（放在最前面，
       避免被下面的 checkAutoAI / 超时逻辑影响） */
    if (room.game.pendingAuction && !room.auction) openAuction(room);
    else if (room.auction && now >= room.auction.deadline) resolveAuction(room);
    checkAutoAI(room, now);
    if (room.deadline && now >= room.deadline) {
      const g = room.game;
      const p = g.cur();
      if (p && !p.isAI) {
        room.deadline = null;              // 先清掉，避免重复触发
        forceAdvance(room);
      } else {
        room.deadline = null;
      }
    }
  }
}, 500).unref?.();

/** 给某个玩家加钱（后台补偿用）。按名字匹配座位，返回实际加了谁的多少。 */
function payPlayer(room, name, amount) {
  const g = room.game;
  if (!g) return { ok: false, msg: '对局还没开始' };
  const nm = String(name).slice(0, 12);
  let i = room.seats.findIndex(s => s.name === nm);
  if (i < 0 && room.seats[Number(name)] !== undefined && /^\d+$/.test(String(name))) i = Number(name);
  if (i < 0 || !g.players[i]) return { ok: false, msg: '找不到玩家：' + name };
  const amt = Math.round(Number(amount) || 0);
  g.players[i].cash += amt;
  g.log(`💰 后台给 ${g.players[i].name} 发放 ${amt >= 0 ? '+' : ''}${amt}（当前现金 ${Math.round(g.players[i].cash)}）`, 'good');
  console.log(`[房间 ${room.code}] 后台发钱：${g.players[i].name} ${amt >= 0 ? '+' : ''}${amt} → 现金 ${Math.round(g.players[i].cash)}`);
  push(room, null);
  return { ok: true, seat: i, name: g.players[i].name, amount: amt, cash: Math.round(g.players[i].cash) };
}

/* ★ 「管理员静默托管」用的标记。
   和"掉线托管"(autoAI) 的区别：
     autoAI  = 人掉线了 → 客户端会弹横幅并**自动抢回**座位
     adminAI = 人还在（浏览器开着）但暂时不打 → AI 替他出牌，
               **不弹横幅、不抢回**，他回来一操作就无缝接上。
   所以 stateFor 里的 myAI 只认 autoAI。 */
function adminTakeover(room, name, on) {
  const g = room.game;
  if (!g) return { ok: false, msg: '对局还没开始' };
  const i = room.seats.findIndex(s => s.name === String(name).slice(0, 12));
  if (i < 0) return { ok: false, msg: '找不到玩家：' + name };
  const s = room.seats[i];
  s.adminAI = !!on;
  s.isAI = !!on || !!s.autoAI;
  if (g.players[i]) { g.players[i].isAI = s.isAI; g.players[i].managed = !!s.isAI; }   // ★ 托管=保守档
  g.log(on ? `🤖 ${s.name} 暂时离开，由电脑代为出牌（回来随时接手）`
           : `👤 ${s.name} 的电脑托管已取消`, on ? 'warn' : 'good');
  console.log(`[房间 ${room.code}] 静默托管 ${s.name} → ${on ? '电脑代打' : '本人'}`);
  push(room, null);
  if (on) stepAI(room, AI_DELAY);
  return { ok: true, seat: i, name: s.name, adminAI: s.adminAI };
}

/* ---------------- 人类操作 ---------------- */
const fail = (msg) => ({ ok: false, msg });

/* ★ 炒股不绑定回合：股票是跟银行成交（无限量供应），不存在"抢同一个东西"，
   所以允许在别人的回合也买卖。三条例外：
     ① 自己在坐牢（jailTurns > 0）时不许炒；
     ② 场上正有未决的买地决策时不许炒（避免和买地弹窗互相打架）；
     ③ 玩家间报价/应答同样不绑回合 —— 谈生意本来就不该等轮到你。 */
const OFF_TURN_ACTIONS = {
  buyStock: 1, sellStock: 1,
  proposeTrade: 1, respondTrade: 1, cancelTrade: 1,
};

function applyAction(room, seat, action, payload) {
  const g = room.game;
  if (!g) return fail('对局还没开始');
  if (g.over) return fail('对局已经结束了');
  const p = g.players[seat];
  if (!p) return fail('座位无效');
  if (!OFF_TURN_ACTIONS[action] && g.current !== seat) return fail('还没轮到你');
  if (!p.alive) return fail('你已经出局了');
  p.isAI = false;
  p.managed = false;        // ★ 本人一操作，托管档立即解除

  switch (action) {
    case 'roll': {
      if (g.phase !== 'awaiting-roll') return fail('现在不能掷骰子');
      const r = g.rollDice();
      const mv = g.movePlayer(p, r.total);
      const ev = { kind: 'roll', seat, dice: r.dice, total: r.total, path: mv.path };
      g.resolveLanding(r.total);
      room.event = ev;
      return { ok: true };
    }
    case 'payJail':
      if (g.phase !== 'awaiting-jail') return fail('现在不用交保释金');
      return g.payJail();
    case 'stayJail':
      if (g.phase !== 'awaiting-jail') return fail('现在不能这么做');
      g.stayInJail();
      return { ok: true };
    case 'buy': {
      if (!g.pending || g.pending.type !== 'buy') return fail('没有要买的地');
      const r = g.buyLand(g.pending.tileId, p);
      g.clearPending();
      return r;
    }
    case 'decline': {
      if (!g.pending || g.pending.type !== 'buy') return fail('没有要放弃的地');
      g.log(`${p.name} 放弃购买 ${g.tile(g.pending.tileId).name}`, 'info');
      g.clearPending();
      return { ok: true };
    }
    case 'eventAck': {
      if (!g.pending || g.pending.type !== 'event') return fail('没有待处理的事件');
      g.applyEvent(g.pending.event, p);
      g.clearPending();
      return { ok: true };
    }
    case 'upgrade':    if (g.phase !== 'awaiting-trade') return fail('不在交易阶段'); return g.upgrade(payload.tileId, p);
    case 'mortgage':   if (g.phase !== 'awaiting-trade') return fail('不在交易阶段'); return g.mortgage(payload.tileId, p);
    case 'redeem':     if (g.phase !== 'awaiting-trade') return fail('不在交易阶段'); return g.redeem(payload.tileId, p);
    case 'sellToBank': if (g.phase !== 'awaiting-trade') return fail('不在交易阶段'); return g.sellToBank(payload.tileId, p);
    /* ★ 炒股不绑回合：不再要求 awaiting-trade / 轮到自己。
       只保留两条例外（坐牢中、场上有人正在决定买地）。 */
    case 'buyStock':
    case 'sellStock': {
      if (p.jailTurns > 0) return fail('你在坐牢，不能炒股');
      if (g.pending && g.pending.type === 'buy') return fail('正在决定买地，稍后再交易');
      return action === 'buyStock'
        ? g.buyStock(payload.code, payload.qty, p)
        : g.sellStock(payload.code, payload.qty, p);
    }
    /* ★ 玩家间交易：报价 / 应答 / 撤回。都不绑回合（谈生意不该等轮到你），
       但坐牢中不能谈（和炒股一致）。 */
    case 'proposeTrade': {
      if (p.jailTurns > 0) return fail('你在坐牢，不能谈生意');
      return g.proposeTrade(seat, payload.to | 0, payload.give, payload.want);
    }
    case 'respondTrade': {
      if (p.jailTurns > 0) return fail('你在坐牢，不能谈生意');
      return g.respondTrade(seat, !!payload.accept);
    }
    case 'cancelTrade': return g.cancelTrade(seat);
    /* ★ 破产拍卖出价（密封报价，一次提交，提交后不能改） */
    case 'bidAuction': {
      const pa = g.pendingAuction;
      if (!pa) return fail('现在没有拍卖');
      if (!room.auction) return fail('拍卖还没开始收票，稍等一下');
      if (!p.alive) return fail('你已经出局了，不能竞拍');
      if (seat === pa.deadId) return fail('你不能竞拍自己出局后的资产');
      if (room.auction.submitted[seat]) return fail('你已经交过报价了，密封报价不能改');
      const raw = payload.bids || {};
      const clean = {};
      for (const k of Object.keys(raw)) {
        const tid = parseInt(k, 10);
        const t = g.tile(tid);
        if (!t || t.owner !== pa.deadId) continue;              // 只接受本次拍卖的标的
        const price = Math.max(0, Math.round(Number(raw[k]) || 0));
        if (price === 0) continue;
        if (price > p.cash) return fail(`${t.name} 的出价 ${price} 超过你的现金 ${Math.round(p.cash)}`);
        if (price < ((CONFIG.auction && CONFIG.auction.minBid) || 100)) continue;   // 低于底价算弃权
        clean[tid] = price;
      }
      room.auction.bids[seat] = clean;
      room.auction.submitted[seat] = true;
      const n = Object.keys(clean).length;
      g.log(`🔨 ${p.name} 已提交 ${n} 块地的报价`, 'info');
      push(room, null);
      maybeResolveAuction(room);
      return { ok: true, bids: n };
    }
    case 'card': {
      if (g.phase !== 'awaiting-trade') return fail('不在交易阶段');
      const k = payload.kind;
      if (k === 'venture') return g.buyVenture(p);
      if (k === 'junk') return g.buyJunkBond(p);
      if (k === 'option') return g.buyOption(payload.tileId, p);
      if (k === 'insurance') return g.buyInsurance(p);
      if (k === 'deposit') return g.buyDeposit(p);
      if (k === 'redeemDeposit') return g.redeemDeposit(p);
      return fail('不认识的产品');
    }
    case 'endTurn': {
      if (g.phase !== 'awaiting-trade') return fail('现在还不能结束回合');
      g.endTurn();
      return { ok: true };
    }
    default:
      return fail('未知操作 ' + action);
  }
}

/* ---------------- HTTP ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
};
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

/** 文本资源一律 gzip。公网隧道下这一步很关键：
 *  单文件版首页 190KB → 约 50KB，朋友进游戏的时间直接砍掉一大半。 */
function sendMaybeGzip(req, res, code, headers, data) {
  const accept = String(req.headers['accept-encoding'] || '');
  const isText = /text\/|javascript|json|svg|markdown/.test(headers['content-type'] || '');
  if (isText && data.length > 1024 && /\bgzip\b/.test(accept)) {
    try {
      const gz = zlib.gzipSync(data);
      if (gz.length < data.length) {
        headers['content-encoding'] = 'gzip';
        headers['vary'] = 'accept-encoding';
        headers['content-length'] = gz.length;
        res.writeHead(code, headers);
        return res.end(gz);
      }
    } catch (e) { /* 压缩失败就发原样 */ }
  }
  headers['content-length'] = data.length;
  res.writeHead(code, headers);
  res.end(data);
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams;

  /* ---- 创建房间 ---- */
  if (u.pathname === '/api/create' && req.method === 'POST') {
    const body = await readBody(req);
    const room = newRoom();
    const token = makeToken();
    room.seats.push({ token, name: (body.name || '房主').slice(0, 12), isAI: false, connected: false, res: null, joinedAt: Date.now(), lastSeen: Date.now() });
    console.log(`[房间 ${room.code}] 创建，房主 ${room.seats[0].name}`);
    return json(res, 200, { ok: true, room: room.code, token, seat: 0 });
  }

  /* ---- 加入房间 ---- */
  if (u.pathname === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    /* 断线重连：token 还能对上就回原座位（并且收回被电脑接管的控制权） */
    if (body.token) {
      const i = room.seats.findIndex(s => s.token === body.token);
      if (i >= 0) {
        takeBack(room, i);
        push(room, null);
        return json(res, 200, { ok: true, room: room.code, token: body.token, seat: i, rejoin: true });
      }
    }
    /* 服务端重启过、老 token 失效时：允许用「同一个房间号 + 原来的名字」认回自己的座位。
       只对「已开局 + 该座位没人在玩」生效，所以不会顶掉正在玩的人。
       ★ 被电脑托管（autoAI）的座位也允许认回 —— 那是人掉线了，不是把座位让出去了。 */
    if (room.started && body.name) {
      const nm = String(body.name).slice(0, 12);
      const i = room.seats.findIndex(s =>
        s.name === nm && (!s.isAI || s.autoAI) && (s.autoAI || !s.connected));
      if (i >= 0) {
        const t = makeToken();
        room.seats[i].token = t;
        room.seats[i].reclaimed = true;
        takeBack(room, i);
        push(room, null);
        return json(res, 200, { ok: true, room: room.code, token: t, seat: i, rejoin: true, reclaimed: true });
      }
    }
    /* ★ 热加入：房间已经开局，但还有「纯电脑」座位（不是被人托管的那种），
       允许中途来的新人直接坐下顶替那台电脑。
       注意只认 !autoAI 的座位 —— autoAI 是"原来的玩家掉线了"，
       那个座位必须留给本人回来认领，不能被陌生人抢走。 */
    if (room.started && body.hotjoin && body.name && room.game && !room.game.over) {
      const nm = String(body.name).slice(0, 12);
      const i = room.seats.findIndex(s => s.isAI && !s.autoAI);
      if (i < 0) return json(res, 400, { ok: false, msg: '没有可以顶替的电脑座位了' });
      const t = makeToken();
      const s = room.seats[i];
      s.token = t; s.name = nm; s.isAI = false; s.autoAI = false; s.adminAI = false;
      s.connected = false; s.joinedAt = Date.now(); s.lastSeen = Date.now();
      if (room.game.players[i]) {
        room.game.players[i].isAI = false;
        room.game.players[i].managed = false;      // ★ 真人接手，解除托管档
        room.game.players[i].name = nm;
        room.game.log(`🎮 ${nm} 中途加入，顶替了电脑座位 ${i + 1}`, 'good');
      }
      console.log(`[房间 ${room.code}] ${nm} 热加入，顶替座位 ${i}`);
      push(room, null);
      return json(res, 200, { ok: true, room: room.code, token: t, seat: i, hotjoin: true });
    }
    if (room.started) return json(res, 400, { ok: false, msg: '这局已经开打了，等下一局吧' });
    if (room.seats.filter(s => !s.isAI).length >= 4) return json(res, 400, { ok: false, msg: '房间满了' });
    const token = makeToken();
    const seat = room.seats.length;
    room.seats.push({ token, name: (body.name || ('玩家' + (seat + 1))).slice(0, 12), isAI: false, connected: false, res: null, joinedAt: Date.now(), lastSeen: Date.now() });
    console.log(`[房间 ${room.code}] ${room.seats[seat].name} 加入（座位 ${seat}）`);
    push(room, null);
    return json(res, 200, { ok: true, room: room.code, token, seat });
  }

  /* ---- 开始游戏（房主） ---- */
  if (u.pathname === '/api/start' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    if (room.seats[0].token !== body.token) return json(res, 403, { ok: false, msg: '只有房主能开始' });
    if (room.started) return json(res, 400, { ok: false, msg: '已经开始了' });
    const want = Math.max(2, Math.min(4, parseInt(body.players, 10) || 4));
    if (body.quarters) CONFIG.maxQuarters = Math.max(5, Math.min(200, parseInt(body.quarters, 10)));
    if (body.cash) CONFIG.startingCash = Math.max(5000, parseInt(body.cash, 10));

    const players = [];
    for (let i = 0; i < want; i++) {
      const s = room.seats[i];
      if (s && !s.isAI) players.push({ name: s.name, isAI: false });
      else players.push({ name: '电脑·' + ['老王', '阿May', '铁柱', '小满'][i % 4], isAI: true });
    }
    /* ★ 关键：原地复用座位对象，绝对不要 new 一批替换掉。
       旧写法 `room.seats = players.map(o => ({...}))` 会把挂起中的长轮询 waiter
       和 SSE 连接一起丢掉，后果就是房主一点「开始游戏」，
       其他人的连接失去唤醒者、只能干等 25 秒超时——表现就是"房主开了别人还没进去"。 */
    const oldSeats = room.seats.slice();
    const nextSeats = [];
    for (let i = 0; i < want; i++) {
      const old = oldSeats[i];
      if (old) {
        old.isAI = players[i].isAI;
        old.name = players[i].name;
        if (old.isAI) old.token = null;      // 变成电脑的座位不再接受这个身份的请求
        nextSeats.push(old);
      } else {
        nextSeats.push({ token: null, name: players[i].name, isAI: true, connected: false, res: null });
      }
    }
    /* 被裁掉的座位（比如设 2 人但房间里有 4 个）要收尾，别留着断不掉的连接 */
    for (let i = want; i < oldSeats.length; i++) {
      const s = oldSeats[i];
      if (s.waiters && s.waiters.length) { s.waiters.forEach(w => clearTimeout(w.timer)); s.waiters = []; }
      if (s.res) { try { s.res.end(); } catch (e) {} s.res = null; }
      s.connected = false;
    }
    room.seats = nextSeats;
    room.game = new Game({ players });
    room.started = true;
    room.aiActs = null; room.aiActsFor = -1;
    console.log(`[房间 ${room.code}] 开局：${players.map(p => p.name + (p.isAI ? '(AI)' : '')).join(' / ')}，${CONFIG.maxQuarters} 季度`);
    push(room, { kind: 'start' });
    stepAI(room, AI_DELAY);
    return json(res, 200, { ok: true });
  }

  /* ---- 玩家操作 ---- */
  if (u.pathname === '/api/action' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    const i = room.seats.findIndex(s => s.token === body.token);
    if (i < 0) return json(res, 403, { ok: false, msg: '身份无效，刷新页面重新加入' });
    /* 玩家一动就说明人在，收回电脑托管、刷新在线时间 */
    room.seats[i].lastSeen = Date.now();
    if (room.seats[i].isAI) takeBack(room, i);

    /* ★ 幂等：公网隧道实测约 8% 的 POST 会丢，客户端会用同一个 reqId 重试。
         重试时直接返回上次的结果，绝不重复执行（不然会重复买地扣两次钱）。 */
    if (body.reqId && room.seen && room.seen[body.reqId]) {
      const cached = room.seen[body.reqId];
      return json(res, cached.ok ? 200 : 400, cached);
    }

    const r = applyAction(room, i, body.action, body.payload || {});
    if (body.reqId) {
      room.seen = room.seen || {};
      room.seen[body.reqId] = r;
      const keys = Object.keys(room.seen);
      if (keys.length > 300) for (const k of keys.slice(0, 100)) delete room.seen[k];
    }
    push(room, r.ok ? room.event : null);
    if (r.ok) { room.event = null; stepAI(room, AI_DELAY); }
    return json(res, r.ok ? 200 : 400, r);
  }

  /* ---- 列出当前房间（给旁观/记录工具用）----
     ★ 只允许本机访问：公网隧道过来的请求一律拒绝，
       否则拿到隧道网址的人就能枚举出正在进行的房间并闯进去。 */
  if (u.pathname === '/api/rooms') {
    const ip = req.socket.remoteAddress || '';
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) return json(res, 403, { ok: false, msg: '这个接口只允许本机访问' });
    const now = Date.now();
    const list = [...rooms.values()].map(r => ({
      room: r.code,
      started: !!r.started,
      quarter: r.game ? r.game.quarter : 0,
      over: r.game ? !!r.game.over : false,
      玩家: r.seats.map(s => ({ 名字: s.name, 电脑: !!s.isAI, 在线: !!s.connected })),
      空闲秒数: Math.round((now - (r.lastActive || now)) / 1000),
    }));
    return json(res, 200, { ok: true, count: list.length, rooms: list });
  }

  /* ---- 管理员强制出局（只允许本机）：
     之前要"强行让某人出局"只能做存档手术（改 JSON → 重启恢复），既麻烦又会打断别人。
     现在直接走引擎的 declareBankrupt，破产触发的地产拍卖也会正常开起来。
     POST { room, name, creditor? }  creditor 给座位号则视为"欠他的"，否则无债权人。 ---- */
  if (u.pathname === '/api/admin/bankrupt' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) return json(res, 403, { ok: false, msg: '这个接口只允许本机访问' });
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room || !room.game) return json(res, 404, { ok: false, msg: '没有这个房间或还没开局' });
    const g = room.game;
    const i = room.seats.findIndex(s => s.name === String(body.name || '').slice(0, 12));
    if (i < 0) return json(res, 400, { ok: false, msg: '找不到玩家：' + body.name });
    const p = g.players[i];
    if (!p || !p.alive) return json(res, 400, { ok: false, msg: '这个人已经出局了' });
    const creditor = (body.creditor === undefined || body.creditor === null) ? -1 : (body.creditor | 0);
    console.log(`[房间 ${room.code}] 管理员强制 ${p.name} 出局`);
    g.declareBankrupt(p, creditor, p.cash < 0 ? -p.cash : 0);
    if (g.pendingAuction && !room.auction) openAuction(room);   // 立刻开拍，别等看门狗
    push(room, null);
    if (g.over) return json(res, 200, { ok: true, name: p.name, over: true });
    if (!g.cur().isAI) armDeadline(room);
    else stepAI(room, AI_DELAY);
    return json(res, 200, { ok: true, name: p.name, auction: !!g.pendingAuction });
  }

  /* ---- 管理员静默托管（只允许本机）：让电脑替某个玩家出牌，但**不碰他的客户端**
     POST { room, name, on }   on:true 托管 / false 取消 ---- */
  if (u.pathname === '/api/admin/takeover' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) return json(res, 403, { ok: false, msg: '这个接口只允许本机访问' });
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    const r = adminTakeover(room, body.name, body.on !== false);
    return json(res, r.ok ? 200 : 400, r);
  }

  /* ---- 后台发钱（只允许本机，公网隧道过来的会被拒）---- */
  if (u.pathname === '/api/admin/pay' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) return json(res, 403, { ok: false, msg: '这个接口只允许本机访问' });
    const body = await readBody(req);
    const room = rooms.get(String(body.room || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    const r = payPlayer(room, body.name, body.amount);
    return json(res, r.ok ? 200 : 400, r);
  }

  /* ---- 状态快照（重连用） ---- */
  if (u.pathname === '/api/state') {
    const room = rooms.get(String(q.get('room') || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    const i = room.seats.findIndex(s => s.token === q.get('token'));
    return json(res, 200, { ok: true, state: stateFor(room, i) });
  }

  /* ---- 长轮询：默认传输方式 ----
     为什么不直接用 SSE：Cloudflare Quick Tunnel 会把 SSE 缓冲住（实测 20 秒 0 字节），
     朋友的浏览器永远收不到状态。长轮询是一个完整的普通 HTTP 响应，任何代理/隧道都能过。
     服务端有变化就立刻返回，没有变化就挂起最多 25 秒。 */
  if (u.pathname === '/api/wait' && req.method === 'GET') {
    const room = rooms.get(String(q.get('room') || '').toUpperCase());
    if (!room) return json(res, 404, { ok: false, msg: '没有这个房间号' });
    const i = room.seats.findIndex(s => s.token === q.get('token'));
    if (i < 0) return json(res, 403, { ok: false, msg: '身份无效' });
    const seat = room.seats[i];
    const since = parseInt(q.get('since') || '-1', 10);
    let done = false;
    seat.lastSeen = Date.now();          // 每次轮询都算"人在"，掉线判断靠这个

    /* 响应时重新定位座位下标：开局会重建/裁剪座位表，捕获的 i 可能已经过期 */
    const seatIndex = () => { const k = room.seats.indexOf(seat); return k >= 0 ? k : i; };

    const respond = () => {
      if (done) return;
      done = true;
      seat.connected = true;
      room.lastActive = Date.now();
      json(res, 200, { ok: true, ver: room.ver || 0, state: stateFor(room, seatIndex()) });
    };
    const respondNoChange = () => {
      if (done) return;
      done = true;
      seat.connected = true;
      json(res, 200, { ok: true, ver: room.ver || 0, unchanged: true });
    };

    seat.connected = true;
    /* 已经有变化了就直接返回，不挂起 */
    if ((room.ver || 0) !== since) return respond();

    /* 挂起等待。25 秒没变化就回一个"没变化"，客户端马上再问一次。 */
    const timer = setTimeout(() => {
      seat.waiters = (seat.waiters || []).filter(w => w.res !== res);
      respondNoChange();
    }, 25000);
    seat.waiters = seat.waiters || [];
    seat.waiters.push({ res, timer, respond });
    /* ★ 必须监听 res 而不是 req：GET 请求的 req 在头部收完就 'close' 了，
       监听 req 会把等待者立刻清掉，导致事件永远唤不醒它（只能等超时）。 */
    res.on('close', () => {
      clearTimeout(timer);
      seat.waiters = (seat.waiters || []).filter(w => w.res !== res);
      /* ★ 不管响应是正常回完还是被中途掐断，都要标成离线。
         之前写成 `if (done) seat.connected = false`，而客户端掉线/关页面时
         请求是「还没回应就断了」(done === false)，于是永远清不掉，
         掉线的人在大厅里一直显示"在线"。正常回完的情况客户端会立刻再发一次
         长轮询，connected 马上就变回 true，所以无条件清是安全的。 */
      seat.connected = false;
    });
    return;
  }

  /* ---- SSE 状态推送（局域网下用，浏览器原生断线重连）---- */
  if (u.pathname === '/api/events') {
    const room = rooms.get(String(q.get('room') || '').toUpperCase());
    if (!room) { res.writeHead(404).end('no room'); return; }
    const i = room.seats.findIndex(s => s.token === q.get('token'));
    if (i < 0) { res.writeHead(403).end('bad token'); return; }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const seat = room.seats[i];
    seat.res = res; seat.connected = true;
    res.write('retry: 2000\n\n');
    res.write('data: ' + JSON.stringify(stateFor(room, i)) + '\n\n');
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => {
      clearInterval(ka);
      if (seat.res === res) { seat.res = null; seat.connected = false; }
      push(room, null);
    });
    return;
  }

  /* ---- 静态文件 ---- */
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  /* ★ 首页优先用打包好的单文件版：1 次请求 vs 源码版 7 次请求。
     公网隧道下每个请求都要 1~2 秒，这一步能把朋友进游戏的时间从十几秒压到两三秒。
     想强制用源码版（改代码调试时）：设环境变量 DGS_SERVE_SRC=1 */
  if (rel === '/index.html' && hasBundle && process.env.DGS_SERVE_SRC !== '1') {
    return fs.stat(BUNDLE, (err, st) => {
      if (err) { res.writeHead(500).end('bundle stat error'); return; }
      const etag = '"b' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }).end(); return; }
      fs.readFile(BUNDLE, (e2, data) => {
        if (e2) { res.writeHead(500).end('bundle read error'); return; }
        sendMaybeGzip(req, res, 200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
          etag,
        }, data);
      });
    });
  }

  const full = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!full.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel); return; }
    /* ETag + no-cache：刷新时命中 304，省掉 190KB 的重复下载 */
    const etag = '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }).end(); return; }
    fs.readFile(full, (e2, data) => {
      if (e2) { res.writeHead(404).end('404'); return; }
      sendMaybeGzip(req, res, 200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        etag,
      }, data);
    });
  });
});

/* 每小时清一次没人活跃的旧房间 */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const alive = room.seats.some(s => s.connected);
    if (!alive && now - room.lastActive > 3 * 3600 * 1000) { rooms.delete(code); console.log(`[房间 ${code}] 回收`); }
  }
}, 600000);

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log('');
    console.log('  ✗ 端口 ' + PORT + ' 已经被占用了。');
    console.log('');
    console.log('  最常见的原因：你已经开过一个联机服务（可能有个旧的黑窗口没关）。');
    console.log('  处理办法二选一：');
    console.log('    1) 找到原来那个黑窗口，关掉它，再重新打开本窗口；');
    console.log('    2) 或者换个端口：node server.mjs 8899');
    console.log('       那样网址就变成 http://127.0.0.1:8899/ 了。');
    console.log('');
  } else {
    console.log('');
    console.log('  ✗ 服务启动失败：' + (e && e.message));
    console.log('');
  }
  setTimeout(() => process.exit(1), 300);
});

server.listen(PORT, '0.0.0.0', () => {
  /* 窗口标题用中文——bat 里只能是 ASCII，所以由 Node 来设置（Node 走 Unicode，不受代码页影响） */
  try { process.title = '地产股神 · 联机服务（这个窗口别关）'; } catch (e) {}
  const ips = [];
  const ifs = os.networkInterfaces();
  for (const k in ifs) for (const it of ifs[k]) if (it.family === 'IPv4' && !it.internal) ips.push(it.address);
  console.log('');
  console.log('  地产股神 · 联机服务已启动');
  console.log('  ─────────────────────────────────────────');
  console.log('  ★ 这个窗口就是服务器，玩游戏期间不要关 ★');
  console.log('  ─────────────────────────────────────────');
  console.log(`  本机：      http://127.0.0.1:${PORT}/`);
  ips.forEach(ip => console.log(`  局域网：    http://${ip}:${PORT}/    ← 同 WiFi 的朋友用这个`));
  console.log('  ─────────────────────────────────────────');
  console.log('  进去后点「联机对战」→ 创建房间，把房间号发给朋友。');
  console.log('  异地朋友（不在同一 WiFi）看 docs/异地联机指南.md');
  console.log(hasBundle
    ? '  首页＝单文件版（1 次请求，朋友进得快）'
    : '  首页＝源码版（7 次请求，公网下较慢；跑 npm run build 可生成单文件版）');
  console.log('');

  /* 断线救援：从存档恢复对局 */
  if (RESTORE_FILE) {
    try {
      const room = restoreRoom(RESTORE_FILE);
      console.log('  ★ 已从存档恢复对局');
      console.log(`    房间号：${room.code}   Q${room.game.quarter}   阶段 ${room.game.phase}`);
      room.seats.forEach((s, i) => {
        const tag = s.isAI
          ? (room.game.players[i].name === s.name ? ' ← 电脑接管中' : '')
          : '';
        console.log(`    [${i}] ${s.name}${s.isAI ? '（电脑）' : ''}${s.reclaimed === undefined && s.isAI ? tag : ''}`);
      });
      console.log('');
      console.log('    所有人重新进游戏页面，刷新后会自动认回自己的座位。');
      console.log('    （认不准的话：点「联机对战」→ 输房间号 + 原来的名字 → 加入房间）');
      console.log('');
      push(room, null);
      stepAI(room, AI_DELAY);
      /* 启动时把 --pay 指定的补偿一次性发到位 */
      for (const spec of PAY_ARGS) {
        const k = spec.lastIndexOf('=');
        if (k <= 0) continue;
        const r = payPlayer(room, spec.slice(0, k), spec.slice(k + 1));
        console.log('    ' + (r.ok ? `✓ 已给 ${r.name} 发放 ${r.amount}，现金现为 ${r.cash}`
          : '✗ 发钱失败：' + r.msg));
      }
    } catch (e) {
      console.log('  ✗ 恢复存档失败：' + e.message);
      console.log('');
    }
  }
});
