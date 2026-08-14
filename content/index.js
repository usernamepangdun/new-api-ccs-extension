/**
 * new-api CCS 导入助手 — 入口
 *
 * 检测 new-api 后台页面（前端会缓存 /api/status 结果到 localStorage.status，
 * 与 CCSwitchModal.jsx 的 getServerAddress 读取方式一致），
 * 检测通过后注入右下角「导入CCS」悬浮按钮（shadow DOM 隔离样式）。
 * 非 new-api 页面零注入。
 */
(function () {
  if (window.top !== window) return; // 仅顶层窗口
  if (document.documentElement.dataset.ccsImporterInjected) return;

  // new-api 后台检测
  function isNewApiDashboard() {
    try {
      const raw = localStorage.getItem('status');
      if (!raw) return false;
      const status = JSON.parse(raw);
      return Boolean(status && (status.server_address || status.version !== undefined));
    } catch (_) {
      return false;
    }
  }

  if (!isNewApiDashboard()) return;

  document.documentElement.dataset.ccsImporterInjected = '1';

  // 服务器地址：优先取后台状态缓存，回退当前站点 origin
  function getServerAddress() {
    try {
      const raw = localStorage.getItem('status');
      if (raw) {
        const status = JSON.parse(raw);
        if (status.server_address) return status.server_address.replace(/\/+$/, '');
      }
    } catch (_) {}
    return window.location.origin;
  }

  const host = document.createElement('div');
  host.id = 'ccs-importer-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .ccs-float-btn {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483646;
      padding: 10px 18px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(135deg, #7c3aed, #6366f1);
      color: #fff;
      font: 600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.45);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .ccs-float-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(99, 102, 241, 0.55);
    }

    .ccs-modal-mask {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 15, 25, 0.45);
    }
    .ccs-modal-card {
      width: 440px;
      max-width: calc(100vw - 32px);
      max-height: 84vh;
      overflow-y: auto;
      padding: 20px 22px;
      border-radius: 14px;
      background: #fff;
      color: #1f2329;
      font: 13px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    }
    .ccs-modal-title {
      margin: 0 0 4px;
      font-size: 16px;
      font-weight: 600;
    }
    .ccs-field { margin-top: 12px; }
    .ccs-label { display: block; margin-bottom: 4px; font-size: 12px; color: #4b5563; }
    .ccs-label .req { color: #dc2626; }
    .ccs-input {
      box-sizing: border-box;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font: inherit;
      outline: none;
    }
    .ccs-input:focus { border-color: #7c3aed; }
    .ccs-seg { display: flex; gap: 6px; }
    .ccs-seg button {
      flex: 1;
      padding: 7px 0;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      color: #374151;
      font: inherit;
      cursor: pointer;
    }
    .ccs-seg button.active {
      border-color: #7c3aed;
      background: #f5f3ff;
      color: #7c3aed;
      font-weight: 600;
    }
    .ccs-note { margin-top: 10px; font-size: 12px; color: #6b7280; }
    .ccs-status { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: #f3f4f6; font-size: 12px; color: #374151; }
    .ccs-status.ok { background: #ecfdf5; color: #047857; }
    .ccs-error { margin-top: 10px; font-size: 12px; color: #dc2626; }
    .ccs-actions { display: flex; gap: 10px; margin-top: 16px; }
    .ccs-btn {
      flex: 1;
      padding: 9px 0;
      border: none;
      border-radius: 8px;
      font: 600 13px/1.4 system-ui, sans-serif;
      cursor: pointer;
    }
    .ccs-btn.primary { background: linear-gradient(135deg, #7c3aed, #6366f1); color: #fff; }
    .ccs-btn.ghost { background: #f3f4f6; color: #374151; }
    .ccs-btn.danger { background: #fee2e2; color: #b91c1c; }
    .ccs-toast {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #ecfdf5;
      color: #047857;
      font-size: 12px;
    }
    .ccs-diag {
      margin-top: 10px;
      max-height: 220px;
      overflow: auto;
      padding: 10px;
      border-radius: 8px;
      background: #1f2937;
      color: #d1fae5;
      font: 11px/1.6 ui-monospace, Consolas, "Courier New", monospace;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;
  shadow.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'ccs-float-btn';
  btn.textContent = '导入CCS';
  btn.addEventListener('click', () => {
    openModal({ serverAddress: getServerAddress(), shadow });
  });
  shadow.appendChild(btn);
})();
