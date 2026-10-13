# FFmpeg 音频与成片变速接入

日期：2026-10-12。此记录对应开源工具能力优化，不是新增内容模板。

## 本轮已接入

| 能力 | 工作台 / MCP | 导出实现 |
| --- | --- | --- |
| 恒速变速 0.25–4× | 编辑镜头中的“成片速度”；`scene_speed` | FFmpeg `setpts` + `atempo`，保持音高，字幕和事件时间同步缩放 |
| 镜头声音淡入淡出 | 淡入/淡出秒数；`audio_fade` | 转为线性音量曲线，经 FFmpeg `volume:eval=frame` 实际处理 |
| 音量关键点 | 在播放位置添加/删除点，调整百分比；`audio_envelope` | 曲线线性插值，乘以原声音量；裁剪、分割时插值保留边界增益 |
| 源音频波形 | 镜头编辑面板；`asset_waveform` | FFmpeg 解码为 8 kHz 单声道 PCM，再返回分桶峰值；波形是概览，不是完整音频采样 |

工作台位置：打开作品的工作台，双击镜头，或点击“原声音轨”。预览播放器倍速仍是临时预览设置；“成片速度”随版本保存并影响导出。新接口需重启正在运行的本地服务，并让 MCP 客户端刷新工具清单。

音量关键点的时间是镜头输出时间，增益范围 0–1；乘以原声音量 0–2。背景音乐保持原速和已有固定音量。应用淡入淡出会替换本镜头的音量曲线。独立配音与原声使用相同的镜头变速和音量参数。浏览器使用 Web Audio GainNode 支持超过 100% 的预览音量。

## MCP 参数

通过 `workspace_commit` 传入 `action: { type: "edit", edits: [...] }`，沿用 `projectId`、`baseRevisionId` 和幂等键：

```json
[
  { "type": "scene_speed", "sceneId": "scene-1", "speed": 2 },
  { "type": "audio_fade", "sceneId": "scene-1", "inMs": 400, "outMs": 400 },
  { "type": "audio_envelope", "sceneId": "scene-2", "points": [
    { "timeMs": 0, "gain": 0.5 },
    { "timeMs": 1000, "gain": 1 }
  ] }
]
```

编辑按数组顺序应用。`audio_envelope.points: []` 清空曲线；点时间必须严格递增并位于镜头内。淡入与淡出总时长不能超过镜头长度。变速后若字幕或事件短于现有契约允许范围，会拒绝整次编辑，保留原版本。

`asset_waveform` 输入为 `{ "assetId": "...", "startMs": 0, "durationMs": 10000, "bins": 256 }`；时间为**源素材时间**，没有经过镜头变速。需要 read 权限，每次最多 10 分钟、16–1024 桶，同一进程最多 2 个解码任务；缓存也重新鉴权。该读取不创建渲染任务或付费调用。

## 验证证据

- `pnpm test:coverage`：32 个测试文件、188 项测试通过；语句 91.31%、分支 84.37%、函数 90.89%、行 92.17%。覆盖统计范围是 vitest 配置中的后端与共享 TypeScript 模块，不代表 React/Python 全部行覆盖率。
- `pnpm test:media`：4 项通过，包括真实 FFmpeg 的 2×/0.5×时长、音高、曲线增益、裁剪偏移，以及短片段预览图。
- `pnpm build`：类型检查与两个前端构建通过。
- `pnpm exec tsx scripts/verify-audio-editing.ts`：独立内存数据库与合成素材验证波形、2×实时预览、150% 音量参数、保存、真实导出、重新打开、移动端无横向溢出。无控制台异常。
- 产物：`artifacts/audio-editing/verification.json`、`speed-and-fades.mp4`、`audio-controls.png`、`mobile.png`。

修复了 FFmpeg 在快速播放时按输出时长过早截断输入，以及短于 0.3 秒的成片无法生成预览图的问题。补充了非整数倍速下贴片起止位置取整、密集音量曲线裁剪与切换素材时旧音频连接释放的回归测试。

## 仍未接入

多轨自由排列、音频交叉淡化、背景音乐音量关键点、自动压低配乐、响度归一化、降噪、静音自动粗剪、场景检测、视频转场仍未在本轮开放。WhisperX 等识别模型仍需独立安装与实际素材验收。未安装大模型、调用付费服务或部署；本轮只完成本地实现和验证。
