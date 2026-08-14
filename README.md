# new-api CCS 导入助手（浏览器扩展）

在任意 new-api 后台页面一键导入渠道到 **CC Switch**（Claude Code / Codex / Gemini CLI 的供应商切换工具），并自动配置**用户额度查询**。

> 📖 完整操作步骤见 [使用指南.md](./使用指南.md)

## 功能

- 访问 new-api 后台时，页面右下角出现「导入CCS」悬浮按钮（非 new-api 页面零注入）
- 弹窗内选择应用（Claude / Codex，Gemini 暂时隐藏）、填写令牌 apikey 即可
- 模型默认预填：Claude → `claude-opus-5`，Codex → `gpt-5.5`（可手输或下拉修改）
- 自动复用当前登录会话获取用户 ID（`GET /api/user/self`），并自动生成/复用访问令牌（`GET /api/user/token`，按站点缓存）
- 一键生成 `ccswitch://v1/import` 深链，唤起 CC Switch 完成导入，同时自动写入用量查询脚本（查询 `GET /api/user/self` 的用户额度，500000 quota = 1 USD 换算显示）

## 安装（开发者模式）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本文件夹
4. 打开任意 new-api 后台页面，右下角即出现「导入CCS」按钮

## 使用

1. 在 new-api 后台登录
2. 点击「导入CCS」→ 选择应用（模型已自动预填，可直接用）→ 填写令牌 apikey（`sk-...`）
3. 点击「开始导入」
4. 浏览器弹出「打开 CC Switch？」确认 → 允许
5. 在 CC Switch 导入确认框里核对配置（含用量查询脚本正文）→ 确认导入

导入后 CC Switch 卡片底部会显示该**用户账号**的余额条（每 5 分钟自动刷新；自动刷新仅在卡片处于启用状态时触发）。

> 深链参数 `enabled=false`：导入后的 provider **默认不启用**，请在 CC Switch 中手动切换到该供应商后再使用；启用后余额才会开始自动刷新。

## 权限说明

- `storage`：缓存访问令牌（仅存本地）
- 内容脚本 + `host_permissions` 匹配 `http://*/*`、`https://*/*`：因 new-api 部署域名不固定，安装时 Chrome 会提示「读取所有网站数据」
  - 内容脚本：只会在检测到 new-api 后台特征（localStorage 中的 `status` 缓存）时才注入按钮
  - `host_permissions`：让 background 的请求能携带站点 session cookie（new-api 后台 API 的鉴权方式）并免除 CORS 限制；不会主动读取任何页面数据

## ⚠️ 访问令牌（AT）注意事项

- 首次导入时插件会调用 `GET /api/user/token` 生成访问令牌，**该操作会作废你之前在 new-api 生成的旧访问令牌**（new-api 后端行为：直接覆盖存储）
- 生成后按站点缓存在 `chrome.storage.local`，后续导入复用，不会重复轮换
- 如需更换，弹窗底部「重新生成访问令牌」为两步确认，点击后旧 AT 立即失效

## 安全说明

- 深链中含完整凭据（apikey、访问令牌、用户 ID），**请勿将生成的链接分享到公开场合**
- 所有凭据只保存在浏览器本地存储中，不向任何第三方发送
- CC Switch 导入确认框会完整展示用量查询脚本正文，请确认后再导入

## 常见问题

| 问题 | 处理 |
|---|---|
| 弹窗提示「未检测到登录状态」 | 先在 new-api 后台登录；若已登录仍提示，确认扩展已重新加载（manifest 更新后需在 chrome://extensions 点刷新并同意新权限） |
| 点击导入后无反应 | 确认已安装 CC Switch 且注册了 `ccswitch://` 协议（便携版换版本后协议可能失效，需重注册） |
| 卡片余额不显示/显示异常 | 确认 new-api 默认换算比（QuotaPerUnit = 500000）未被修改；卡片需处于启用状态才会自动刷新 |
| 提示「无法打开 CC Switch」 | 检查浏览器外部协议弹窗是否被拦截 |

## 文件结构

```
manifest.json                  MV3 配置（content_scripts + storage + background）
shared/deeplink.js             深链构建器（Base64 用量脚本、协议参数）
background/service-worker.js   用 chrome.tabs.create 打开 ccswitch:// 链接
content/index.js               站点检测 + 悬浮按钮注入（shadow DOM）
content/modal.js               弹窗 UI 与导入流程（AT 获取/缓存）
```
