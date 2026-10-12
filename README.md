# Video Workbench

在本地通过 Agent 对话创建、修改视频，在时间线中继续精修。项目、素材、版本和 FFmpeg 渲染保留在本地。官方云服务只承担模板更新分发和统一模型 API 收费。

本地剪辑、字幕编排、渲染和模板同步不消耗官方 API 额度。外部模型调用及宿主 Agent 的服务费用分别计算。无需开通官方 API，即可使用已有素材完成编辑和导出。

## 一行安装

正式发行通过官网的一行安装命令准备环境、配置官方 API/模板源并注册 Codex/Claude MCP。安装后的 MCP 会自动启动本地服务，无需另开终端。首次绑定使用每位用户自己的官方 Key；自有供应商通过 config 接入。发行域名仍待配置，当前源码快照不提供虚构的可用下载链接。[安装与自有配置说明](docs/architecture/installation.md)。

## 手动运行源码

需要 Node ≥22.19、pnpm 10.28.2、uv、Python 3.12/3.13，以及支持 libx264 的 FFmpeg/ffprobe。

```sh
pnpm install --frozen-lockfile
uv sync --project python --frozen --python 3.12
pnpm build
pnpm demo
pnpm dev
```

打开 `http://127.0.0.1:4310`，使用启动时生成的 `.data/local-admin.key` 登录自己的工作空间。演示与开发服务分开运行，不要让两个进程同时打开同一数据库目录。不要共享或提交本地 Key。

本地演示不调用付费模型。中文/英文系统配音需要已安装语音，Linux 可使用 espeak-ng。

## 模板与 API 分开配置

仅设置 `TEMPLATE_API_URL=https://templates.example.com` 可启用模板源，不改变模型费用来源。只有用户点击“更新模板”或明确调用 `template_sync` 时才请求模板目录；已有作品固定使用原模板快照。

官方生成服务使用 `GENERATION_API_URL` 和 `GENERATION_API_KEY`。也可通过 `HYPIT_CONFIG_FILE` 指向 config：`mode=official` 使用平台用户 Key，`mode=custom` 使用自己配置的供应商。`templates.url` 独立指定模板源，`templates=false` 禁用模板连接。

这些域名是占位示例，需替换为实际可用服务。密钥由进程环境注入，本程序不自动加载 `.env`。不要把真实密钥写入 JSON 配置或公开文件。

官方与自有模式均不在失败时自动切换付费来源。官方 Key 仅发送到生成 API origin；模板同步不携带该 Key。官方余额为零时，已有素材的本地处理和模板更新仍可继续。

模型接入详见 [配置说明](docs/architecture/model-services.md)。保留 `HYPIT_*` 环境变量和 `hypit` MCP 配置名是为兼容已有安装，并不表示本项目由 Hypit 官方提供。

## Agent 接入

手动运行源码时，保持本地服务运行，再执行 `pnpm clients install codex`、`pnpm clients install claude-desktop` 或 `pnpm clients install claude-code`。一行安装版自动完成这些步骤并管理服务启动。Hermes 在实际运行它的主机配置。安装器保留其他 MCP 配置，首次签发的本地专用 Key 默认付费预算为零。安装后重载宿主 MCP 连接；真实客户端支持程度需按所用版本验证。

## 开发与贡献

```sh
pnpm typecheck
pnpm test
pnpm test:media
pnpm build
```

见 [贡献说明](CONTRIBUTING.md)、[开源边界](docs/open-source/boundaries.md) 与 [第三方说明](THIRD_PARTY_NOTICES.md)。此源码快照不包含官方云后台、运行数据、供应商密钥、研究资料或开发样片。

源码内包含 Apache-2.0 许可文本，第三方组件仍遵循各自条款。模型权重与第三方媒体不随源码自动获得许可。当前发行物为本地整理与验证的快照，真实付费生成、在线支付和生产部署不因源码可构建而视为已验收。
