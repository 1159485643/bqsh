# 明星同款舆情风险复审 V3

## Cloudflare Pages 部署
1. 上传整个仓库到 GitHub
2. Cloudflare Pages -> Connect to Git
3. Build command 留空
4. Build output directory 填 public
5. 部署完成后访问 pages.dev 地址

## 目录
public/index.html
functions/api/feishu-proxy.js
wrangler.toml

## 飞书权限
需要飞书应用具备 Sheets 读取和写入权限，并确保应用有权限访问对应表格。
