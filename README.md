# 明星同款舆情风险复审 V3 - SaaS OAuth 最终修正版

## 本次修复

- 修复 OAuth callback 里多个 Set-Cookie 合并写入导致 session cookie 可能丢失的问题。
- callback 写 session 后分别写入：
  - feishu_oauth_state 清理 cookie
  - feishu_session 登录 cookie
- /api/feishu-login 使用 URLSearchParams 统一编码 redirect_uri / state / scope。
- scope 保留飞书官方空格分隔格式，支持用 Cloudflare 变量 FEISHU_OAUTH_SCOPE 覆盖。
- callback 没有 code 时给出明确提示：必须从页面点击“飞书登录”，不能直接打开 callback 地址。
- 保留 SaaS KV 登录、多用户隔离、自动刷新 token、后台动态同步、5秒周期批量回写等稳定版能力。

## Cloudflare 需要保证已有

Variables and secrets：

- FEISHU_APP_ID
- FEISHU_APP_SECRET
- FEISHU_REDIRECT_URI

wrangler.toml 已包含：

- FEISHU_KV = 576f4e274ed64404a9519cce09f764dc

## 飞书后台重定向 URL

必须存在且完全一致：

https://bqsh.pages.dev/api/feishu-oauth-callback

## 部署

Cloudflare Pages：

- Build command 留空
- Build output directory 填 public

重新上传/部署后，清理浏览器 cookie，再从页面点击“飞书登录”。
