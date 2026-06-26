# 明星同款舆情风险复审 V3

## 本次修复

修复“后台权限已开，但同步仍提示未授权”的问题。

原因：
- 飞书后台开通权限，不代表当前 user_access_token 已经带这个权限。
- OAuth 授权链接必须携带 scope。
- 旧 token 必须清掉并重新授权。

本版已固定 OAuth scope：

wiki:node:read sheets:spreadsheet

点击“飞书授权登录”时会自动带上这两个 scope，并清理旧 token 后重新授权。

## 仍需确认

飞书开放平台应用权限里需要开通：
- wiki:node:read
- sheets:spreadsheet

## Cloudflare Pages

Build command：留空  
Build output directory：public
