# 明星同款舆情风险复审 V3

## 本次修复

修复飞书链接无法解析 spreadsheet token 的问题。

现在支持：
- 标准 Sheets 链接：/sheets/shtxxxx
- /sheet/、/spreadsheet/、/spreadsheets/ 形式
- URL 参数里的 spreadsheet_token / spreadsheetToken / sheet_token
- 被复制到一段文本里的链接
- 被 encode 的链接
- 知识库里的电子表格链接：/wiki/wikxxxx，会通过 Wiki get_node 解析 obj_token
- 对多维表格 base、普通 doc/docx 给出明确错误

## Cloudflare Pages 设置

Build command：留空  
Build output directory：public
