时区：Asia/Shanghai

[2026-07-27 08:07] 确认本轮继续使用原 Node/Electron 版本，Go/Wails 重写不在本轮范围 (基线 package.json 版本 1.0.6)
[2026-07-27 08:07] 完成线上 API 密钥新能力只读核对 (字段 max_rate_multiplier、rate_change_notify_enabled、failover_enabled、failover_strategy=manual|lowest_rate|fastest、failover_group_ids、failover_excluded_group_ids、failover_recovery_mode=sticky|prefer_primary|manual_only)
[2026-07-27 08:07] 完成故障转移日志接口与展示字段核对 (GET /api/v1/usage/failovers；筛选 page/page_size/start_date/end_date/model/api_key_id；展示密钥、模型、源/目标分组、倍率、策略、回切、原因、探测与状态)
[2026-07-27 08:07] 完成自助发票接口与表单核对 (GET /api/v1/invoices/eligible-orders、GET /api/v1/invoices/my、POST /api/v1/invoices；提交 payment_order_id/company_title/tax_number/email；单笔充值达到 300 可申请)
[2026-07-27 08:07] 确认桌面端使用教程整体替换为站点 /tutorial 当前内容 (章节为 Node.js、API 密钥高级功能、CCS、Claude Code、Codex、Gemini CLI、AIHubRouter、社区工具)
[2026-07-27 08:07] 记录当前停点：仅完成仓库与线上站点只读分析，尚未修改业务代码 (下一步先提交 2-3 种实现方案和设计供用户确认，再按 TDD 实施并验证)
[2026-07-27 08:09] 换机续接摘要：继续使用原 Node/Electron 1.0.6，待补齐密钥最高倍率、倍率邮件通知、三种故障转移策略及排除/候选分组、三种回切、故障转移日志、自助发票，并将软件教程整体替换为站点 /tutorial (当前无业务代码改动，先完成设计确认)
[2026-07-27 08:12] 调整 Git 忽略规则，排除依赖、构建产物、过程文件、测试截图与日志 (更新 .gitignore，保留源码、文档和 work/HISTORY.md)
[2026-07-27 08:13] 初始化本地 Git main 分支并配置 GitHub 远端与仓库级提交身份 (origin=https://github.com/shiwu-ui/aihub-desktop.git，令牌未持久化)
[2026-07-27 08:16] 将 Node/Electron 1.0.6 项目源码、文档和换机续接历史上传到 GitHub main 分支 (推送至 shiwu-ui/aihub-desktop，依赖、构建产物、过程文件和敏感凭据未上传)
