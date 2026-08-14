/**
 * new-api CCS 导入助手 — 深链构建器
 *
 * 与 new-api 前端 CCSwitchModal.jsx 的 buildCCSwitchURL 参数保持一致，
 * 并扩展用量查询参数（用户额度）：
 *   - usageScript       用量查询脚本（CC Switch 要求 Base64 编码）
 *   - usageEnabled=true 显式启用（CC Switch >= 3.19.0 要求）
 *   - usageAutoInterval 自动刷新间隔（分钟）
 *   - usageAccessToken / usageUserId 脚本占位符的凭据来源
 *
 * 协议解析参考：CC Switch src-tauri/src/deeplink/provider.rs
 */

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: '深夜API',
    defaultModel: 'claude-opus-5',
    modelFields: [{ key: 'model', label: '主模型', required: true }],
  },
  codex: {
    label: 'Codex',
    defaultName: '深夜API',
    defaultModel: 'gpt-5.5',
    modelFields: [{ key: 'model', label: '主模型', required: true }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: '深夜API',
    defaultModel: '',
    modelFields: [{ key: 'model', label: '主模型', required: true }],
  },
};

/** UTF-8 安全 Base64（原生 btoa 不支持非 Latin1 字符） */
function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * 生成用户额度查询脚本（查询 new-api /api/user/self）
 * 占位符 {{accessToken}} / {{userId}} 由 CC Switch 从用量配置中自动替换
 */
function buildUsageScript(serverAddress) {
  return `({
  request: {
    url: "${serverAddress}/api/user/self",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{accessToken}}",
      "New-Api-User": "{{userId}}"
    }
  },
  extractor: function (response) {
    if (response.success && response.data) {
      return {
        planName: response.data.group || "Default Plan",
        remaining: response.data.quota / 500000,
        used: response.data.used_quota / 500000,
        total: (response.data.quota + response.data.used_quota) / 500000,
        unit: "USD"
      };
    }
    return { isValid: false, invalidMessage: response.message || "Query failed" };
  }
})`;
}

/**
 * 构建 ccswitch://v1/import 深链
 * @param {object} opts
 * @param {'claude'|'codex'|'gemini'} opts.app 目标应用
 * @param {string} opts.name 显示名称
 * @param {string} opts.serverAddress new-api 服务器地址（不含 /v1）
 * @param {string} opts.apiKey 令牌 key（sk-...）
 * @param {object} opts.models 模型映射 { model?, haikuModel?, sonnetModel?, opusModel? }
 * @param {string} [opts.accessToken] 用户访问令牌（用量查询用）
 * @param {number|string} [opts.userId] 用户 ID（用量查询用）
 * @returns {string} ccswitch:// 深链
 */
function buildDeepLink({ app, name, serverAddress, apiKey, models = {}, accessToken, userId }) {
  const endpoint = app === 'codex' ? serverAddress + '/v1' : serverAddress;
  const params = new URLSearchParams();
  params.set('resource', 'provider');
  params.set('app', app);
  params.set('name', name);
  params.set('endpoint', endpoint);
  params.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(models)) {
    if (v) params.set(k, v);
  }
  params.set('homepage', serverAddress);
  // 导入后默认不启用，由用户在 CC Switch 中手动切换
  params.set('enabled', 'false');
  // 用量查询：用户额度
  params.set('usageScript', base64EncodeUtf8(buildUsageScript(serverAddress)));
  params.set('usageEnabled', 'true');
  params.set('usageAutoInterval', '5');
  if (accessToken) params.set('usageAccessToken', accessToken);
  if (userId !== undefined && userId !== null && userId !== '') {
    params.set('usageUserId', String(userId));
  }
  return `ccswitch://v1/import?${params.toString()}`;
}
