# 明星同款舆情风险复审 V3 - 流式同步版

## 本次调整

- 基础数据改为流式加载：
  - 手动同步后首批数据到达即渲染页面。
  - 后续批次在后台继续补全。
  - 不再等全量数据全部读取完成后才显示。
- 回写更及时：
  - 审核变更后约 700ms 触发批量回写。
  - 兜底周期 1.5 秒检查一次。
  - 同一行连续点击只保留最后一次结果，减少请求过多。
- 自动同步更短：
  - 后台动态同步周期改为 60 秒。
  - 后台只同步动态字段：处理人 / 审核状态 / 审核备注 / 审核时间。
  - 基础字段、图片、链接不在后台重复请求。
- 保留 SaaS KV 登录：
  - 用户只点“飞书登录”
  - token 存 KV
  - 前端不保存 access_token
- 保留原处理页面 UI、图片预览、不通过快捷原因、不通过原因不能为空校验、处理人筛选、Excel 合并按钮、领取按钮内进度。

## Cloudflare 需要保证已有

Variables and secrets：

- FEISHU_APP_ID
- FEISHU_APP_SECRET
- FEISHU_REDIRECT_URI

wrangler.toml 已包含：

- FEISHU_KV = 576f4e274ed64404a9519cce09f764dc

## 部署

Cloudflare Pages：
- Build command 留空
- Build output directory 填 public
