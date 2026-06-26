# 明星同款舆情风险复审 V3 - 动态同步稳定版

## 本次复核结论

动态同步卡在 0s 的真正原因是：

- SaaS 登录版前端本地只保存 `{ session: true }`
- 旧 `silentSyncFeishuData()` 仍然判断 `token.access_token / user_access_token`
- 因此动态同步函数直接 return，没有重新设置下一次同步时间
- 顶部倒计时到 0s 后就停住，看起来像“不同步”

## 本次修复

- 动态同步不再检查本地 access_token。
- 改为调用 `/api/feishu-session` 检查 SaaS 登录状态。
- 动态同步改成单线程自调度 `setTimeout`，不再用固定 `setInterval` 重叠执行。
- 加入超时保护：
  - 登录状态检查 8 秒超时
  - 回写队列 12 秒超时
  - 动态同步 45 秒超时
- 加入自适应间隔：
  - 有变更：30 秒后再同步
  - 无变更：60 秒后同步
  - 失败：自动退避，最长额外 120 秒
- 顶部状态 0 秒时显示“即将执行 / 执行中”，不再假性卡死。
- 保留流式基础数据加载、SaaS KV 登录、动态字段同步、及时回写、原审核 UI。

## 仍保留的能力

- 用户只点“飞书登录”
- token 存 KV，前端不保存 access_token
- 手动同步基础数据流式加载
- 后台只同步动态字段：处理人 / 审核状态 / 审核备注 / 审核时间
- 审核回写 700ms 触发，1.5s 兜底检查
- 原图片预览、不通过快捷原因、不通过原因不能为空校验

## Cloudflare

Variables and secrets 保证已有：

- FEISHU_APP_ID
- FEISHU_APP_SECRET
- FEISHU_REDIRECT_URI

wrangler.toml 已包含：

- FEISHU_KV = 576f4e274ed64404a9519cce09f764dc
