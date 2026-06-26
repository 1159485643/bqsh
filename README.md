# 明星同款舆情风险复审 V3 - SaaS KV 登录版

## 这版改动

- 前端已去掉 App ID / App Secret 输入。
- 用户只需要点击“飞书登录”。
- OAuth 登录由 Cloudflare Functions 处理。
- token 存入 Cloudflare KV，按浏览器 session 隔离。
- 前端不再保存 user_access_token。
- feishu-proxy 自动从 cookie + KV 获取 token，并在需要时刷新。
- 保留之前稳定版能力：
  - 手动同步基础数据
  - 后台只同步动态字段：处理人 / 审核状态 / 审核备注 / 审核时间
  - 5秒周期批量回写
  - 防请求过多退避
  - 原 UI、图片预览、不通过快捷原因、不通过原因不能为空校验
  - 处理人筛选、Excel 合并按钮、领取按钮内进度

## Cloudflare 需要配置

Variables and secrets 中你只需要保证已有：

- FEISHU_APP_ID
- FEISHU_APP_SECRET
- FEISHU_REDIRECT_URI

KV 已写入 wrangler.toml：

- binding: FEISHU_KV
- id: 576f4e274ed64404a9519cce09f764dc

## 飞书后台回调地址

必须和 Cloudflare 的 FEISHU_REDIRECT_URI 完全一致，例如：

https://你的域名/api/feishu-oauth-callback

## Cloudflare Pages

- Build command 留空
- Build output directory 填 public

改完变量和 wrangler.toml 后需要重新部署。
