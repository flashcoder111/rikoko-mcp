# 两个仓库的维护边界

- `rikoko-mcp`：MCP、本地 HTTP 服务、后台媒体执行、Studio、公共协议、模板客户端、安装器和使用教程。
- `rikoko-platform`：官网、官方模板分发、统一生成 API、R2 管理、云端运营脚本和部署配置。

两个仓库分别安装、构建、测试和提交。MCP 使用已有 Git 历史和 `main`；平台使用独立的 `main`。本次只调整本地代码管理，没有部署或改变远端服务。

## 公共代码如何共享

MCP 的 `package.json` 通过子路径导出公共 TypeScript 模块。平台依赖提交到 `vendor/` 的 `rikoko-<版本>.tgz`，锁文件固定内容完整性，旁边的 JSON 清单记录 SHA-256 与打包文件列表。云端使用 `rikoko/core/index` 等包导入，不跨目录导入兄弟仓库。

源码只在 MCP 仓库维护。安装包是构建产物，不是在平台维护的第二份源码。它也不是已发布的 npm 包或面向用户的一行安装发行物。

更新共享代码时：

1. 在 MCP 修改代码并通过 `pnpm test`；修改 `package.json` 版本号。
2. 在 MCP 执行 `pnpm pack:runtime`，构建后产出 `artifacts/runtime/` 中的包及清单。
3. 将这两个明确的发行文件复制到平台 `vendor/`；更新平台依赖中的文件名。
4. 在平台执行 `pnpm install`、`pnpm verify:runtime`、`pnpm build`、`pnpm test`。
5. 两个仓库分别提交。不得覆盖不同内容的同版本安装包。

包内包含本地服务与工作台构建，供平台的跨端验收复用；云端入口仍只开放模板分发和统一生成 API。集成浏览器验收为 `pnpm verify:cloud`，使用临时数据库、无真实凭据，不发起付费生成。

## 本地迁移兼容

本机旧目录 `hypit copy` 保留为指向 `rikoko-mcp` 的符号链接，以兼容现有 MCP 启动配置。实际开发目录只有 `rikoko-mcp` 和 `rikoko-platform`。新安装、构建和测试不依赖这个链接。

现有项目、素材和本地数据库保留在 MCP 的 `.data/`。历史研究、抓取来源和验收产物保留，但由 Git 忽略；本次迁移前源码备份位于 MCP 的 `artifacts/repository-split/before/`。平台的网站参考原稿保留在 `outputs/website-reference/` 与 `references/`，均不进入 Git。网站已有生成页面与公开素材仍随源码保留。

`HYPIT_*`、`VIDEOWORKBENCH_*` 和 MCP 注册键等历史兼容标识保持不变。
