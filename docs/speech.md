# rikoko 配音、转写与字幕

## 当前模型

| 用途 | 官方测试服务 | 模型 ID | 说明 |
| --- | --- | --- | --- |
| 云端配音 TTS | MiniMax Speech 2.8 HD，经 fal | `minimax-speech-hd` | 中文、英文真实生成已验证；当前预设音色 `Wise_Woman` |
| 云端语音转写 ASR | ElevenLabs Scribe v2，经 fal | `scribe-v2` | 返回实际识别文本、词或字组时间戳和说话人标记 |
| 本地配音 | macOS 系统语音 / Linux espeak-ng | 无云端模型 ID | macOS 中文 Tingting、英文 Samantha；依赖本机已安装音色 |
| 本地转写 | WhisperX 适配器 | 由本地权重配置确定 | 需要配置识别与对齐权重；不是默认云端路径 |

前一轮功能验收的中文声音来自 Tingting。云端语音是在本轮新增，不能把之前的本地样例称作 MiniMax。

Agent 先读 `capabilities.speech`，使用其中真实可用的模型。宿主指引优先选择可用 MiniMax 配音；原有 API 的 `engine` 默认值保留为 `local` 以兼容旧客户端，因此云端操作必须明确传 `engine: "fal"`。模型不可用时返回错误，不自动更换供应商或切回系统声音。

## 配音

先使用 `quote_create`，再用返回的 quote ID 和相同 input 调用 `job_submit`；轮询 `record_get` 或 `workspace_result`，不要用重新提交代替轮询。

```json
{
  "kind": "tts",
  "engine": "fal",
  "model": "minimax-speech-hd",
  "language": "zh",
  "voice": "Wise_Woman",
  "text": "温暖的光线，清晰的细节，让创意自然呈现。"
}
```

`voice: "default"` 或省略 voice 使用服务端配置的音色；传具体音色会覆盖该字段，保留服务端语速、音量和音频格式。当前输出 32 kHz、128 kbps、单声道 MP3。音色 ID 由供应商验证，选择实际存在的预设音色。

本轮显式语言映射支持 `zh`、`zh-CN`、`en`、`en-US`、`en-GB`、`ja`、`ko`、`es`、`fr`、`de`。真实用例只验收了中文和英文。请求不支持的语言会明确报错。

完成后，将音频素材通过 scene 的 `audioAssetId` 或工作台 `scene_audio` 修改附到已有镜头；调整 `audioSourceStartMs` 可选择音频片段。改配音不需要重新生成画面。

## 转写与自动字幕

上传已有音频或带音轨的视频，或使用配音任务输出的素材 ID：

```json
{
  "kind": "transcribe",
  "engine": "fal",
  "model": "scribe-v2",
  "language": "zh",
  "assetId": "已拥有的音频或视频素材ID"
}
```

成功后用 `transcript_get({assetId: 输出的转写素材ID})` 读取结构化转写。返回 `words` 包含 ID、文本、毫秒起止点及可用时的 speaker。可传给 `transcript_select`、`captions` 或 composition 中的 words 和定时文字事件，进行字幕、选词剪辑和事件定位。`captions` 需要视频素材；仅有音频时先配合图片或视频构建 composition。

渲染会把场景字幕和定时 text 事件一并导出为按时间排序的 SRT。card 和 broll 不作为字幕输出。`workspace_result` 返回实际视频、SRT 和封面，也支持宿主原对话附件。

Scribe 可能把中文个别字符或标点返回成零时长 token。仅当它与前一个有效词组时间相接且说话人相同时，系统将文本合并到该组，并保留原始时间边界；不能单独按这些零时长字符做精确切割。无可合并边界、倒序、重叠或越界的结果仍报错。时间点属于供应商估计，不承诺逐帧或逐字强制对齐精度。

本地与云端不同 FFmpeg 版本对相同 MP3 的编码延迟计量可能不同。只有素材哈希完全相同、来源 ID 对应且 MP3 容器时长差不超过 100 ms 时，才将报告总时长绑定到本地实测值；词时间点不改写，并须全部位于本地音频范围内。其他格式仍要求时长一致。

## 配置与后续直连

官方模型目录在 rikoko-platform 的 `config/models.fal-testing.example.json`，服务端凭据保存在云端运行环境。MCP 客户端只持有官方用户凭据。

自定义模式可用 `fal-video` 适配器配置相同 MiniMax 与 Scribe 端点，并分别声明 `audio/category:speech` 和 `transcript` 能力。原生 MiniMax/Gemini 直连尚未随本轮新增；语音克隆、实时语音会话、自动配乐也不包含在这次实现中。

接口核对来源：[MiniMax Speech 2.8 HD](https://fal.ai/models/fal-ai/minimax/speech-2.8-hd/api)、[ElevenLabs Scribe v2](https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/api)。
