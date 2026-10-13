# rikoko MCP

本仓库负责本地 MCP 与剪辑工作台。官网和官方云后台现由独立的 `rikoko-platform` 仓库维护。开发、Git 管理及共享运行时更新规则见[双仓库说明](docs/architecture/repository-layout.md)。

第一次使用请看[中文使用教程](docs/tutorials/使用教程.md)：从启动、首个本地样片，到 Agent 对话、工作台剪辑、声音调整与版本恢复，附实际操作截图。

官方云服务只承担**模板更新分发与统一模型 API 收费**。项目、素材、剪辑、版本与 FFmpeg 渲染保留在本地；模板更新和本地处理不消耗官方 API 额度。

支持**官方综合 API 套餐**和**config 自有模型接入**两种方式：官方套餐统一消耗额度，自有服务直接使用自己的供应商账户。图片、视频和音频共用模型目录与素材流程；自有连接只通过配置文件管理。配置示例、计费规则、当前供应商支持范围及支付边界见 [模型服务说明](docs/architecture/model-services.md)。

rikoko 是可自部署的视频创作 MCP，提供可选剪辑工作台。用户始终在 Codex、Hermes 或 Claude 原对话中提出要求、查看状态和继续修改；默认只附一个工作台链接，由用户点击打开。不自动弹出 MCP 窗口、嵌入播放器或另开网页对话。客户端适配与安装见 [三端接入](examples/clients/README.md)，当前交互验收见 [原对话与工作台链接](docs/acceptance/native-conversation.md)。实现计划见 [计划书](plans/框架搭建与开源整合实施计划书.md)。

本仓库新增原创实现，不复制 Hypit 的源代码、Skill 或示例。原有 `plans/`、`research/`、`outputs/` 保留。

## 用户安装入口

首发采用一行安装：下载公开源码、准备环境、预设官方 API 与模板源、注册 Codex/Claude MCP，并自动启动本地服务。自有供应商仅通过 config 接入。安装器与发行命令已实现；正式域名尚未配置，当前没有已发布的公众下载命令。详见 [一行安装说明](docs/architecture/installation.md)。

## 源码开发运行（不需要云服务器或供应商 Key）

需要 Node ≥22.19、pnpm 10.28.2、uv、Python 3.12/3.13、FFmpeg/ffprobe（有 libx264）。

```sh
make setup
pnpm demo
pnpm dev
```

服务保持运行，再用另一个终端执行 `pnpm clients install codex`、`pnpm clients install claude-desktop` 或 `pnpm clients install claude-code`，在对应客户端重载 MCP 后使用。Hermes 需在它实际运行的机器执行 `pnpm clients install hermes`。安装器保留原 MCP 配置；macOS 凭据写入 Keychain，默认无付费生成额度。详见 [安装和激活](examples/clients/README.md)。

需要独立网页或工作台时，打开 <http://127.0.0.1:4310>。首次启动生成 `.data/local-admin.key`，复制该文件中的 Key 到登录框。**不要将它发给别人或提交到仓库。**连接后使用有效期 24 小时的 HttpOnly / SameSite=Strict 会话，网页对话和工作台共享登录，刷新后可继续。退出或撤销原 Key 后失效，URL 和 localStorage 不保存管理员 Key。演示和开发服务分别启动；本地嵌入式数据库不支持两个进程同时打开同一个目录。

默认配置使用本地 PGlite（嵌入式 PostgreSQL），任务和账户均持久化到 `.data/db`，文件位于 `.data/assets`；后台 worker 随服务启动。选择该模式是为了无 PostgreSQL/Docker 的电脑也能运行。正式部署使用 PostgreSQL + pg-boss，见 [自部署](docs/architecture/self-hosting.md)。

`pnpm demo` 执行 E00–E07 的本地子检查，输出 MP4、SRT、预览帧、独立配音和版本差异；路径写入 `artifacts/acceptance/latest.txt`。它不下载 AI 大模型，也不发起付费请求。中文/英文配音使用系统已安装语音；macOS 使用 `say`，Linux 需 `espeak-ng`。

## 双模式创作

默认产品入口是 Codex / Hermes / Claude 的原对话：上传已有素材或提供脚本，查看状态，继续提出修改。Agent 返回普通文字和“打开工作台”链接；用户点击时才进入 `/workspace` 预览、剪辑和导出。网页 `/` 保留独立使用和开发调试。`/tools` 保留原有配音、模型和用量工具。

两个入口共用作品、素材、任务、版本和编辑记录。支持字幕、裁剪、分割、删除、顺序、替换画面保留声音、音量、背景音乐、画幅、历史恢复；修改创建新版本，过期版本会报冲突。打开或关闭工作台不触发重新生成。

宿主 Agent 直接调用 `workspace_commit`，无需网页或额外创作模型；MCP 的 `workspace_result` 返回状态、素材 ID 和工作台链接，不自动导出附件，不声明 MCP Apps 资源。用户明确要求文件或附件时才调用 `workspace_export`。网页内自由描述可选接入创作模型；未配置时只处理明确编辑指令、已有素材和脚本卡片。详见 [双模式接入](docs/architecture/dual-mode.md)。

## 已有功能

- 同一套 HTTP/MCP 服务：项目、计划、素材、不可变版本、修订、变体、反馈、任务和用量。
- 三种入口：参考再创作的资料/方案链、描述到本地模板成片、原片按时间裁剪。参考观察可由调用者提供并标为 `precomputed`。
- 真实 FFmpeg 编排：图片/视频/原创图形、字幕、配音、原音、背景音、文字卡片、B-roll 事件、源时间映射、竖屏 contain/cover。
- 镜头恒速变速（0.25–4×，保持音高）、音频淡入淡出、音量关键点、源音频波形；MCP、工作台和导出共用参数。[使用与验收](docs/acceptance/audio-editing.md)。
- 按镜头、字幕风格和语言修订；局部 TTS 产物可复用；词级事件随提供的新对齐时间移动；批量开头生成独立版本。
- 上传意图、SHA256/长度/实际媒体校验、租户隔离、SSRF 保护、私有媒体访问、一小时可撤销预览权限。
- 统一 Key 的签发/轮换/撤销/作用域/预算；原子预算预留、业务幂等、事务 outbox、租约、取消、人工费用核对。
- fal 队列适配器包含图片/视频/TTS、结构化参考分析/翻译的校验、估价、提交、查询、取消、收集；付费默认关闭。WhisperX 是可选独立环境适配器。

## 尚未验收的能力

**这不是 G0–G6 全部通过或正式商用版本。**真实参考语义理解、模型生成、WhisperX ASR/对齐、自动人物跟踪、自动翻译/译配质量、三个真实 Agent 客户端、PostgreSQL/pg-boss/S3/容器干净部署和正式发布仍需验收。当前模板规划不声称是 LLM 创作；中心 contain/cover 不声称是人物跟踪；预置字幕不声称是 ASR。

本地系统 TTS 与真实 FFmpeg 已运行。模型/费用/托管接入缺失不会阻止本地编排，相关接口返回明确错误或 `blocked_external`，不会静默换模型或伪造结果。

## 开发命令

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
uv run --project python python -m unittest discover -s tests -p '*_test.py'
pnpm build
make verify-provenance
make verify-contracts
make verify-local
make verify-service
```

`verify-media-ai`、`verify-live`、`verify-clients` 和 `verify-release` 对尚未完成的必选验收返回非零退出码和具体缺项，不把跳过计作通过。`pnpm demo` 使用真实媒体处理，但记录的是本地子检查，不代替计划书中的长原片、人工金标准或真实供应商验收。

## MCP 与 HTTP

- 远程 MCP：`POST http://127.0.0.1:4310/mcp`，Header 为 `Authorization: Bearer <workspace-key>`。
- stdio：`VIDEOWORKBENCH_API_KEY` 与 `VIDEOWORKBENCH_URL` 注入后运行 `pnpm stdio`。它连接已运行的服务，不另开本地数据库。
- HTTP 工具入口：`POST /api/tools/<tool_name>`，JSON 输入与 MCP 完全相同，结果为 `{result: ...}`。
- 上传：`upload_create` → 带同一 Bearer Key `PUT /api/uploads/<id>`。
- 私有下载：`GET /api/assets/<id>/file`。远程服务不接受用户电脑的绝对路径。

默认对话链路是 `workspace_commit` → `workspace_result`；继续修改前 `workspace_snapshot`，提交时带上最新 `baseRevisionId`。可选 `workspace_plan` 先取得可审阅方案。

底层独立操作链路是 `project_create` → `plan_create` / `revision_create` → `quote_create` → `job_submit` → `record_get(type=job)`。重连使用原 `job_id`；重提使用原幂等键。同键不同内容会报冲突。支持表与配置例子见 [客户端说明](examples/clients/README.md)。

## 付费供应商

计划书已记录用户提供过 fal 凭证；本次没有将实际凭证写入工程、验证余额或发起调用。后续在服务端注入 `FAL_KEY`，配置经过核对的模型档案，开启 `ENABLE_PAID_PROVIDERS=true` 并设置账户/Key 额度。`.env.example` 只是说明；当前入口从进程环境读取，不会自动加载该文件。

模型档案示例在 `deploy/fal-models.example.json`，故意不可直接运行。需要核查端点、固定参数、价格版本和最坏费用，再设置 `hardBoundConfirmed`。调用者不能覆盖会影响成本的供应商参数。模型档案变动会使旧报价/尚未提交到供应商的任务失效。

fal 响应不等于最终账单。本实现保留待核对费用与预留额度，由管理员根据供应商使用记录结算；不会把估价伪装成实扣。提交超时进入 `submission_unknown`，不自动重买。未提供商业预算时始终维持关闭。

## 项目结构

`apps/server` 服务与认证；`apps/worker` 后台执行；`apps/studio` 双模式界面；`apps/mcp-card` 对话结果卡片；`packages` 共享契约、核心、存储、MCP、供应商、配方、渲染与数据库；`python` 媒体执行；`examples` 八个任务入口；`tests` 契约/服务/媒体/安全测试。

候选源码许可为 Apache-2.0。依赖、模型、媒体与服务各自的权利见 [第三方说明](THIRD_PARTY_NOTICES.md)。当前沿用已有 Git 仓库的 main 分支；本次目录拆分不代表发布包或部署生产。

## 生成本地开源发行目录

运行 `pnpm export:public`，根据 `public-release.json` 生成 `artifacts/public-source/<时间>/` 和文件哈希清单。发行目录包含本地工作台、MCP、媒体执行、模板协议/客户端、自有供应商适配器与测试，排除官方云后台、真实配置、运行数据、研究资料和开发样片。命令拒绝覆盖已有目录，不创建 Git 仓库或分支，也不发布到外部。

该目录使用独立的 [公开 README](docs/open-source/README.public.md)。详细范围见 [开源边界](docs/open-source/boundaries.md)。导出与构建检查不替代第三方许可和素材权利核对。

### Pollo-style conversation and Vizard-style editing workspace

The default route is a white inline-results conversation. `/workspace?project=...` opens the dark assistant/player/timeline/media workspace. The editor supports draft undo/redo, split/trim/reorder, captions, sound, format, fit, annotated frame attachments and immutable saved exports. On phones, switch between preview, conversation, editing and media using the bottom tabs.

MiniMax H3 fixed profiles are now registered by default, while paid execution remains disabled by default. Configure `FAL_KEY` and `ENABLE_PAID_PROVIDERS=true` **only after authorizing a test budget**. Existing account balance and key limits are still enforced. A custom `FAL_MODELS_FILE` replaces the default profiles. The reviewed profile uses `minimax/h3/text-to-video`, 768P, 5 seconds, and a maximum US$0.30 quote (public rate checked 2026-10-11). Review current provider pricing before enabling it later.

Detailed implementation, source observations, test evidence and external-service boundaries: [UI replica acceptance](docs/acceptance/ui-replica.md). Local H3 example media is identified as a public fal sample, not a new generation. `scripts/h3-ui-fixture.ts` imports the already-downloaded local sample through the normal authenticated upload path; it never purchases a generation.

### 官方云平台

官方模板分发、统一生成 API、R2 存储及其运营、部署配置已移至独立的 `rikoko-platform` 仓库。本仓库保留模板同步、官方生成 API 客户端及自有供应商接入。

本地项目继续编辑和 FFmpeg 渲染；模板只在主动更新时同步，已有作品保留版本快照。拆分没有改变既有服务地址、配置键或线上部署。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:media
```

平台需要升级公共代码时，使用 `pnpm pack:runtime` 生成经过文件范围检查的版本包；操作见[双仓库说明](docs/architecture/repository-layout.md)。
