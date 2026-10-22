# MiniMax 保留要求解耦、0.1.29 部署与 CS2 实作

日期：2026-10-21（Asia/Shanghai）。用户授权修改、部署本地/云端、使用 MiniMax 重做 CS2 原片。沿用 main，未创建分支，未提交或推送；保留工作区其他改动。

## 结论

代码和部署完成；CS2 已生成完整候选文件，技术交付合格，**严格复刻的视觉验收失败**。不能将接口兼容、准备成功、生成成功或尺寸正确等同于原动作/切镜/占画比例保持一致。

## 已修改

- `edit_source` 表示动作、镜头、时间、构图的保留要求，独立记录实际 `executionMode`。允许兼容的 MiniMax `reference_to_video`，也保留专用 `video_to_video`；用户指定模型时仅检查该模型，否则优先兼容的 MiniMax。
- 明确的原片分段记录源时间、实际文件哈希和时长；分段必须覆盖全片，保持原片画布与帧率。不会自动换参考、删掉素材、变速或改画布来绕过兼容问题。
- MiniMax H3 Max 参考接口支持小数秒 `duration`，`480P/768P/1080P`，包括 `adaptive` 的声明比例。保留 `reference_image_urls` / `reference_video_urls`，扩写保持 disabled。
- 保存的分段 `sceneDirection`、显式约束和音轨安排进入最终提示词；修复旧 source_edit 分支忽略分段导演说明的问题。
- 多段输出按原时长、speed=1、contain 拼接；输出短于对应源片时不拉伸/循环补齐。超长输出只截取尾部，不能据此声称内部动作节奏一致。
- 更新 MCP 指南，说明参考传递与保真效果之间的证据边界。

## 验证和部署

- 仓库类型检查通过；批准候选运行时类型检查通过（运行时代码范围）。
- 70 项相关测试通过；platform 的 10 项集成检查通过。
- 候选镜像断网、只读环境真实本地渲染通过，无模型调用；54 个平台/已有媒体运行时文件哈希不变。
- 本地 4310、4311 与 Codex/Hermes/Claude Code/Claude Desktop 连接更新为 0.1.29；4 个宿主连接检查通过。
- 云端镜像 `video-workbench-cloud:20261021-minimax-preservation-v1`，公开 HTTPS 健康、认证生成协议、原片/计划校验通过；切换时无活动任务，125 个云端任务保留，数据库容器未替换。保留旧镜像、数据库快照和配置备份。
- 云端模型配置只修改 `minimax-storyboard-references.allowedParameters`，其他模型、价格/账户配置不变；既有 prompt_expansion_mode=disabled 保留。
- 运行时包 `artifacts/minimax-preservation-2026-10-21/runtime-pack-approved/rikoko-0.1.29.tgz`，SHA-256 `d2ab10e52be08bc9a49681df715af9a3bb4c3a591b1d4a0519bcd4b2d1724f4b`。
- 源码与测试、切换记录、参数准备快照、视频检查记录位于 `artifacts/minimax-preservation-2026-10-21/`。`unused-workspace-pack`、`runtime-pack`、`runtime-pack-final` 是未批准中间包；最终云端和 platform vendor 使用 `runtime-pack-approved`。

## 实际 CS2 输入及生成

原片资产 `72bd819a-8776-46b4-a68e-a3fd20ed9e0a`：854×480、24fps、409 帧、17042ms；SHA-256 `615b493236859d6f267fb5dfb032782954021e6d2530e30c29b971977d5268fc`。

检查发现旧 B02/B03 参考是 360×640 竖屏，未用于本次生成。不能据此声称它们已经导致前次 B01 的失败。此次重新从上述原片按帧提取：

| 段 | 原片帧范围 | 实际参考资产 | 请求时长 |
| --- | --- | --- | --- |
| A | 0–243 | d3d62905-2687-4b54-a532-c9a0e8f89b03 | 10.167s |
| B | 244–408 | 301d9c36-f60e-468e-984e-672e60cf05f7 | 6.875s |

两段均为854×480、24fps，生成参考移除音轨，原片声音单独用于最终合成。每次请求携带该段真实 video reference、恐怖分子图、SWAT 图；角色图片只指定外观。参数为480P、16:9、对应小数秒，扩写关闭。共提交2次实际 MiniMax H3 Max 生成，没有模型切换。

计划 `5b32d9c8-2a32-4ccc-828a-0e917b5c4649` v1；项目 `abd8a425-de94-4e7f-bdfa-caf404993d93`。

生成任务：
- `cloud-94a85fb8ee78df2fa8856ea4c948b2794dbbccedd56922208bed5648f8dbf670`，输出 `837868d1-58d9-42f4-aaf6-4ff36530d489`。
- `cloud-0c3d0d8254b1c8626473230cbd886d622ead851847482ee3622a34dd256446c1`，输出 `a72140cf-6b6f-4b5b-8d0c-2bfdff98e6ea`。

模型实际返回832×480、10.848s和7.296s。合成不变速、不裁切主体，横向留少量边缘补足854×480，各段只取请求的原片时长。最终为854×480、24fps、409帧、17.041667秒，原片音轨gain=1、生成音轨volume=0。

渲染任务 `7e3e235b-6558-4058-9258-bfe0b9e3007e`；视频资产 `f8e1cbe3-9776-4eb7-89cf-f52a11262af3`；SHA-256 `59b85b404a986b7ce8632580c4609696cf157af4381d39e28ff8c9d655a439dd`。

## 视觉验收：未通过

查看了完整生成段的间隔画面，并通过 media_inspect 对原片与最终成片在0、3、4、5、7.5、10.5、14、16.5秒取样对比。未把离散帧视作完整连续动作或声音验收。

- 4秒：原片仍是前方逃跑者，输出已经进入追逐骑手近景；切镜时刻和占画比例不符。
- 10.5秒：原片是贴地飞掠视角，输出是逃跑者近景。
- 14秒与16.5秒：原片的侧向墙边奔跑、最后俯身冲刺没有在对应时点出现，输出仍是道路远景/摩托车追逐。
- 可辨认两种替换角色以及摩托车、环境，但不能声称动作、镜头、节奏、人物比例严格保留。

原片检查 `8e7d4dc7-9fb6-40ee-bfbb-2a5eead0db63`；输出检查 `d907bd1a-1f87-46bc-ab46-c02a08a7dd90`；正式记录 `c7c477b7-9548-41c0-b394-83ed8d41dc2c` 为 **needs_changes**。workspace_result 保持 technical finalReady=true、reviewAccepted=false，未伪装验收通过。

本次证据说明：实际视频参考和参数已经送入可用的 MiniMax 路径，但多切镜参考生成仍可能重新安排动作和时序。取消接口硬绑定解决的是错误的能力选择规则，不是对模型逐帧保真的保证。

## 交付说明

本地视频：`.data/host-media/codex/7e3e235b-6558-4058-9258-bfe0b9e3007e-f8e1cbe3-9776-4eb7-89cf-f52a11262af3.mp4`，已比对资产哈希。workspace_export 整批导出报错，但视频文件已成功落地；本次没有字幕，后续空文件导出存在单独待排查的问题，未为此重新生成视频。

工作台：<http://127.0.0.1:4310/workspace?project=abd8a425-de94-4e7f-bdfa-caf404993d93&revision=efd1246d-e6fd-403a-8d40-3408b54e5ca6>。
