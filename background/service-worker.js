/**
 * new-api CCS 导入助手 — background service worker
 *
 * 职责：
 * 1. AUTHED_FETCH：代 content script 请求 new-api 管理 API。
 *    new-api 后台 API 鉴权 = session cookie + New-Api-User 请求头
 *    （UserAuth 中间件强制要求，见 new-api middleware/auth.go:76-85）。
 *    - cookie：MAIN world 注入执行 fetch，与页面自身请求一致（必带 session）
 *    - New-Api-User 头：由 content script 从 localStorage.user.id 读取后传入
 * 2. OPEN_CCSWITCH_URL：用 chrome.tabs.create 打开 ccswitch:// 深链，
 *    避免 window.open 弹窗拦截。
 */

// 在页面 MAIN world 中执行的函数（必须自包含，不能引用外部变量）
async function mainWorldFetch(url, headers) {
  try {
    const r = await fetch(url, { credentials: 'include', headers: headers || {} });
    let body = null;
    try {
      body = await r.json();
    } catch (_) {
      body = null;
    }
    return { status: r.status, body };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

async function authedFetch(url, headers, tabId) {
  // 首选：MAIN world（与页面同源同 cookie 环境，最可靠）
  if (tabId !== undefined && tabId !== null) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [url, headers],
        func: mainWorldFetch,
      });
      const result = results && results[0] && results[0].result;
      if (result) {
        return { ok: true, status: result.status || 0, body: result.body, error: result.error };
      }
    } catch (_) {
      // 页面受限（chrome:// 等）或注入失败，走回退
    }
  }
  // 回退：background 直接请求（依赖 host_permissions 携带 cookie）
  try {
    const res = await fetch(url, { credentials: 'include', headers: headers || {} });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'AUTHED_FETCH' && typeof message.url === 'string') {
    (async () => {
      const tabId = sender && sender.tab && sender.tab.id;
      const result = await authedFetch(message.url, message.headers || {}, tabId);
      sendResponse(result);
    })();
    return true; // 保持消息通道，异步 sendResponse
  }

  if (message && message.type === 'OPEN_CCSWITCH_URL' && typeof message.url === 'string') {
    if (!message.url.startsWith('ccswitch://')) {
      sendResponse({ ok: false, error: 'invalid url' });
      return false;
    }
    chrome.tabs.create({ url: message.url }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
