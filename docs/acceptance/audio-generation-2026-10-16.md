# 声音生成与后期修改 · 2026-10-16

## 状态与范围

在已有 main 分支完成本地代码、配置与验证，保留已有 O3、多模型菜单及参考分析改动。本次未创建分支、提交、推送、部署或购买真实生成任务。在线 MCP/官方网关需要升级后才会采用新的默认模型和目录。

本次供应商请求全部为模拟；音频上传探测、结果导入、FFmpeg 混音和离线样片是真实本地执行。测试音为明确标注的正弦信号，不是人物语音，不能据此宣称听感、音色相似度或真实生成质量通过。

## 业务与模型

| 业务 | 模型与端点 | 实现 |
| --- | --- | --- |
| 视频原生声音 | 所选视频模型的实际输出 | 默认保留，先检查所选档案和实际音轨；不自动给每条视频购买独立配音 |
| 后期配音与替换 | ElevenLabs Eleven v3 · fal-ai/elevenlabs/tts/eleven-v3 | tts 默认 engine=fal、model=elevenlabs-voice；语言规范化并传递 voice/language_code |
| AI 配乐 | ElevenLabs Music · fal-ai/elevenlabs/music | 固定 30 秒纯器乐，服务端档案不可由客户端覆盖；生成结果通过 music edit 混音 |
| AI 音效 | ElevenLabs Sound Effects V2 · fal-ai/elevenlabs/sound-effects/v2 | 固定 5 秒，通过 text 字段提交；sound edit 支持定时叠加、截取、音量和移除 |
| 声音克隆 | MiniMax Voice Clone · fal-ai/minimax/voice-clone | owned voice 音频参考、试听文案、时长与大小限制；返回试听和专属音色 ID |
| 克隆音色复用 | MiniMax Speech-02 HD · fal-ai/minimax/speech-02-hd | 用 text 提交文案；voiceAssetId 验证素材所有权、voice ID 与匹配模型，官方通路映射原云端素材 |

MiniMax Speech-02 与旧 Speech 2.8 的请求文本字段不同：前者使用 text，后者保留 prompt。已对两种 fal 适配器增加回归，合并公共 TTS 请求映射，避免重复实现漂移。

## 移除本地配音

- tts 不再接受 engine=local，默认独立配音是 Eleven v3；云端不可用时明确报错，不换系统声音或 MiniMax。
- 移除 Python 系统 TTS 适配器；旧本地任务或媒体 CLI 的 tts 请求明确失败。
- MCP 能力目录、Agent 指引、项目技能与工具页移除本地配音入口；保留可选的本地 WhisperX 转写。
- 安装器与 Docker 不再安装 espeak-ng。
- 离线 E05 验证本地配音请求被拒绝，其他声音编辑例子使用标注的测试音，不购买云端配音。

## 音效与克隆的数据行为

sound 是独立声音事件，按镜头或已有词时间锚定，并与原声、独立旁白及背景音乐混合；不生成空白文字卡，不写入字幕。裁剪和分割保留相交音效并移动音效源起点；编辑保留素材所有权、实测时长和版本冲突校验。

克隆音色保存于输出素材的 provenance.voiceClone，包括 provider、voiceId、reuseModel 和供应商要求的首次使用期限。MiniMax 音色不能用于 Eleven v3。供应商要求新音色在 7 天内通过兼容 TTS 使用一次才能保留；系统不自动购买激活。

当克隆试听与既有源音频字节恰好相同时，创建独立的音色素材记录，保留原素材来源，避免普通哈希去重吞掉音色 ID 或改写原素材。官方通路同时回传音色数据并绑定原官方网关及云端素材 ID。

## 验证

最终 MCP 全量验证：55 文件、392 项通过；语句覆盖率 88.96%、分支 84.27%、函数 90.23%、行 89.88%。Python 真实媒体测试 7 项通过；平台官方 API 测试 6 文件、36 项通过。两个仓库类型检查、MCP 前端构建、运行时范围校验、改动文件格式检查、安装脚本语法与 git diff --check 均通过。完整 MCP 覆盖率位于 artifacts/audio-2026-10-16/coverage-final/coverage-summary.json。

- 本地声音流程：先报价不采购；克隆只提交一次；重复幂等请求复用原任务；音色复用只提交新文案；跨账户素材与错误模型拒绝。
- 工作台配音：明确文案、语言和音色，经同一个 tts input 进行报价与提交；点击确认前不调用 job_submit。
- 配乐与音效请求：核对真实 endpoint、prompt/text 字段与固定时长，拒绝客户端费用参数覆盖。
- FFmpeg 实际混音：220 Hz 原声、440 Hz 背景音和 880 Hz 音效，检测音效指定区间内外的频谱幅度，确认原声和背景音保留且字幕为空。
- 官方 API：本地真实音频上传、报价、模拟供应商克隆、认证结果取回、音色元数据保存、后续云端配音及跨模型拒绝。
- 离线 E00–E07 均通过；样片证据 artifacts/acceptance/2026-10-16T04-06-46-624Z/。

## 运行时与启用边界

公共运行时 rikoko@0.1.15，固定归档已供平台本地引用，158 个打包文件，SHA-256：fe5649f6985f7cbc19c1eda3347ae0801f07e8f0c46431da161dae59156952ce。平台通过固定归档引用，没有使用兄弟仓库源码依赖。

新内置及自有档案的 maxCostCents=100 是待核价占位值，hardBoundConfirmed=false；需核对真实费用和权限后开启。平台显式 testing 模式按已有规则使用测试账户费用，不能理解为供应商免费。普通报价、克隆及后续复用分别确认，不从模型选择推定购买授权。

尚未验收：Eleven v3、Music、Sound Effects V2 与克隆的真实供应商生成、听感、多语言音色一致性、供应商音色保留、实际账单和线上更新。

调用示例见 [声音流程](../speech.md)。接口依据：[Eleven v3](https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api)、[Music](https://fal.ai/models/fal-ai/elevenlabs/music/api)、[Sound Effects V2](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api)、[Voice Clone](https://fal.ai/models/fal-ai/minimax/voice-clone/api)、[Speech-02 HD](https://fal.ai/models/fal-ai/minimax/speech-02-hd/api)。
