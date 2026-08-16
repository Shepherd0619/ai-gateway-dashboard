/* ═══════════════════════════════════════════════════════════
   AI GATEWAY · RUNTIME MAPPING CONSOLE — app logic
   Zero-dependency vanilla JS. Talks to the Admin API over CORS.
   All user data is rendered via textContent (no innerHTML injection).
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── storage ──────────────────────────────────────────── */
  const STORAGE_KEY = 'aiGatewayAdmin.v1';

  const state = loadState();
  let currentRules = [];
  let classifierConfig = null;
  let editingPrefix = null;   // non-null => edit mode (original prefix)
  let editingGwId = null;     // non-null => editing an existing gateway
  let confirmCallback = null;
  let hardenFormat = 'json';  // 'json' | 'env'

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.gateways)) return s;
      }
    } catch (e) { /* fall through to seed */ }

    const seed = {
      gateways: [{ id: uid(), name: '本地', baseUrl: 'http://localhost:4000', apiKey: '' }],
      activeGatewayId: null,
    };
    seed.activeGatewayId = seed.gateways[0].id;
    persist(seed);
    return seed;
  }

  function persist(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore quota */ }
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'gw-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function activeGateway() {
    return state.gateways.find((g) => g.id === state.activeGatewayId) || null;
  }

  /* ── helpers ──────────────────────────────────────────── */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  class ApiError extends Error {
    constructor(message, status, kind) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.kind = kind;
    }
  }

  function friendlyError(err) {
    if (err && err.name === 'ApiError') {
      if (err.kind === 'nokey') return '未配置 API Key，请先在「管理网关」中填写。';
      if (err.kind === 'nogateway') return '未选择网关。';
      if (err.status === 401) return '鉴权失败：API Key 缺失或不匹配。';
      if (err.status === 404) return 'Admin API 未启用（未配置 Admin__ApiKey）或资源不存在。';
      return err.message || '请求失败（' + err.status + '）';
    }
    return '无法连接网关：请检查 baseUrl、后端是否在线，以及 CORS 是否放行当前页面源。';
  }

  /* ── API client ───────────────────────────────────────── */
  async function api(method, path, opts) {
    opts = opts || {};
    const gw = activeGateway();
    if (!gw) throw new ApiError('未选择网关', null, 'nogateway');

    const headers = { 'Content-Type': 'application/json' };
    if (opts.requireKey !== false) {
      if (!gw.apiKey) throw new ApiError('未配置 API Key', null, 'nokey');
      headers['x-admin-key'] = gw.apiKey;
    }

    let res;
    try {
      res = await fetch(gw.baseUrl.replace(/\/+$/, '') + path, {
        method: method,
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ApiError('网络错误：无法连接 ' + gw.baseUrl, null, 'network');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
      throw new ApiError(msg, res.status);
    }
    return { status: res.status, data: data };
  }

  const Api = {
    listMappings: () => api('GET', '/admin/mappings'),
    health: () => api('GET', '/health', { requireKey: false }),
    proxyHealth: () => api('GET', '/admin/proxy-health'),
    upsert: (prefix, target, proxyServer) =>
      api('PATCH', '/admin/mappings/' + encodeURIComponent(prefix), {
        body: { target: target, proxyServer: proxyServer },
      }),
    remove: (prefix) => api('DELETE', '/admin/mappings/' + encodeURIComponent(prefix)),
    replaceAll: (rules) => api('PUT', '/admin/mappings', { body: rules }),
    getClassifier: () => api('GET', '/admin/classifier'),
    setClassifier: (targetModel) => api('PUT', '/admin/classifier', { body: { targetModel: targetModel } }),
    deleteClassifier: () => api('DELETE', '/admin/classifier'),
  };

  /* ── rendering ────────────────────────────────────────── */
  function renderGatewaySelect() {
    const sel = document.getElementById('gateway-select');
    sel.replaceChildren();
    state.gateways.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    });
    sel.value = state.activeGatewayId || '';
  }

  function renderGwList() {
    const list = document.getElementById('gw-list');
    list.replaceChildren();

    if (state.gateways.length === 0) {
      list.appendChild(el('div', 'gw-empty', '暂无网关，请在下方添加第一个。'));
      return;
    }

    state.gateways.forEach((g) => {
      const item = el('div', 'gw-item' + (g.id === state.activeGatewayId ? ' active' : ''));

      const main = el('div', 'gw-item-main');
      main.appendChild(el('div', 'gw-item-name', g.name));
      main.appendChild(el('div', 'gw-item-url', g.baseUrl));

      const actions = el('div', 'gw-item-actions');
      if (g.id !== state.activeGatewayId) {
        const act = el('button', 'link-btn', '设为当前');
        act.setAttribute('data-gw-activate', g.id);
        actions.appendChild(act);
      }
      const edit = el('button', 'link-btn', '编辑');
      edit.setAttribute('data-gw-edit', g.id);
      const del = el('button', 'link-btn danger', '删除');
      del.setAttribute('data-gw-delete', g.id);
      actions.append(edit, del);

      item.append(main, actions);
      list.appendChild(item);
    });
  }

  function renderRules(rules, emptyMessage) {
    const tbody = document.getElementById('rules-body');
    const empty = document.getElementById('empty-state');
    tbody.replaceChildren();

    if (!rules || rules.length === 0) {
      empty.hidden = false;
      document.getElementById('empty-sub').textContent =
        emptyMessage || '点击「新增规则」开始配置，或先在右上角选择 / 添加网关。';
      return;
    }

    empty.hidden = true;
    rules.forEach((r, i) => {
      const prefix = r.prefix == null ? '' : r.prefix;
      const target = r.target == null ? '' : r.target;
      const proxy = r.proxyServer || '';
      const catchall = prefix === '';

      const tr = document.createElement('tr');
      tr.appendChild(el('td', 'col-idx cell-mono', String(i + 1)));

      const tdPrefix = el('td', 'cell-prefix cell-mono');
      if (catchall) {
        tdPrefix.appendChild(el('span', 'proxy-none', '(空)'));
        tdPrefix.appendChild(document.createTextNode(' '));
        tdPrefix.appendChild(el('span', 'badge badge-catchall', 'CATCH-ALL'));
      } else {
        tdPrefix.textContent = prefix;
      }

      const tdTarget = el('td', 'cell-target cell-mono');
      if (target) tdTarget.textContent = target;
      else tdTarget.appendChild(el('span', 'proxy-none', '（不重写）'));

      const tdProxy = el('td', 'col-proxy cell-mono');
      if (proxy) tdProxy.textContent = proxy;
      else tdProxy.appendChild(el('span', 'proxy-none', '—'));

      const tdActions = el('td', 'col-actions');
      const rowActions = el('div', 'row-actions');

      const reorderGroup = el('div', 'reorder-group');
      const upBtn = el('button', 'reorder-btn', '↑');
      upBtn.setAttribute('data-move-up', String(i));
      upBtn.title = '上移';
      const downBtn = el('button', 'reorder-btn', '↓');
      downBtn.setAttribute('data-move-down', String(i));
      downBtn.title = '下移';

      const isLast = i === rules.length - 1;
      const belowIsCatchall =
        i + 1 < rules.length && (rules[i + 1].prefix == null ? '' : rules[i + 1].prefix) === '';
      if (i === 0 || catchall) upBtn.disabled = true;
      if (isLast || catchall || belowIsCatchall) downBtn.disabled = true;
      reorderGroup.append(upBtn, downBtn);

      const editBtn = el('button', 'link-btn', '编辑');
      editBtn.setAttribute('data-edit', String(i));
      const delBtn = el('button', 'link-btn danger', '删除');
      delBtn.setAttribute('data-delete', String(i));
      rowActions.append(reorderGroup, editBtn, delBtn);
      tdActions.appendChild(rowActions);

      tr.append(tdPrefix, tdTarget, tdProxy, tdActions);
      tbody.appendChild(tr);
    });
  }

  function normalizeRule(r) {
    return {
      prefix: r.prefix == null ? '' : r.prefix,
      target: r.target == null ? '' : r.target,
      proxyServer: r.proxyServer || null,
    };
  }

  async function reorderRule(index, dir) {
    const j = index + dir;
    if (j < 0 || j >= currentRules.length) return;

    const tmp = currentRules[index];
    currentRules[index] = currentRules[j];
    currentRules[j] = tmp;
    renderRules(currentRules);

    const list = currentRules.map(normalizeRule);
    try {
      await Api.replaceAll(list);
      toast('已调整顺序', 'success');
      await loadRules();
      await loadClassifier();
    } catch (err) {
      toast(friendlyError(err), 'error');
      await loadRules();
    }
  }

  function setHealth(stateName, text) {
    document.getElementById('health-led').className = 'led led-' + stateName;
    document.getElementById('health-text').textContent = text;
  }

  function setFoot(stateName, text) {
    const node = document.getElementById('foot-status');
    node.className = stateName;
    node.textContent = text;
  }

  function renderClassifier(config, errorMessage) {
    const body = document.getElementById('classifier-body');
    const resetBtn = document.getElementById('classifier-reset-btn');
    body.replaceChildren();

    if (errorMessage) {
      body.appendChild(el('div', 'classifier-error', errorMessage));
      resetBtn.hidden = true;
      return;
    }
    if (!config) {
      body.appendChild(el('div', 'classifier-loading', '加载中…'));
      resetBtn.hidden = true;
      return;
    }

    const enabled = !!config.targetModel;
    const status = el('div', 'classifier-status ' + (enabled ? 'enabled' : 'disabled'));
    status.appendChild(el('span', 'led ' + (enabled ? 'led-ok' : 'led-idle')));
    status.appendChild(el('span', null, enabled ? 'ENABLED' : 'DISABLED'));
    body.appendChild(status);

    const grid = el('div', 'classifier-grid');
    const rows = [
      ['INPUT MODEL', config.targetModel || '（已关闭）'],
      ['EVALUATED TARGET', config.evaluatedTargetModel || '—'],
      ['EVALUATED PROXY', config.evaluatedProxyServer || 'DIRECT'],
      ['SOURCE', (config.source || 'base').toUpperCase()],
    ];
    rows.forEach(([label, value]) => {
      const item = el('div', 'classifier-item');
      item.appendChild(el('div', 'field-label', label));
      item.appendChild(el('div', 'classifier-value cell-mono', value));
      grid.appendChild(item);
    });
    body.appendChild(grid);
    body.appendChild(el('p', 'classifier-note', enabled
      ? '命中 Claude Code auto mode signature 后，使用上面的 effective route，并移除 billing header。'
      : 'classifier 专用路由已关闭；命中 signature 的请求仍按普通 ModelMapping 处理。'));
    resetBtn.hidden = config.source !== 'runtime';
  }

  /* ── data loading ─────────────────────────────────────── */
  async function loadClassifier() {
    const gw = activeGateway();
    if (!gw) {
      classifierConfig = null;
      renderClassifier(null, '请先在右上角选择 / 添加网关。');
      return;
    }
    renderClassifier(null);
    try {
      const { data } = await Api.getClassifier();
      classifierConfig = data;
      renderClassifier(classifierConfig);
    } catch (err) {
      classifierConfig = null;
      renderClassifier(null, friendlyError(err));
    }
  }

  function openClassifierForm() {
    document.getElementById('f-classifier-model').value = classifierConfig && classifierConfig.targetModel || '';
    document.getElementById('classifier-form-error').hidden = true;
    openModal('classifier-modal');
    document.getElementById('f-classifier-model').focus();
  }

  async function handleClassifierSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('classifier-form-error');
    const btn = document.getElementById('classifier-submit');
    const value = document.getElementById('f-classifier-model').value.trim();
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const { data } = await Api.setClassifier(value || null);
      classifierConfig = data;
      renderClassifier(classifierConfig);
      closeModal('classifier-modal');
      toast(value ? 'Classifier 已更新' : 'Classifier 专用路由已关闭', 'success');
    } catch (err) {
      showFormError(errEl, friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  function handleClassifierReset() {
    confirmModal({
      title: '恢复 Classifier 默认',
      body: '删除运行时覆盖，恢复 appsettings.json 中的 base classifier 配置？',
      okText: '恢复默认',
      danger: false,
      onConfirm: async () => {
        try {
          await Api.deleteClassifier();
          await loadClassifier();
          toast('Classifier 已恢复默认', 'success');
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      },
    });
  }

  /* ── data loading ─────────────────────────────────────── */
  async function loadHealth() {
    const gw = activeGateway();
    if (!gw) { setHealth('idle', '—'); return; }
    setHealth('idle', '…');
    try {
      const { data } = await Api.health();
      if (data && data.status === 'healthy') {
        setHealth('ok', 'HEALTHY · ' + (data.latency_ms != null ? data.latency_ms + 'ms' : '—'));
      } else {
        setHealth('bad', 'UNHEALTHY');
      }
    } catch (e) {
      setHealth('bad', '不可达');
    }
  }

  function proxyStatusLed(status) {
    return el('span', 'led led-' + (status === 'healthy' ? 'ok' : status === 'idle' ? 'idle' : 'bad'));
  }

  function renderProxyHealth(rows, emptyMessage) {
    const tbody = document.getElementById('proxy-body');
    const empty = document.getElementById('proxy-empty');
    tbody.replaceChildren();

    if (!rows || rows.length === 0) {
      empty.hidden = false;
      document.getElementById('proxy-empty-sub').textContent =
        emptyMessage || '后端未配置任何 ProxyServer（ProxyServers 段为空）。';
      return;
    }

    empty.hidden = true;
    rows.forEach((r) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'cell-mono', r.name));

      const tdStatus = el('td', 'col-status');
      const wrap = el('span', 'proxy-status');
      wrap.appendChild(proxyStatusLed(r.status));
      wrap.appendChild(el('span', null, r.status === 'healthy' ? 'HEALTHY' : 'UNHEALTHY'));
      tdStatus.appendChild(wrap);
      tr.appendChild(tdStatus);

      tr.appendChild(el('td', 'col-latency cell-mono', r.latency_ms != null ? r.latency_ms + 'ms' : '—'));

      const tdErr = el('td', 'col-error');
      tdErr.textContent = r.error ? r.error : '—';
      if (r.error) tdErr.classList.add('proxy-err');
      tr.appendChild(tdErr);

      tbody.appendChild(tr);
    });
  }

  async function loadProxyHealth() {
    const tbody = document.getElementById('proxy-body');
    const empty = document.getElementById('proxy-empty');
    empty.hidden = true;
    tbody.replaceChildren();

    const tr = el('tr');
    const td = el('td', 'proxy-loading');
    td.colSpan = 4;
    td.textContent = '测试中…';
    tr.appendChild(td);
    tbody.appendChild(tr);

    const gw = activeGateway();
    if (!gw) { renderProxyHealth([], '请先选择网关。'); return; }

    const [direct, proxies] = await Promise.all([
      Api.health().then(({ data }) => ({
        name: '直连（direct）',
        status: data && data.status === 'healthy' ? 'healthy' : 'unhealthy',
        latency_ms: data ? data.latency_ms : null,
        error: data && data.error ? data.error : null,
      })).catch((err) => ({
        name: '直连（direct）',
        status: 'unhealthy',
        latency_ms: null,
        error: friendlyError(err),
      })),
      Api.proxyHealth().then(({ data }) => (Array.isArray(data) ? data : []))
        .catch((err) => [{
          name: '代理',
          status: 'unhealthy',
          latency_ms: null,
          error: friendlyError(err),
        }]),
    ]);

    renderProxyHealth([direct, ...proxies]);

    if (proxies.length === 0) {
      const hintTr = el('tr');
      const hintTd = el('td', 'proxy-empty-hint', '无代理可测试 · 后端未配置任何 ProxyServer（ProxyServers 段为空）。');
      hintTd.colSpan = 4;
      hintTr.appendChild(hintTd);
      document.getElementById('proxy-body').appendChild(hintTr);
    }
  }

  async function loadRules() {
    const gw = activeGateway();
    if (!gw) {
      currentRules = [];
      renderRules([], '请先在右上角选择 / 添加网关。');
      renderClassifier(null, '请先在右上角选择 / 添加网关。');
      setFoot('offline', '未选择网关');
      return;
    }
    setFoot('', '加载中…');
    try {
      const { data } = await Api.listMappings();
      currentRules = Array.isArray(data) ? data : [];
      renderRules(currentRules);
      setFoot('online', currentRules.length + ' 条规则 · ' + gw.baseUrl);
    } catch (e) {
      currentRules = [];
      renderRules([], friendlyError(e));
      setFoot('offline', friendlyError(e));
    }
  }

  function loadAll() {
    loadRules();
    loadHealth();
    loadClassifier();
  }

  /* ── toasts ───────────────────────────────────────────── */
  function toast(msg, type) {
    type = type || 'info';
    const stack = document.getElementById('toast-stack');
    const node = el('div', 'toast ' + type, msg);
    stack.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 220);
    }, 4200);
  }

  /* ── modals ───────────────────────────────────────────── */
  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(id) { document.getElementById(id).hidden = true; }

  function showFormError(elNode, msg) { elNode.textContent = msg; elNode.hidden = false; }

  function confirmModal(opts) {
    document.getElementById('confirm-title').textContent = opts.title;
    document.getElementById('confirm-body').textContent = opts.body;
    const ok = document.getElementById('confirm-ok');
    ok.textContent = opts.okText || '确认';
    ok.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
    confirmCallback = opts.onConfirm || null;
    openModal('confirm-modal');
  }

  /* ── rule form ────────────────────────────────────────── */
  function openRuleForm(mode, rule) {
    editingPrefix = mode === 'edit' ? (rule.prefix == null ? '' : rule.prefix) : null;
    document.getElementById('rule-modal-title').textContent = mode === 'edit' ? '编辑规则' : '新增规则';
    document.getElementById('rule-form-error').hidden = true;

    document.getElementById('f-prefix').value = mode === 'edit' ? (rule.prefix == null ? '' : rule.prefix) : '';
    document.getElementById('f-target').value = mode === 'edit' ? (rule.target == null ? '' : rule.target) : '';
    document.getElementById('f-proxy').value = mode === 'edit' ? (rule.proxyServer || '') : '';
    document.getElementById('f-index').value = '';

    const idxHint = document.getElementById('f-index-hint');
    if (mode === 'edit') {
      const i = currentRules.findIndex(
        (r) => (r.prefix == null ? '' : r.prefix).toLowerCase() === editingPrefix.toLowerCase()
      );
      idxHint.textContent = '当前位置：第 ' + (i + 1) + ' 位。填数字可移动；留空 = 保持原位。';
    } else {
      idxHint.textContent = '1-based，对应左侧 # 列；留空 = 追加到末尾。空 prefix（catch-all）固定末尾。';
    }

    openModal('rule-modal');
    document.getElementById('f-prefix').focus();
  }

  function setSubmitBusy(busy) {
    const btn = document.getElementById('rule-submit');
    btn.disabled = busy;
    btn.textContent = busy ? '保存中…' : '保存';
  }

  function readRuleForm() {
    return {
      prefix: document.getElementById('f-prefix').value.trim(),
      target: document.getElementById('f-target').value.trim(),
      proxyServer: document.getElementById('f-proxy').value.trim() || null,
    };
  }

  async function handleRuleSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('rule-form-error');
    const f = readRuleForm();
    const rawIdx = document.getElementById('f-index').value.trim();
    const wantIndex = rawIdx === '' ? null : parseInt(rawIdx, 10);

    // Empty prefix (catch-all) or an explicit index → full-list PUT (reorder).
    if (f.prefix === '' || (wantIndex !== null && Number.isFinite(wantIndex))) {
      await saveWithOrder(f, wantIndex, errEl);
      return;
    }

    setSubmitBusy(true);
    try {
      const original = editingPrefix;
      if (original !== null && original.toLowerCase() !== f.prefix.toLowerCase()) {
        // prefix is the primary key; changing it = delete old + add new.
        await Api.remove(original);
        await Api.upsert(f.prefix, f.target, f.proxyServer);
        toast('已删除「' + original + '」并新增「' + f.prefix + '」', 'success');
      } else {
        await Api.upsert(f.prefix, f.target, f.proxyServer);
        toast(original === null ? '已新增「' + f.prefix + '」' : '已更新「' + f.prefix + '」', 'success');
      }
      closeModal('rule-modal');
      await loadRules();
      await loadClassifier();
    } catch (err) {
      showFormError(errEl, friendlyError(err));
    } finally {
      setSubmitBusy(false);
    }
  }

  async function saveWithOrder(f, wantIndex, errEl) {
    setSubmitBusy(true);
    try {
      const list = currentRules.map(normalizeRule);

      // Editing: drop the original prefix so we can reposition cleanly.
      if (editingPrefix !== null) {
        const i = list.findIndex((r) => r.prefix.toLowerCase() === editingPrefix.toLowerCase());
        if (i >= 0) list.splice(i, 1);
      }

      const entry = { prefix: f.prefix, target: f.target, proxyServer: f.proxyServer };
      let pos;
      if (f.prefix === '') {
        pos = list.length; // catch-all is pinned to the end
      } else if (wantIndex !== null) {
        pos = Math.min(Math.max(wantIndex - 1, 0), list.length);
      } else {
        pos = list.length; // append
      }
      list.splice(pos, 0, entry);

      await Api.replaceAll(list);

      let msg;
      if (f.prefix === '') {
        msg = '已保存 catch-all（固定末尾）';
      } else if (wantIndex !== null) {
        msg = '已保存「' + f.prefix + '」到第 ' + (pos + 1) + ' 位';
      } else {
        msg = (editingPrefix === null ? '已新增' : '已更新') + '「' + f.prefix + '」';
      }
      toast(msg, 'success');
      closeModal('rule-modal');
      await loadRules();
      await loadClassifier();
    } catch (err) {
      showFormError(errEl, friendlyError(err));
    } finally {
      setSubmitBusy(false);
    }
  }

  /* ── delete ───────────────────────────────────────────── */
  function handleDelete(prefix) {
    confirmModal({
      title: '删除规则',
      body: '确定删除规则「' + prefix + '」？若该 prefix 有 base 默认值，删除后将回退到默认。',
      okText: '删除',
      onConfirm: async () => {
        try {
          await Api.remove(prefix);
          await loadRules();
          await loadClassifier();
          const stillThere = currentRules.some(
            (r) => (r.prefix == null ? '' : r.prefix).toLowerCase() === prefix.toLowerCase()
          );
          if (stillThere) {
            toast('「' + prefix + '」来自默认配置，运行时覆盖已删除，已回退到默认值。', 'warn');
          } else {
            toast('已删除「' + prefix + '」', 'success');
          }
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      },
    });
  }

  function handleResetAll() {
    confirmModal({
      title: '重置全部运行时覆盖',
      body: '将清空所有运行时覆盖（PUT []），规则回退到 appsettings.json 中的 base 默认值。此操作不可撤销。',
      okText: '重置',
      onConfirm: async () => {
        try {
          await Api.replaceAll([]);
          toast('已重置全部运行时覆盖', 'success');
          await loadRules();
          await loadClassifier();
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      },
    });
  }

  /* ── gateway management ───────────────────────────────── */
  function resetGwForm() {
    editingGwId = null;
    document.getElementById('g-name').value = '';
    document.getElementById('g-baseUrl').value = '';
    document.getElementById('g-apiKey').value = '';
    document.getElementById('gw-cancel-edit').hidden = true;
    document.getElementById('gw-save').textContent = '保存网关';
    document.getElementById('gw-form-error').hidden = true;
  }

  function openGwFormForEdit(id) {
    const g = state.gateways.find((x) => x.id === id);
    if (!g) return;
    editingGwId = id;
    document.getElementById('g-name').value = g.name;
    document.getElementById('g-baseUrl').value = g.baseUrl;
    document.getElementById('g-apiKey').value = g.apiKey;
    document.getElementById('gw-cancel-edit').hidden = false;
    document.getElementById('gw-save').textContent = '保存修改';
    document.getElementById('gw-form-error').hidden = true;
  }

  function handleGwSave() {
    const name = document.getElementById('g-name').value.trim() || '未命名';
    const baseUrl = document.getElementById('g-baseUrl').value.trim();
    const apiKey = document.getElementById('g-apiKey').value.trim();
    const errEl = document.getElementById('gw-form-error');

    if (!baseUrl) { showFormError(errEl, 'BASE URL 不能为空。'); return; }
    if (!/^https?:\/\//i.test(baseUrl)) {
      showFormError(errEl, 'BASE URL 需以 http:// 或 https:// 开头。');
      return;
    }

    if (editingGwId) {
      const g = state.gateways.find((x) => x.id === editingGwId);
      if (g) { g.name = name; g.baseUrl = baseUrl; g.apiKey = apiKey; }
    } else {
      const g = { id: uid(), name: name, baseUrl: baseUrl, apiKey: apiKey };
      state.gateways.push(g);
      if (!state.activeGatewayId) state.activeGatewayId = g.id;
    }

    persist(state);
    resetGwForm();
    renderGatewaySelect();
    renderGwList();
    loadAll();
    toast('网关已保存', 'success');
  }

  function handleGwDelete(id) {
    const g = state.gateways.find((x) => x.id === id);
    confirmModal({
      title: '删除网关',
      body: '确定删除网关「' + (g ? g.name : '') + '」？仅移除浏览器中的记录，不影响后端。',
      okText: '删除',
      onConfirm: () => {
        state.gateways = state.gateways.filter((x) => x.id !== id);
        if (state.activeGatewayId === id) {
          state.activeGatewayId = state.gateways.length ? state.gateways[0].id : null;
        }
        if (editingGwId === id) resetGwForm();
        persist(state);
        renderGatewaySelect();
        renderGwList();
        loadAll();
        toast('网关已删除', 'info');
      },
    });
  }

  /* ── harden / export ──────────────────────────────────── */
  function classifierTargetForHarden() {
    return classifierConfig && classifierConfig.targetModel ? classifierConfig.targetModel : '';
  }

  function buildHardenSnippet() {
    const rules = currentRules.map((r) => {
      const out = {
        Prefix: r.prefix == null ? '' : r.prefix,
        Target: r.target == null ? '' : r.target,
      };
      if (r.proxyServer) out.ProxyServer = r.proxyServer;
      return out;
    });
    return JSON.stringify({
      ModelMapping: { Rules: rules },
      Classifier: { TargetModel: classifierTargetForHarden() || null },
    }, null, 2);
  }

  function buildHardenEnvSnippet() {
    const lines = ['environment:'];
    currentRules.forEach((r, i) => {
      const prefix = r.prefix == null ? '' : r.prefix;
      const target = r.target == null ? '' : r.target;
      const proxyServer = r.proxyServer == null ? '' : r.proxyServer;
      lines.push('      - ModelMapping__Rules__' + i + '__Prefix=' + prefix);
      lines.push('      - ModelMapping__Rules__' + i + '__Target=' + target);
      lines.push('      - ModelMapping__Rules__' + i + '__ProxyServer=' + proxyServer);
    });
    lines.push('      - Classifier__TargetModel=' + classifierTargetForHarden());
    return lines.join('\n');
  }

  function renderHarden() {
    const isJson = hardenFormat === 'json';
    document.getElementById('harden-output').value = isJson ? buildHardenSnippet() : buildHardenEnvSnippet();
    document.getElementById('harden-hint-json').hidden = !isJson;
    document.getElementById('harden-hint-env').hidden = isJson;

    const jsonBtn = document.getElementById('harden-fmt-json');
    const envBtn = document.getElementById('harden-fmt-env');
    jsonBtn.classList.toggle('active', isJson);
    jsonBtn.setAttribute('aria-pressed', String(isJson));
    envBtn.classList.toggle('active', !isJson);
    envBtn.setAttribute('aria-pressed', String(!isJson));

    document.getElementById('harden-download').textContent = isJson ? '下载 .json' : '下载 .yml';
  }

  async function openHardenModal() {
    if (!activeGateway()) {
      toast('请先选择网关', 'warn');
      return;
    }

    // Refresh before generating the snippet so a page refresh or a slow API
    // response cannot produce an export with a missing/stale classifier.
    await loadClassifier();
    if (!currentRules.length && !classifierConfig) {
      toast('当前没有可固化的配置', 'warn');
      return;
    }
    renderHarden();
    openModal('harden-modal');
  }

  function downloadHarden() {
    const isJson = hardenFormat === 'json';
    const text = document.getElementById('harden-output').value;
    const blob = new Blob([text], { type: isJson ? 'application/json' : 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isJson ? 'model-mapping-rules.json' : 'model-mapping-rules.env.yml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyHarden() {
    const ta = document.getElementById('harden-output');
    try {
      await navigator.clipboard.writeText(ta.value);
      toast('已复制到剪贴板', 'success');
    } catch (e) {
      ta.select();
      try {
        document.execCommand('copy');
        toast('已复制到剪贴板', 'success');
      } catch (e2) {
        toast('复制失败，请手动选择复制', 'error');
      }
    }
  }

  /* ── event wiring ─────────────────────────────────────── */
  function init() {
    renderGatewaySelect();
    renderGwList();

    document.getElementById('gateway-select').addEventListener('change', (e) => {
      state.activeGatewayId = e.target.value || null;
      persist(state);
      renderGwList();
      loadAll();
    });

    document.getElementById('manage-gateways-btn').addEventListener('click', () => {
      resetGwForm();
      renderGwList();
      openModal('gateway-modal');
    });
    document.getElementById('gw-save').addEventListener('click', handleGwSave);
    document.getElementById('gw-cancel-edit').addEventListener('click', resetGwForm);

    document.getElementById('add-btn').addEventListener('click', () => openRuleForm('add', null));
    document.getElementById('rule-form').addEventListener('submit', handleRuleSubmit);
    document.getElementById('classifier-edit-btn').addEventListener('click', openClassifierForm);
    document.getElementById('classifier-form').addEventListener('submit', handleClassifierSubmit);
    document.getElementById('classifier-reset-btn').addEventListener('click', handleClassifierReset);

    document.getElementById('refresh-btn').addEventListener('click', loadAll);
    document.getElementById('health').addEventListener('click', () => {
      openModal('proxy-modal');
      loadProxyHealth();
    });
    document.getElementById('proxy-refresh-btn').addEventListener('click', loadProxyHealth);
    document.getElementById('reset-btn').addEventListener('click', handleResetAll);
    document.getElementById('harden-btn').addEventListener('click', openHardenModal);
    document.getElementById('harden-copy').addEventListener('click', copyHarden);
    document.getElementById('harden-download').addEventListener('click', downloadHarden);
    document.getElementById('harden-fmt-json').addEventListener('click', () => {
      hardenFormat = 'json';
      renderHarden();
    });
    document.getElementById('harden-fmt-env').addEventListener('click', () => {
      hardenFormat = 'env';
      renderHarden();
    });

    document.getElementById('confirm-ok').addEventListener('click', () => {
      closeModal('confirm-modal');
      const cb = confirmCallback;
      confirmCallback = null;
      if (cb) cb();
    });

    // delegated clicks: close buttons, row actions, gateway actions
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { closeModal(closeBtn.getAttribute('data-close')); return; }

      const upBtn = e.target.closest('[data-move-up]');
      if (upBtn) { reorderRule(+upBtn.getAttribute('data-move-up'), -1); return; }

      const downBtn = e.target.closest('[data-move-down]');
      if (downBtn) { reorderRule(+downBtn.getAttribute('data-move-down'), 1); return; }

      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const r = currentRules[+editBtn.getAttribute('data-edit')];
        if (r) openRuleForm('edit', r);
        return;
      }

      const delBtn = e.target.closest('[data-delete]');
      if (delBtn) {
        const r = currentRules[+delBtn.getAttribute('data-delete')];
        if (r) handleDelete(r.prefix == null ? '' : r.prefix);
        return;
      }

      const actBtn = e.target.closest('[data-gw-activate]');
      if (actBtn) {
        state.activeGatewayId = actBtn.getAttribute('data-gw-activate');
        persist(state);
        renderGatewaySelect();
        renderGwList();
        loadAll();
        return;
      }

      const gwEditBtn = e.target.closest('[data-gw-edit]');
      if (gwEditBtn) { openGwFormForEdit(gwEditBtn.getAttribute('data-gw-edit')); return; }

      const gwDelBtn = e.target.closest('[data-gw-delete]');
      if (gwDelBtn) { handleGwDelete(gwDelBtn.getAttribute('data-gw-delete')); return; }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ['rule-modal', 'gateway-modal', 'confirm-modal', 'proxy-modal'].forEach(closeModal);
      }
    });

    loadAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
