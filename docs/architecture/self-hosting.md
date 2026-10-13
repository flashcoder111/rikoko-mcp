# 本地和服务器运行

## 本地

执行根目录 README 的 `make setup`、`pnpm demo`、`pnpm dev`。Node 22.19+；Python 固定在 `python/uv.lock`。FFmpeg 使用本机安装的构建，渲染字幕由 Pillow 绘制，不依赖 libass/drawtext。中文需本地字体，自动检查 PingFang 或 Noto CJK，也可设置 `MEDIA_FONT`。

PGlite 用于单进程开发、演示和测试。API 与 worker 共用一连接，由事务串行保证预算与任务写入。停止后可重启继续查询。不要同时运行 `pnpm demo` 和使用同一 `DATA_DIR` 的服务器；也不要在此模式单独启动 worker。

## PostgreSQL 和 Compose

`deploy/compose.yaml` 提供 PostgreSQL、server、worker 和共享素材卷。当前环境没有 Docker，文件已实现但**尚未构建运行**，不能直接视为生产验收。

```sh
export POSTGRES_PASSWORD='replace-with-a-long-secret'
docker compose -f deploy/compose.yaml up --build -d
# 用运维身份创建首次账户，返回的 Key 只展示一次。1000 是管理测试额度，不是收款。
docker compose -f deploy/compose.yaml exec server pnpm keys create-account 'Owner' 1000
```

PostgreSQL 模式需要首次显式创建账户；不会默认生成公开管理账户。队列使用事务 outbox：事务预留额度和写 job/outbox，dispatcher 发送到 pg-boss，再标记已发送。重复唤醒由业务租约保证不会重复执行。worker 另有持久状态扫描，负责崩溃租约恢复与已提交供应商任务的轮询。

当前数据库写事务用固定 advisory lock 串行化业务写入，以保证第一版账本安全；这是明确的吞吐限制，需要压测后再改为按账户锁。媒体文件不在数据库中。数据库表由 `packages/db/migrations/001_core.sql` 初始化；当前只有向前的第一个版本，不提供破坏性自动回滚。

对外开放时显式配置 `ALLOWED_HOSTS`、可达的根地址 `PUBLIC_BASE_URL` 与 HTTPS 反向代理，并保留外部 Host。浏览器会话使用配置的公网 Origin 校验，HTTPS 地址启用 Secure Cookie。MCP 返回的工作台链接也使用这个地址；详见[双模式接入](dual-mode.md)。默认只允许 localhost，容器端口仅绑定 127.0.0.1。未实现 OAuth 标准授权发现、支付收款、自动充值或完整运维控制台。

## S3

设置 `S3_BUCKET`、`S3_ENDPOINT`、`S3_REGION` 及 AWS SDK 标准服务端凭证。当前上传仍经过有大小上限的应用服务，S3 作为存储后端；浏览器直传和 multipart 是待补增强。请求端不得自行决定 storage key，下载总是重新检查账户或分享权限。

## 可选模型

WhisperX 独立环境需预先安装 WhisperX 和 PyTorch，并提供本地 ASR/对齐权重目录 `WHISPERX_MODEL_PATH`、`WHISPERX_ALIGN_MODEL_PATH`，通过 `MEDIA_PYTHON` 指向该环境。它也必须安装基础 Pillow/jsonschema。默认 `uv sync` 不下载这些依赖或权重；具体版本/设备/权重许可待首次实际验证后冻结。

系统 TTS 使用已安装语音，目前接纳 en/en-US/en-GB 与 zh/zh-CN；不支持的语言明确失败。macOS 默认 Samantha/Tingting；Linux 使用 espeak-ng。系统 TTS 的声音授权与语音质量不能由免费测试推导成商用承诺。

## 备份与限制

备份数据库与存储卷为一组，记录版本。当前文件默认不自动过期（asset.expiresAt=null）；删除/保留策略需要运维层设置，不能宣称已有自动清理。服务限制输入≤100 MB、媒体≤1小时、作品≤10分钟、最大1920边长、单作品100镜头。不支持任意 FFmpeg 表达式或用户插件代码。生产仍需资源配额、隔离运行、负载/压力测试与实际发行镜像审计。

## 参考理解与翻译模型入口

模型档案 `kind` 可为 `analysis` 或 `translation`，用经核对的 fal endpoint、固定参数、输入 promptField、输出 responseField（默认 `output`）接入结构化结果。

- `quote_create` / `job_submit` 的 input 为 `{kind:"analyze", assetId, model}` 时走真实供应商路径。必须使用已配置的 S3 存储；服务器只向该供应商提交该账户素材的一小时签名 URL，URL 不写入 Job/日志。无云存储时在采购前阻止调用并释放预留。
- analysis 输出严格为 `{schemaVersion:1, summary, observations:[{startMs,endMs,observation}]}`，时间不能超过源媒体。完成后返回可复用 analysis Asset。`plan_create.recipe.analysisAssetId` 可读取它，保留分析来源的证据等级。
- input `{kind:"translate",model,text,language}` 使用翻译模型，输出严格为 `{schemaVersion:1,language,text}`；语言不符即失败。随后以译文生成独立声音，并通过完整 language revision 更新每个镜头。

上述模型端点尚未选定或实测。固定结构是本项目适配契约，实际模型的 responseField/JSON行为需配置并验证，不能假定任意 fal 模型都会满足。默认不会为拿到示例而上传媒体或购买调用。
