# Checklist — new-api CCS 导入助手（多会话同步）

> 存放位置：`E:\workspace\new-api-ccs-extension\`（独立于 new-api 仓库，避免污染仓库目录）

## 功能

在任意 new-api 后台页面通过悬浮按钮一键导入渠道到 CC Switch，并自动配置**用户额度**查询。

## 已确认设计决策

- UI 形态：页面悬浮按钮（content script 注入，shadow DOM 隔离）
- AT 策略：自动调用 `GET /api/user/token` 生成 + `chrome.storage.local` 按 origin 缓存复用
- 应用范围：Claude / Codex / Gemini 三选，模型字段跟随应用变化
- 打开方式：background service worker 用 `chrome.tabs.create` 打开 `ccswitch://` 深链（规避弹窗拦截）

## 关键接口事实（已验证，勿重复调查）

| 接口 | 行为 | 出处 |
|---|---|---|
| `GET /api/user/self` | 会话 cookie 鉴权，返回 `data.id`（userId）、`data.quota`/`used_quota`（用户额度） | new-api `controller/user.go:368` |
| `GET /api/user/token` | 每次调用生成**全新 AT 并作废旧 AT**（`SetAccessToken` + `Update`），返回 `data` 为 AT 字符串 | new-api `controller/user.go:284-314` |
| `GET /api/usage/token/` | 令牌级额度（`Bearer sk-xxx`），本插件未用 | new-api `controller/token.go:118` |
| `ccswitch://v1/import` | `usageScript` 必须 Base64；`usageEnabled=true` 显式启用；`usageAccessToken`/`usageUserId` 直接传；codex 的 endpoint 带 `/v1` | CC Switch `src-tauri/src/deeplink/provider.rs` |
| 前端 API 鉴权方式 | 后台 API 靠 **session cookie** 鉴权（axios 只发 `New-API-User` 头，登录响应无 token 字段）；MV3 content script fetch 不携带页面 cookie | new-api `middleware/auth.go:33-51`、`web/src/helpers/api.js:29-37`、`controller/user.go:88-112` |

## 已修复问题记录

- [x] 「未检测到登录状态」（第一轮）：误以为前端用 `Authorization: Bearer localStorage.user.token` → 实际登录响应无 token 字段，此方案无效
- [x] 「未检测到登录状态」（第二轮）：content script fetch 不带 cookie → 改为 background 直连 fetch（host_permissions 带 cookie）——仍失败（待用户确认权限是否重授）
- [x] 「未检测到登录状态」（第三轮）：`chrome.scripting.executeScript` 在页面 **MAIN world** 执行 fetch；API URL 改用 `serverAddress`；弹窗增加诊断输出
- [x] 「未检测到登录状态」（第四轮，真正病根，已通过诊断输出定位）：后端报 `无权进行此操作，未提供 New-Api-User` —— cookie 早已正常（session 通过了），**缺的是 `New-Api-User` 请求头**（UserAuth 中间件强制要求，前端 axios 默认携带）。修复：插件请求统一带 `New-API-User: localStorage.user.id`（v1.0.4）
- [x] 排查确认：用户确认弹窗「服务器」值与地址栏域名一致（love-long.com），排除前后端分域部署
- [x] 排查确认（诊断输出 v1.0.3）：`localStorage.user` 存在；MAIN world 请求 ok=true；cookie 传递正常（后端已过 session 检查）

## 任务清单

- [x] 1. 创建 `manifest.json`（MV3、content_scripts、storage 权限、background service worker）
- [x] 2. 实现 `shared/deeplink.js`（深链构建：usageScript Base64、usageEnabled、usageAutoInterval、usageAccessToken、usageUserId）
- [x] 3. 实现 `background/service-worker.js`（消息接收 + `chrome.tabs.create` 打开协议链接）
- [x] 4. 实现 `content/index.js`（new-api 站点检测 + 悬浮按钮注入）
- [x] 5. 实现 `content/modal.js`（弹窗：应用三选、模型字段、apikey 输入、AT 状态展示）
- [x] 6. 实现 AT 自动获取 + 缓存（轮换两步确认、按 origin 缓存、重新生成入口）
- [x] 7. 导入流程串接（user/self → userId → 深链 → background 打开）与错误处理（未登录/网络失败）
- [x] 8. 编写 `README.md`（安装、使用、AT 轮换警告、安全说明）
- [x] 10. 简化操作（v1.0.5）：隐藏 Gemini、模型按 `/api/models` 可用列表智能预填默认值
- [x] 11. 进一步简化（v1.0.6）：Claude/Codex 各只留一个主模型输入框；默认值改为硬编码（Claude: `claude-opus-5`，Codex: `gpt-5.5`）
- [x] 12. 默认名称统一为「深夜API」（v1.0.7）
- [x] 13. 初始化 git 并推送 GitHub（`usernamepangdun/new-api-ccs-extension`，commit `f5de875`，main 分支已同步）
- [x] 14. 导入后 provider 默认不启用（`enabled=false`，v1.0.8）
- [ ] 9. 加载实测验证（chrome://extensions 加载 → new-api 站点实测导入）

## 后续可选优化（未排期）

- 用量查询脚本换算比（500000:1）改为可配置
- 支持同时配置「令牌级额度」查询（`/api/usage/token/` 脚本，与用户额度二选一）
- Popup 形态双入口
