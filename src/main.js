/* ============================================================
 * 《地产股神》v0.1 — 启动、开局设置、存读档
 * ============================================================ */

(function () {
  const SAVE_KEY = 'dizhu-gushen-save-v1';
  const HUMAN_NAMES = ['玩家一', '玩家二', '玩家三', '玩家四'];
  const AI_NAMES = ['电脑·老王', '电脑·阿May', '电脑·铁柱', '电脑·小满'];

  function slotHTML(i) {
    const def = i === 0 ? 'human' : (i <= 2 ? 'ai' : 'off');
    return `<div class="slot" data-i="${i}">
      <span class="dot" style="background:${PLAYER_COLORS[i]}"></span>
      <input type="text" placeholder="${def === 'ai' ? AI_NAMES[i] : HUMAN_NAMES[i]}" value="">
      <select>
        <option value="human"${def === 'human' ? ' selected' : ''}>人类</option>
        <option value="ai"${def === 'ai' ? ' selected' : ''}>电脑</option>
        <option value="off"${def === 'off' ? ' selected' : ''}>不参与</option>
      </select>
    </div>`;
  }

  function buildSlots() {
    const box = document.getElementById('slots');
    box.innerHTML = [0, 1, 2, 3].map(slotHTML).join('');
  }

  function startGame() {
    const slots = Array.prototype.slice.call(document.querySelectorAll('.slot')).map(s => ({
      mode: s.querySelector('select').value,
      name: s.querySelector('input').value.trim(),
      i: parseInt(s.dataset.i, 10),
    })).filter(s => s.mode !== 'off');

    if (slots.length < 2) { alert('至少要 2 位玩家（人类或电脑都行）'); return; }

    /* ★ 选项值可能对不上（改过下拉框、或别处塞了非法值）。
       以前是 `|| 10` / `|| 25000` —— 一旦失配就**悄悄**把一局变成 10 个季度、2.5 万现金，
       测试和真人都被静默降级过。现在：无效值就**沿用 CONFIG 里的默认值**，并明确报出来。 */
    const qEl = document.getElementById('opt-quarters');
    const cEl = document.getElementById('opt-cash');
    const qv = parseInt(qEl && qEl.value, 10);
    const cv = parseInt(cEl && cEl.value, 10);
    if (isFinite(qv) && qv > 0) CONFIG.maxQuarters = qv;
    else console.warn('[开局] 局时选项无效（值=' + JSON.stringify(qEl && qEl.value) + '），沿用默认 ' + CONFIG.maxQuarters);
    if (isFinite(cv) && cv > 0) CONFIG.startingCash = cv;
    else console.warn('[开局] 初始现金选项无效（值=' + JSON.stringify(cEl && cEl.value) + '），沿用默认 ' + CONFIG.startingCash);

    const players = slots.map(s => ({
      name: s.name || (s.mode === 'ai' ? AI_NAMES[s.i] : HUMAN_NAMES[s.i]),
      isAI: s.mode === 'ai',
    }));

    UI.g = new Game({ players });
    UI._resultShown = false;
    document.getElementById('setup').classList.add('hide');
    UI.buildBoard();
    UI.renderAll();
    UI.startTurn();
  }

  function save() {
    if (!UI.g) return;
    try {
      localStorage.setItem(SAVE_KEY, UI.g.serialize());
      UI.toast('已存档');
    } catch (e) { UI.toast('存档失败：' + e.message); }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {}
    if (!raw) { UI.toast('没有找到存档'); return; }
    try {
      UI.g = Game.deserialize(raw);
      UI._resultShown = false;
      document.getElementById('setup').classList.add('hide');
      UI.buildBoard();
      UI.resume();
      UI.toast('读档成功');
    } catch (e) { UI.toast('读档失败：' + e.message); }
  }

  function exportSave() {
    if (!UI.g) return;
    const blob = new Blob([UI.g.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '地产股神-存档-Q' + UI.g.quarter + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importSave() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          UI.g = Game.deserialize(String(fr.result));
          UI._resultShown = false;
          document.getElementById('setup').classList.add('hide');
          UI.buildBoard();
          UI.resume();
          UI.toast('导入成功');
        } catch (e) { UI.toast('导入失败：' + e.message); }
      };
      fr.readAsText(f);
    });
    inp.click();
  }

  /* 联机房间里，存档/读档/开始新游戏全部锁死——真相在服务端，
     本地读一个存档会让两边状态分叉（画面被下一次推送覆盖，看着像灵异事件）。 */
  function netLocked() {
    if (typeof NET !== 'undefined' && NET.room && NET.token) {
      UI.toast('你正在联机房间里：存/读档和开新局由房主控制，想退出请点「离开房间」');
      return true;
    }
    return false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildSlots();
    UI.init();
    document.getElementById('btn-start').addEventListener('click', () => {
      if (netLocked()) return;
      startGame();
    });
    document.getElementById('btn-new').addEventListener('click', () => {
      if (netLocked()) return;
      document.getElementById('setup').classList.remove('hide');
      buildSlots();
    });
    document.getElementById('btn-save').addEventListener('click', () => { if (!netLocked()) save(); });
    document.getElementById('btn-load').addEventListener('click', () => { if (!netLocked()) load(); });
    document.getElementById('btn-export').addEventListener('click', () => { if (!netLocked()) exportSave(); });
    document.getElementById('btn-import').addEventListener('click', () => { if (!netLocked()) importSave(); });
    document.getElementById('btn-rules').addEventListener('click', () => UI.rulesModal());
    document.getElementById('btn-lan').addEventListener('click', async () => {
      document.getElementById('setup').classList.add('hide');
      document.getElementById('lobby').classList.remove('hide');
      if (!NET.room) {
        const ok = await NET.tryReconnect();
        if (!ok) NET.renderLobby();
      } else NET.renderLobby();
    });

    /* 联机模式：刷新页面后自动回到原来的座位 */
    NET.tryReconnect().then(ok => { if (ok) { /* 状态由 SSE 推过来 */ } });

    /* 演示用：?lan=1 直接打开联机大厅 */
    if (new URLSearchParams(location.search).get('lan') === '1') {
      document.getElementById('setup').classList.add('hide');
      document.getElementById('lobby').classList.remove('hide');
      NET.renderLobby();
    }

    /* 演示 / 截图模式：index.html?auto=1&ai=4&q=3&turbo=0.02
       —— 跳过开局面板直接开打，方便录屏、截图和自动化测试。 */
    const p = new URLSearchParams(location.search);
    if (p.has('auto')) {
      const nAI = parseInt(p.get('ai') || '3', 10);
      const nHuman = parseInt(p.get('human') || String(Math.max(0, Math.min(1, 4 - nAI))), 10);
      document.querySelectorAll('.slot select').forEach((s, i) => {
        s.value = i < nHuman ? 'human' : (i < nHuman + nAI ? 'ai' : 'off');
      });
      if (p.has('q')) {
        const q = p.get('q');
        const sel = document.getElementById('opt-quarters');
        if (Array.prototype.some.call(sel.options, o => o.value === q)) sel.value = q;
      }
      if (p.has('cash')) {
        const c = p.get('cash');
        const sel = document.getElementById('opt-cash');
        if (Array.prototype.some.call(sel.options, o => o.value === c)) sel.value = c;
      }
      if (p.has('seed')) { /* 预留：固定种子 */ }
      startGame();
      if (p.has('turbo')) UI.setSpeed(Math.max(0.005, parseFloat(p.get('turbo')) || 0.05));
      if (p.has('drawer')) UI.openDrawer(p.get('drawer'));
      if (p.get('mini') === '1' && !UI.centerMini) UI.toggleCenter();
    }
  });
})();
