# rikoko 0.1.30 本地发行验收

日期：2026-10-21。验收对象为当前工作区导出的源码安装包；没有提交、推送或发布。媒体生成调用为 0。宿主对话使用已有 Codex/Hermes 模型连接，素材是仓库原创图和本地 FFmpeg 渲染。

## 当前结论

自动检查通过；真实 Codex CLI、Hermes CLI 的本地完整流程通过；干净 Linux 安装、已发布旧版升级、失败回退和中断恢复通过。**尚不能宣称全部宿主、全部平台或付费生成已正式验收。** Claude Desktop 的现有模型端点不可用，Claude Code 未安装，桌面附件组件没有替代为 CLI 测试结果。

## 源码与自动检查

- 版本：0.1.30。
- 导出源码与验证脚本联合指纹：`3ef8900686c7397557d6c2198df4773b9170b21f120c35e2acbe43beeddf3a65`。
- 自动报告：`artifacts/release/2026-10-21T12-53-42.164Z/report.json`。
- TypeScript：106 文件、813 测试通过，1 测试跳过；Python 媒体：10 测试通过。
- 构建、许可证清单、安装器语法、安装/升级/失败回退/恢复和源码稳定性检查通过。
- 自动安装检查使用隔离目录和已有缓存；不能代替以下空白 OS 验收。

最终候选 `artifacts/acceptance/2026-10-21/downloads/final/` 的安装包 SHA-256：`42f36ff850fe0c84e9543832d2c7cde63980673cfd262cf0ec2e2c77182e9713`。URL 为验收 VM 专用 HTTPS 地址，**不是对外发布地址**。

## 真实宿主流程

| 宿主                     | 结果    | 实测内容                                                                                                      |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| Codex CLI 0.154.0        | PASS    | 实际模型调用 17 次 rikoko 工具；导入原创 PNG、建立 3 秒视频、修改字幕、导出 MP4/SRT/PNG、新进程读取并继续导出 |
| Hermes CLI 2026.9.24     | PASS    | 实际模型调用 rikoko 工具；同样完成建项目、字幕修改、导出、新进程恢复                                          |
| Chrome 155.0.8059.85     | PASS    | 两个项目均实际播放，播放键变暂停、时间推进，画面可见修改后的字幕                                              |
| Claude Desktop 2.42304.0 | BLOCKED | 应用提示无法连接已配置的 `127.0.0.1:18402` 模型服务；未修改用户服务或配置                                     |
| Claude Code              | NOT_RUN | 当前 PATH 无 CLI；自动 stdio 协议检查不能视为实际 Claude Code Agent 完整流程                                  |
| 各厂商桌面附件组件       | NOT_RUN | 已验证 CLI 文件交付及浏览器播放，未验证原生附件卡片                                                           |

Codex 项目 `ac475109-3454-437c-85cc-1a817edf8a7e`，最终 revision `cfdc15ad-cc43-4fb7-92e3-4d63632f1d58`，字幕 `HOST ACCEPTANCE EDITED`。Hermes 项目 `174b35cb-2759-4116-93cc-460b424f4ffa`，最终 revision `6c1a48dd-8eb3-4d1e-82ab-7fd6b6f243ff`，字幕 `HERMES EDITED`。

Hermes 恢复前明确记录服务已停止、健康检查不可达、PID 文件消失；新宿主进程通过 MCP 自动启动后 PID 从 76864 变为 84001，原项目和导出保持。Codex 的服务恢复前未单独记录 PID，因此不宣称具有同等进程证据。

证据目录 `artifacts/acceptance/2026-10-21/host/`：`results.json`、`restart-observation.json`、`playback.png`、`hermes-playback.png`、导出文件及宿主事件日志。原始日志可能含本地签名媒体 URL，保持私有，未纳入公开源包。日常宿主配置没有更改。Hermes 测试使用独立 HERMES_HOME 和已有依赖解释器；首次启动器/工具集选择失败的日志保留，最终成功使用 CLI 的 `-t rikoko`。

## 发行许可与媒体来源

完成的是 **source-installer 的技术许可清单与分发边界审查**，不是对所有二进制分发或权属的法律签署：

- 102 个已安装生产 npm/Python 依赖：完整文本汇总在根 `THIRD_PARTY_LICENSES.txt`，精确版本/声明/文本哈希见自动报告的 `licenses/dependency-licenses.json`。
- 30 项随源码媒体：2 字体、15 原创 PNG、9 无音轨 MP4 预览、4 当前界面截图；见 `docs/integrations/media-licenses.json`。
- 模板图和预览已全部用随包 Noto Sans SC/OFL 字体重新生成，移除生成器对 macOS 专有字体的依赖；没有生成模型调用、第三方人物或音乐素材。
- 完整导出树对未清点二进制/媒体进行拒绝检查；公开归档不含 node_modules、Python 虚拟环境、系统程序、模型权重、用户数据和开发参考视频。
- mutagen GPL-2.0-or-later、certifi MPL-2.0、yt-dlp-ejs 多许可证、Pillow MIT-CMU 已明确记录，不能用 yt-dlp 的 Unlicense 覆盖所有传递依赖。
- 根 Apache-2.0 仍沿用仓库现有“拟采用”表述；正式公开前需权利人确定最终授权。没有擅自改写原代码授权。
- 容器、离线运行时、FFmpeg/libx264、Pillow/curl_cffi 原生库及 PGlite 内嵌 PostgreSQL 的二进制再分发不在本次通过范围，不能据此批准容器发行。

复核命令：`pnpm exec tsx scripts/verify-licenses.ts`。依赖或媒体变化会使清单过期并阻断自动门禁；审查后才运行 `--write-notices` 更新。

## 干净 Linux 安装与升级

VM 采用 Lima 2.2.1 / macOS VZ，Ubuntu 24.04.5 LTS aarch64，4 CPU、4 GiB RAM、16 GiB 磁盘，无宿主目录挂载。官方镜像 SHA-256 为 `fbf6b15c50c474dc6dee5b3c74da212bb687a2625e877227828e6492d88dc151`。

初始基线明确检查 Node、npm、pnpm、uv、FFmpeg、ffprobe 和 npm/uv/pnpm 缓存不存在。源码归档通过真实 HTTPS 下载并校验哈希，临时 CA 仅加到一次性 guest；Node、uv、Python、npm/Python 包和系统包从公共上游首次下载，没有 curl/npm 替身或开发机缓存。系统自带 Python/cloud-init 不作为应用 Python 使用。

| 检查                                                     | 结果                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 空白 OS 一条命令安装、构建、注册 Codex、免费 FFmpeg 样片 | PASS                                                                           |
| 最终候选升级与重复安装                                   | PASS；配置、身份、宿主设置、原始记录与媒体哈希保持                             |
| 关闭服务后通过生成的 Codex 配置启动真实 stdio 桥         | PASS；发现 82 个工具，capabilities 成功                                        |
| 存在 `blocked_external` 未完成任务时升级                 | PASS；拒绝激活，恢复原服务及数据                                               |
| 候选 setup 在服务启动后抛出故障                          | PASS；实际安装器失败并回退应用、配置、数据库、媒体                             |
| `--recover` 与过期锁恢复                                 | PASS；模拟中断 journal 和已退出锁 owner，恢复备份，再重新激活最终版本          |
| 已发布 0.1.12 → 当前 0.1.30                              | PASS；原 5 条项目/版本/素材记录、3 个媒体文件与宿主配置保持；新进程 stdio 可用 |

安装得到 Node 22.23.4、uv 0.13.0、Python 3.12.15、Ubuntu FFmpeg 6.1.1-3ubuntu5。旧版源包直接从 GitHub Release 获取，SHA-256 为 `e46960dad8dbba485f174bc31bf5973e04d26c3c7ef48714444535ddf7969391`；为避免重复公网下载，仅将原安装脚本的归档 URL 改为 guest 可达的 HTTPS 镜像，归档字节与哈希完全保留。

首次空白 OS 安装的前一候选归档 SHA-256 是 `3228ae4c88027c14fc3e376a5c74e0d33e916a2c6c7cc64420db31d475b32986`。实测发现 macOS 扩展属性产生 Linux 解包警告，随后打包器加入 `--no-xattrs`，安装器补版本一致性检查，并纠正两份许可说明。最终归档在同一 guest 完成上述全生命周期验收；**没有把它描述为最终字节再次从空白 OS 完整安装**。两候选运行时代码一致，导出树差异仅为安装器和两份说明文件；打包器差异不属于归档运行时源码。

中断恢复使用构造的 journal，不是随机断电测试。升级旧版复用这台 guest 首次安装建立的运行时与缓存，不能单独计作第二次干净安装。

证据：`artifacts/acceptance/2026-10-21/linux/results.json`、`linux/acceptance/` 中的基线、安装、升级、拦截、回退、恢复和保留性日志，以及 `linux/free-video-probe.json`。重放脚本为同目录上级的 `guest-first-install.sh`、`guest-lifecycle.sh`、`guest-previous-upgrade.sh`、`guest-check.mjs`；仅用于一次性无凭据 guest。

最终汇总 `artifacts/acceptance/2026-10-21/results.json` 已重新核对源码未漂移，`partial-evidence.json` 将证据绑定到源码和文件哈希。干净机器证据通过；宿主与最终许可授权保留 PARTIAL，不伪造正式 PASS。

## 发布边界

- 未做付费图片/视频/音频生成，未验证生成质量和供应商账单；generation 范围门禁保持未通过。
- macOS 空白机器、Linux x64、WSL 未在本轮用干净 OS 实测；不能将 Linux ARM64 结果外推到所有支持平台。
- 本地自动报告的 `releaseReady=false` 是预期：完整宿主矩阵、最终原创代码授权和其他发行形态仍有明确缺口。
- 验收结束后已停止隔离后端、HTTPS 归档服务器和测试 VM；保留停止状态的 VM 与证据用于复查。没有修改日常宿主配置、创建分支、提交、推送或发布。
