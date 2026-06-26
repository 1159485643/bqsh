# 明星同款舆情风险复审 V3 - 保留原登录方式 + 流式同步版

## 本版保留

- 保留你上传的这一版登录方式：
  - 前端填写 App ID / App Secret
  - 点击飞书授权登录
  - token 保存在当前浏览器
  - 不使用 SaaS KV 登录
- 保留原 UI、图片预览、处理人筛选、Excel 合并按钮、领取任务、不通过快捷原因、不通过原因不能为空校验。

## 同步过来的优化

- 基础数据改成流式加载：
  - 首批数据到达即展示
  - 后续批次后台继续补全
  - 不再等全量读取完才显示页面
- 动态同步优化：
  - 周期改为 60 秒
  - 只同步动态字段：处理人 / 审核状态 / 审核备注 / 审核时间
  - 有变更时 30 秒后再同步
  - 无变更时 60 秒后同步
  - 失败自动退避重试
  - 单线程 setTimeout 自调度，避免 setInterval 重叠卡死
  - 登录刷新、回写、动态同步均有超时保护
- 回写优化：
  - 审核操作后约 700ms 触发回写
  - 1.5 秒兜底检查
  - 同一行连续修改只保留最后一次
- OAuth scope 补齐：
  - wiki:node:read
  - sheets:spreadsheet
  - sheets:spreadsheet:read
  - sheets:spreadsheet:write

## Cloudflare Pages

- Build command 留空
- Build output directory 填 public
