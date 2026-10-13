# 数据、时间与任务契约 v1

运行时 Zod 为 TS 权威定义，`pnpm exec tsx scripts/schemas.ts` 导出到 `packages/contracts/schemas/`。Python 在执行渲染前使用同一 JSON Schema，并额外检查时间关系和锚点。跨语言时间使用整数毫秒；画面采用 24/25/30 fps，导出量化到帧。没有支持任意帧率或变速的声明。

Asset：账户、SHA256、来源/许可、实际探测属性、受控 storage key、生成 job、证据等级；相同账户的同哈希素材复用。绝对文件路径只在受控 worker 临时目录使用，不是远程工具入参。

CompositionRevision：不可变 composition、父版本、项目、变更；每个 scene 有稳定 ID、源素材和源起点、独立音频、时长、文本、词级相对时间；每个 event 绑定 scene 与可选 word，渲染时加上当前镜头起点。更长的新声音应同时提供新的 durationMs/words，后续镜头与事件才可准确跟随。系统不把旧文本的词时间冒充新对齐。

文字修改会使旧独立配音和旧 words 失效；没有新词锚点时明确返回 ALIGNMENT_REQUIRED；调用者必须补齐词时间，或通过 eventBindings 显式重绑到新词/镜头相对时间，不会静默丢弃画面事件。提供一致 words 时，E06 已实测绑定事件随新词时间移动。新语言版本要求每个镜头都有译文、新音频和时长，译文由调用者提供；单纯改语言标签被拒绝。

Job：业务输入指纹、创建 Key、报价、根额度预留、phase、steps、attempts、leaseToken、leaseUntil、供应商 ticket、输出 assets、实际/待核对费用。客户端断线不会取消任务。租约30秒、执行期间心跳续租；失效 worker 不能完成当前任务。

本地任务崩溃可安全重做编码（不会购买素材）；上游 submitting 状态崩溃且无 request ID 进入 submission_unknown；已保存 ticket 的任务继续查询原 request，不提交新的采购。暂时查询失败保留预留，调用 job_resume 继续查询或收集同一上游请求；它不接受未知提交，也不会重新采购。每次模型调用是独立根任务；当前没有一个报价自动承包任意多个生成子任务的付费 DAG。

账本：金额为整数 USD cents；预留、job、幂等映射和 outbox 处于同一事务。quote 五分钟有效，绑定输入和完整模型费用档案指纹。key budget 是累计实际消耗+当前预留的上限。key 轮换保留原 ID 与累计额度，不能重置预算。零元本地任务也有审计条目。

取消排队本地任务立即释放；执行中本地任务中止 Python 与同进程组的 FFmpeg。供应商取消仅记录是否接受请求，尚未核对费用仍保留预留，不声称退款。`job_reconcile` 要求管理员且填写核对依据，不能将没有输出的未知任务标完成。
