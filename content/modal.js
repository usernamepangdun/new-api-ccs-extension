/**
 * new-api CCS 导入助手 — 弹窗
 *
 * 流程：
 *   1. 用户填 apikey、选应用与模型
 *   2. 点击「开始导入」→ 后台自动：
 *      - GET /api/user/self（会话 cookie）→ userId、用户额度
 *      - 获取访问令牌 AT：chrome.storage.local 按站点缓存复用；
 *        首次或手动重新生成时调 GET /api/user/token
 *        ⚠️ 该接口会作废旧的访问令牌（new-api 行为：SetAccessToken 覆盖）
 *   3. 组装 ccswitch://v1/import 深链（含用户额度查询脚本）
 *   4. 交给 background 用 chrome.tabs.create 打开，唤起 CC Switch
 */
const EXT_VERSION = '1.0.8';

function openModal({ serverAddress, shadow }) {
  if (shadow.querySelector('.ccs-modal-mask')) return; // 已打开

  const mask = document.createElement('div');
  mask.className = 'ccs-modal-mask';
  mask.innerHTML = `
    <div class="ccs-modal-card">
      <h3 class="ccs-modal-title">导入到 CC Switch</h3>
      <div class="ccs-note">服务器：<b></b>　|　用量查询：用户额度（自动配置）　|　v${EXT_VERSION}</div>

      <div class="ccs-field">
        <span class="ccs-label">应用</span>
        <div class="ccs-seg" id="ccs-app-seg"></div>
      </div>

      <div class="ccs-field">
        <label class="ccs-label" for="ccs-name">名称</label>
        <input class="ccs-input" id="ccs-name" />
      </div>

      <div id="ccs-model-fields"></div>

      <div class="ccs-field">
        <label class="ccs-label" for="ccs-apikey">令牌 apikey<span class="req"> *</span></label>
        <input class="ccs-input" id="ccs-apikey" placeholder="sk-..." autocomplete="off" />
      </div>

      <div class="ccs-status" id="ccs-at-status">正在检测登录状态…</div>

      <div class="ccs-error" id="ccs-error"></div>
      <div class="ccs-toast" id="ccs-toast" style="display:none"></div>
      <pre class="ccs-diag" id="ccs-diag" style="display:none"></pre>

      <div class="ccs-actions">
        <button class="ccs-btn ghost" id="ccs-cancel">取消</button>
        <button class="ccs-btn ghost" id="ccs-diag-btn">诊断</button>
        <button class="ccs-btn primary" id="ccs-submit">开始导入</button>
      </div>
      <div class="ccs-note" id="ccs-regenerate-area" style="display:none">
        <button class="ccs-btn danger" id="ccs-regenerate" style="width:100%">重新生成访问令牌</button>
      </div>
    </div>
  `;
  shadow.appendChild(mask);

  const card = mask.querySelector('.ccs-modal-card');
  card.querySelector('.ccs-note b').textContent = serverAddress;

  // ---------- 状态 ----------
  let app = 'claude';
  let models = {}; // { model, haikuModel, sonnetModel, opusModel }
  let cachedAt = null; // { token, userId, ts }
  let userInfo = null; // { id, quota, used_quota, group }
  let regenerateArmed = false;
  let regenerateTimer = null;

  const $ = (sel) => mask.querySelector(sel);
  const seg = $('#ccs-app-seg');
  const nameInput = $('#ccs-name');
  const modelFieldsEl = $('#ccs-model-fields');
  const apiKeyInput = $('#ccs-apikey');
  const atStatusEl = $('#ccs-at-status');
  const errorEl = $('#ccs-error');
  const toastEl = $('#ccs-toast');
  const regenerateArea = $('#ccs-regenerate-area');
  const regenerateBtn = $('#ccs-regenerate');

  // Gemini 暂时隐藏（按需求）
  const VISIBLE_APPS = ['claude', 'codex'];
  let modelNames = []; // /api/models 返回的可用模型名

  // ---------- 表单渲染 ----------
  function renderAppSeg() {
    seg.innerHTML = '';
    for (const [key, cfg] of Object.entries(APP_CONFIGS)) {
      if (!VISIBLE_APPS.includes(key)) continue; // 隐藏的应用
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = cfg.label;
      b.classList.toggle('active', key === app);
      b.addEventListener('click', () => {
        app = key;
        nameInput.value = APP_CONFIGS[key].defaultName;
        models = {};
        renderAppSeg();
        applyModelDefaults();
      });
      seg.appendChild(b);
    }
  }

  function renderModelFields() {
    modelFieldsEl.innerHTML = '';
    const cfg = APP_CONFIGS[app];
    for (const field of cfg.modelFields) {
      const wrap = document.createElement('div');
      wrap.className = 'ccs-field';
      const label = document.createElement('label');
      label.className = 'ccs-label';
      label.textContent = field.label + (field.required ? ' ' : '');
      if (field.required) {
        const req = document.createElement('span');
        req.className = 'req';
        req.textContent = '*';
        label.appendChild(req);
      }
      const input = document.createElement('input');
      input.className = 'ccs-input';
      input.id = 'ccs-model-' + field.key;
      input.placeholder = '请选择或输入模型名';
      input.setAttribute('list', 'ccs-model-list');
      input.value = models[field.key] || '';
      input.addEventListener('input', () => {
        models[field.key] = input.value.trim();
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      modelFieldsEl.appendChild(wrap);
    }
    // 共享 datalist（模型选项由 /api/models 会话接口提供）
    if (!$('#ccs-model-list')) {
      const dl = document.createElement('datalist');
      dl.id = 'ccs-model-list';
      modelFieldsEl.appendChild(dl);
    }
  }

  function setError(msg) {
    errorEl.textContent = msg || '';
  }

  function setStatus(text, ok) {
    atStatusEl.textContent = text;
    atStatusEl.classList.toggle('ok', Boolean(ok));
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.style.display = '';
  }

  // ---------- 接口调用 ----------
  // new-api 后台 API 鉴权 = session cookie + New-Api-User 请求头（UserAuth 中间件强制要求，
  // 前端 axios 默认携带，见 new-api web/src/helpers/api.js:34 与 middleware/auth.go:76-85）。
  // cookie 由 MAIN world 注入解决；New-Api-User 头从 localStorage.user.id 读取。
  function getUserId() {
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        const user = JSON.parse(raw);
        if (user && user.id !== undefined) return String(user.id);
      }
    } catch (_) {}
    return '';
  }

  async function apiGet(path) {
    const url = serverAddress + path;
    const headers = { 'New-API-User': getUserId() };
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'AUTHED_FETCH', url, headers });
      if (resp && resp.ok) {
        return { status: resp.status, body: resp.body || {} };
      }
      if (resp && !resp.ok) throw new Error(resp.error || '请求失败');
    } catch (_) {}
    // background 不可用时降级直连
    try {
      const res = await fetch(url, { credentials: 'include', headers });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        body = null;
      }
      return { status: res.status, body: body || {} };
    } catch (e) {
      return { status: 0, body: null, error: String(e) };
    }
  }

  async function loadUserInfo() {
    try {
      const { status, body } = await apiGet('/api/user/self');
      if (body && body.success && body.data) {
        userInfo = body.data;
        const quotaUsd = ((body.data.quota || 0) / 500000).toFixed(2);
        const usedUsd = ((body.data.used_quota || 0) / 500000).toFixed(2);
        setStatus(
          `已登录：用户 #${body.data.id}（${body.data.username || ''}）｜ 余额 $${quotaUsd} / 已用 $${usedUsd} ｜ 分组：${body.data.group || 'default'}`,
          true,
        );
        return body.data;
      }
      setStatus(
        `登录检测失败 [HTTP ${status}]：${(body && body.message) || '无响应'}｜请确认已登录 new-api 后台`,
        false,
      );
      return null;
    } catch (_) {
      setStatus('登录状态检测失败（网络错误）', false);
      return null;
    }
  }

  // 自动预填默认模型（Claude: claude-opus-5，Codex: gpt-5.5；仍可手输/下拉修改）
  function applyModelDefaults() {
    const cfg = APP_CONFIGS[app];
    models = { model: cfg.defaultModel || '' };
    renderModelFields();
  }

  async function loadModelOptions() {
    try {
      const { body } = await apiGet('/api/models');
      const list = Array.isArray(body && body.data) ? body.data : [];
      const names = list
        .map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model || ''))
        .filter(Boolean);
      const dl = $('#ccs-model-list');
      if (dl) {
        for (const n of names) {
          const opt = document.createElement('option');
          opt.value = n;
          dl.appendChild(opt);
        }
      }
      modelNames = names;
    } catch (_) {
      // 模型候选获取失败不影响使用（仍可手输）
    }
  }

  function atStorageKey() {
    return 'ccsAt:' + location.origin;
  }

  async function loadCachedAt() {
    try {
      const data = await chrome.storage.local.get(atStorageKey());
      cachedAt = data[atStorageKey()] || null;
      if (cachedAt) {
        regenerateArea.style.display = '';
      }
    } catch (_) {}
  }

  async function generateAccessToken() {
    const { body } = await apiGet('/api/user/token');
    if (!body || !body.success || typeof body.data !== 'string') {
      throw new Error(body && body.message ? body.message : '访问令牌生成失败');
    }
    return body.data;
  }

  async function ensureAccessToken() {
    if (cachedAt && cachedAt.token) return cachedAt;
    const token = await generateAccessToken();
    cachedAt = { token, userId: userInfo ? userInfo.id : '', ts: Date.now() };
    try {
      await chrome.storage.local.set({ [atStorageKey()]: cachedAt });
    } catch (_) {}
    regenerateArea.style.display = '';
    return cachedAt;
  }

  // ---------- 诊断（输出到弹窗内，便于排查） ----------
  async function runDiagnostics() {
    const lines = [];
    lines.push('插件版本: ' + EXT_VERSION);
    lines.push('页面 origin: ' + location.origin);
    lines.push('serverAddress: ' + serverAddress);
    try {
      const keys = (document.cookie || '')
        .split(';')
        .map((s) => s.trim().split('=')[0])
        .filter(Boolean);
      lines.push(
        'document.cookie 可见键: ' + (keys.length ? keys.join(', ') : '(空 —— 可能为 HttpOnly，属正常)'),
      );
    } catch (e) {
      lines.push('document.cookie 读取异常: ' + String(e));
    }
    try {
      const raw = localStorage.getItem('user');
      lines.push('localStorage.user: ' + (raw ? '存在，内容: ' + raw.slice(0, 100) : '不存在'));
    } catch (e) {
      lines.push('localStorage.user 读取异常: ' + String(e));
    }
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'AUTHED_FETCH',
        url: serverAddress + '/api/user/self',
        headers: { 'New-API-User': getUserId() },
      });
      lines.push(
        'AUTHED_FETCH: ok=' + Boolean(resp && resp.ok) +
        ', status=' + (resp && resp.status) +
        ', body=' + JSON.stringify(resp && resp.body).slice(0, 200),
      );
    } catch (e) {
      lines.push('AUTHED_FETCH 异常: ' + String(e));
    }
    try {
      const res = await fetch(serverAddress + '/api/user/self', { credentials: 'include' });
      const text = await res.text();
      lines.push('直接 fetch 对照: status=' + res.status + ', body=' + text.slice(0, 200));
    } catch (e) {
      lines.push('直接 fetch 异常: ' + String(e));
    }
    const diagEl = $('#ccs-diag');
    diagEl.textContent = lines.join('\n');
    diagEl.style.display = '';
  }

  $('#ccs-diag-btn').addEventListener('click', runDiagnostics);

  // ---------- 重新生成（会作废旧 AT，两步确认） ----------
  regenerateBtn.addEventListener('click', async () => {
    if (!regenerateArmed) {
      regenerateArmed = true;
      regenerateBtn.textContent = '确认作废旧访问令牌并重新生成？';
      regenerateTimer = setTimeout(() => {
        regenerateArmed = false;
        regenerateBtn.textContent = '重新生成访问令牌';
      }, 5000);
      return;
    }
    clearTimeout(regenerateTimer);
    regenerateArmed = false;
    regenerateBtn.textContent = '重新生成访问令牌';
    setError('');
    try {
      const token = await generateAccessToken();
      cachedAt = { token, userId: userInfo ? userInfo.id : '', ts: Date.now() };
      await chrome.storage.local.set({ [atStorageKey()]: cachedAt });
      showToast('访问令牌已重新生成并缓存');
    } catch (e) {
      setError(e.message || '重新生成失败');
    }
  });

  // ---------- 导入 ----------
  async function handleImport() {
    setError('');

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      setError('请填写令牌 apikey（sk-...）');
      return;
    }
    const requiredField = APP_CONFIGS[app].modelFields.find((f) => f.required);
    if (requiredField && !models[requiredField.key]) {
      setError(`请填写${requiredField.label}`);
      return;
    }
    if (!userInfo) {
      setError('请先登录 new-api 后台');
      return;
    }

    const submitBtn = $('#ccs-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '导入中…';
    try {
      const at = await ensureAccessToken();
      const name = nameInput.value.trim() || APP_CONFIGS[app].defaultName;
      const url = buildDeepLink({
        app,
        name,
        serverAddress,
        apiKey,
        models,
        accessToken: at.token,
        userId: at.userId || userInfo.id,
      });
      let opened = false;
      try {
        await chrome.runtime.sendMessage({ type: 'OPEN_CCSWITCH_URL', url });
        opened = true;
      } catch (_) {
        // background 不可用时降级
        try {
          window.open(url, '_blank');
          opened = true;
        } catch (_) {}
      }
      if (opened) {
        showToast('已发起导入，请在 CC Switch 确认弹窗中完成导入');
        setTimeout(() => close(), 1600);
      } else {
        setError('无法打开 CC Switch，请确认已安装并注册 ccswitch:// 协议');
      }
    } catch (e) {
      setError(e.message || '导入失败');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '开始导入';
    }
  }

  function close() {
    mask.remove();
  }

  $('#ccs-cancel').addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  $('#ccs-submit').addEventListener('click', handleImport);

  // ---------- 初始化 ----------
  renderAppSeg();
  nameInput.value = APP_CONFIGS.claude.defaultName;
  applyModelDefaults();
  loadUserInfo();
  loadModelOptions();
  loadCachedAt();
}
