# 明星同款舆情风险复审 V3 - 飞书授权模式

## 本次修复

1. 修复“数据源设置”点不开  
原因：前端脚本里出现了非 async 函数使用 await，导致整段 JS 直接报错，按钮事件没有绑定。

2. App Secret 改为点击“飞书授权登录”时填写  
不放在数据源设置里。  
不需要 Cloudflare 环境变量。

## Cloudflare Pages 设置

Build command：留空  
Build output directory：public

## 飞书开放平台

回调地址填你的 Cloudflare 页面地址，例如：

https://你的项目.pages.dev/

必须和网页实际访问地址一致。
