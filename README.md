# 明星同款舆情风险复审 V3

## 已检查内容

- 单个前端页面：public/index.html
- 飞书授权登录在当前页面窗口输入 App ID / App Secret
- 授权时自动携带 scope：
  - wiki:node:read
  - sheets:spreadsheet
- 数据源设置只保留：
  - 飞书链接
  - 处理人姓名
- 以下字段固定，不支持修改：
  - 处理人
  - 审核状态
  - 审核备注
  - 审核时间
- 读取整张表，不在页面设置最大行数
- 后端分块读取，每次 500 行，避免飞书 10MB 限制
- 支持标准 Sheets 链接和 Wiki 中的 Sheets 链接解析

## Cloudflare Pages

Build command：留空  
Build output directory：public
