# rikoko 声音生成与后期修改

## 声音流程

视频优先使用并保留所选视频模型实际生成的原生对白、环境声和音效。先检查模型规格与输出音轨，不能因为有音轨就推断已经生成了所需对白。独立语音模型用于用户要求的后期修改、补充旁白或替换配音，不是每条新视频的必经步骤。

**默认独立配音：ElevenLabs Eleven v3。** 本地系统配音已移除，`tts.engine` 仅接受 `fal`；未提供 model 时使用 `elevenlabs-voice`。模型缺失或不可用时明确报错，不切换到系统声音或其他品牌。已有系统语音与 MiniMax 的历史验收记录按原样保留，不代表新默认模型已经真实验收。

## 业务动作与模型

| 动作 | 模型 / 档案 ID | 输入与输出 |
| --- | --- | --- |
| 后期配音、替换旁白 | ElevenLabs Eleven v3 / `elevenlabs-voice` | 文案、语言、预设音色 → 独立语音 |
| AI 背景配乐 | ElevenLabs Music / `elevenlabs-music-30s` | 情绪、乐器、节奏描述 → 固定 30 秒纯器乐 |
| AI 音效 | ElevenLabs Sound Effects V2 / `elevenlabs-sound-5s` | 动作、环境或转场描述 → 固定 5 秒音效 |
| 声音克隆 | MiniMax Voice Clone / `minimax-voice-clone` | 10–60 秒参考音频、试听文案 → 试听音频与专属音色 ID |
| 复用克隆音色 | MiniMax Speech-02 HD / `minimax-cloned-speech` | 已有克隆素材、音色 ID、新文案及语言 → 新旁白 |
| 语音转写 | ElevenLabs Scribe v2 / `scribe-v2` | 音频或有声音的视频 → 文本、词或字组时间、说话人标记 |

上述生成通过 fal 统一接入。新的内置与自有配置档案采用待核对费用占位值，默认没有确认费用上限；先核对费用和权限，再开启。官方测试模式显式采用独立测试账户费用规则，不表示供应商免费。新增配乐、音效、Eleven v3 与克隆只完成本地协议和媒体验证，尚无本轮真实生成或听感验收。

## 配置与报价

`config/models.custom.example.json` 包含这些档案；官方测试目录在 rikoko-platform 的 `config/models.fal-testing.example.json`。每次先读 `capabilities`，核对 `available`、`fixedParameters` 和参考限制。目录不自动启用凭据或接受费用。

所有独立生成都先 `quote_create`，用户同意本次报价后，用相同 input、quote ID 和稳定的幂等键调用 `job_submit`。查询原任务进度，不用重新提交轮询。图片、画面或声音修改后需要新的对应报价；已接受素材直接复用。

音乐和音效使用固定档案参数：`music_length_ms=30000`、`force_instrumental=true`，以及 `duration_seconds=5`。其他规格需新增核价档案，不通过自然语言或 `generate.parameters` 覆盖费用相关参数。

## 后期配音

```json
{
  "kind": "tts",
  "engine": "fal",
  "model": "elevenlabs-voice",
  "language": "zh",
  "voice": "Rachel",
  "text": "温暖的光线，清晰的细节，让创意自然呈现。"
}
```

`voice: "default"` 使用档案预设；请求中的具体音色和语言会映射到 Eleven v3 的 `voice`、`language_code`，`zh-CN` 规范化为 `zh`。供应商负责验证所选语言和音色是否支持。服务器保留已核价的稳定性与格式设置。

完成后通过 `scene_audio` 或 scene.audioAssetId 替换指定镜头的旁白，保留画面。此操作会替换该镜头的声音；如果只想叠加声音，使用下述独立声音事件。

## 配乐与音效

配乐的生成 input：

```json
{
  "kind": "generate",
  "model": "elevenlabs-music-30s",
  "prompt": "温暖、轻快的木吉他与柔和钢琴，适合咖啡店新品短片，无人声",
  "parameters": {}
}
```

生成后，通过 `workspace_commit` 的 `music` edit 绑定背景音频：`{"type":"music","assetId":"MUSIC_ASSET","gain":0.15}`。背景音乐会循环至成片末尾。

音效的生成 input 使用 `model=elevenlabs-sound-5s`，prompt 描述声音，例如“杯子放到木桌上的轻响，安静室内”。它通过供应商的 `text` 字段提交，时长固定 5 秒。

在最新版本上添加定时音效：

```json
{
  "type": "sound",
  "sceneId": "SCENE_ID",
  "eventId": "cup-down",
  "assetId": "SOUND_ASSET",
  "offsetMs": 600,
  "durationMs": 900,
  "audioSourceStartMs": 100,
  "gain": 0.7
}
```

offsetMs 是镜头内时间；可用 wordId 绑定已有词时间。audioSourceStartMs 选择音效文件的起点，不能超出实测源时长。同一 eventId 可更新该音效，assetId=null 删除它。声音事件和镜头原声、独立旁白、背景音乐混合，不写入字幕，也不替换旁白。裁剪或分割会保留相交音效并同步调整其源起点；移除镜头同时移除其音效。

## 声音克隆与复用

先导入参考音频。当前克隆档案要求音频 10–60 秒、最多 20 MiB；不能用参考视频 ID 冒充音频。如果只有视频，先提取真实音轨并重新导入。

```json
{
  "kind": "generate",
  "model": "minimax-voice-clone",
  "mode": "voice_clone",
  "prompt": "你好，这是这个声音的试听。",
  "references": [{ "assetId": "REFERENCE_AUDIO_ASSET", "role": "voice" }],
  "parameters": {}
}
```

此任务产生试听音频。读取输出素材的 `provenance.voiceClone`，其中保存 voiceId、provider、reuseModel 和 activationRequiredWithinDays；音色档案随素材保存在当前账户中。保留该输出素材 ID，避免为每句话重复克隆。

后续使用同一音色：

```json
{
  "kind": "tts",
  "engine": "fal",
  "model": "minimax-cloned-speech",
  "voiceAssetId": "CLONE_OUTPUT_ASSET",
  "voice": "RETURNED_VOICE_ID",
  "language": "zh",
  "text": "这里是修改后的旁白。"
}
```

服务端核对克隆素材所属账户、专属音色 ID 与匹配模型。官方通路还核对原官方网关并映射原云端音色素材。MiniMax 克隆音色不能用于 Eleven v3，也不能假设能跨供应商账户使用；普通后期配音仍默认 Eleven v3。

按供应商说明，新克隆音色需要在 7 天内通过兼容 TTS 使用一次才能保留。系统不自动购买激活或续用，后续合成单独报价。克隆试听完成不等于音色相似度、情绪和多语言质量已验收。

## 转写与字幕

`transcribe` 使用 `engine=fal`、`model=scribe-v2` 和实际 audio/video assetId。完成后通过 `transcript_get` 读取实际 words、毫秒起止时间及可用的 speaker，用于字幕、选词剪辑和事件定位。不能从 Gemini 视频分析摘要捏造逐词时间。

Scribe 的零时长中文字符仅在紧邻有效词组且说话人一致时并入该组，保留原时间边界。字幕时间仍属供应商估计；导出同时提供视频、SRT 与封面。本地 WhisperX 转写仍为可选适配器，需要独立环境与权重，本次没有移除或宣称已验收。

## 字幕字体、描边与阴影

工作台的字幕面板支持字体、五档粗细（300/400/500/600/700）、字号、文字颜色、底色与不透明度、描边宽度/颜色，以及阴影颜色/不透明度/模糊/水平和垂直偏移。样式对整个作品生效，修改先进入本地草稿；保存后创建新版本并本地渲染，已有画面、音频和词时间不变。

可选内置 Noto Sans SC（黑体）和 Noto Serif SC（宋体），浏览器与 Python 使用随运行时打包的同一份可变字体。旧项目没有新字段时保持原默认字体及外观；调整旧默认字体的字重时使用内置黑体，以确保五档粗细都能正确导出。字体、描边和阴影烧录到 MP4；SRT 只保存文字和时间，不承载这些样式。

无需参考视频，也无需参考中有字幕。在字幕面板输入例如「电影感，宋体，白字，细描边，轻微阴影，无底框」，点击「根据描述 / 参考预览样式」。可同时选择已有参考分析，使用其 `visualStyle.description` 推荐风格。该步骤使用本地规则，不会发起视觉分析、转写或付费模型请求；未识别的描述会明确提示，工作台不会把部分识别结果直接应用。复杂描述也可由当前对话 Agent 转为结构化设置。

MCP 示例：

```json
{
  "description": "参考视频没有字幕，黑体加粗，白字，黑色描边，轻微阴影，无底框",
  "overrides": { "strokeWidth": 2, "shadowBlur": 4 }
}
```

将以上输入传给 `caption_style_prepare`；可选 `analysisAssetId` 必须属于当前账户、对应原视频的有效分析，`currentStyle` 用于保留当前设置。返回 `style` 可用于 `composition.captionStyle`，或将 `edit` 放进 `workspace_commit.action.edits`。优先级为：当前设置 → 参考风格预设 → 用户指定预设/文字风格 → 用户明确属性 → `overrides`。本地规则只提供推荐，不宣称识别出原视频的精确字体；`unmatched` 列出未理解的片段。

`reference_adapt` 可设置 `matchCaptionStyle: true`，并以 `captionDescription` 和 `captionStyle` 补充覆盖；参考没有字幕时同样工作。它不会凭空添加字幕文案或生成语音。独立 `captions` 操作的 `style` 也接受所有新增字段。

```json
{
  "type": "style",
  "fontFamily": "noto-serif-sc",
  "fontWeight": 600,
  "fontSize": 32,
  "color": "#ffffff",
  "backgroundOpacity": 0,
  "strokeWidth": 2,
  "strokeColor": "#111111",
  "shadowColor": "#000000",
  "shadowOpacity": 0.65,
  "shadowBlur": 4,
  "shadowOffsetX": 0,
  "shadowOffsetY": 2
}
```

尺寸单位是导出画面的像素，预览按画面比例缩放。描边宽度 0、阴影不透明度 0 分别关闭对应效果。当前不提供上传任意字体、精确字体识别或逐字动画。内置字体来源与许可证保存在 `packages/render/fonts/`，打包缺失会报错，不会悄悄替换成另一套字体。

## 口播模板按需对齐

词时间用于口播、旁白、教程和清单等以人声带动节奏的模板。商品卖点、三步教程、三点清单、软件功能介绍和用户评价内置模板声明 `speech.mode=optional`；不选择口播时仍按模板原时长编排。纯视觉和音乐卡点不需要增加转写或配音任务。

先确定最终使用的音频或有声视频，再取得该素材对应的转写。已有源素材绑定的转写可以复用；缺少转写才单独报价和提交，不为启用对齐重新生成声音。`template_prepare` 的可选输入：

```json
{
  "id": "rikoko-starter-product",
  "version": 1,
  "parameters": {
    "text1": "新品上市",
    "text2": "轻巧便携",
    "text3": "了解详情"
  },
  "sceneAssets": {},
  "speech": {
    "assetId": "FINAL_RECORDING",
    "transcriptAssetId": "MATCHING_TRANSCRIPT"
  }
}
```

每个镜头的文案按顺序对应实际口播，匹配时允许标点、空格和大小写差异。系统校验素材归属、转写来源、实际时长和词边界，使用真实词时间决定切镜点；保留录音开头、结尾及语句间的停顿。每个镜头保存其音频源起点、词时间和 `speechAlignment` 来源记录。中文词组不可按字符平均分时；分句跨越同一词组时明确要求调整分句。画面短于对应旁白时要求补足画面，不截断声音。

模板原有的音量包络随新镜头长度等比例映射；四舍五入到同一毫秒的控制点合并，避免短语句产生无效时间轴。独立标点和空白不单独参与切镜，也不会令相邻音频区间重叠。

默认显示整句字幕，起止时间使用该镜头首词和末词的真实边界。工作台、视频烧录字幕和 SRT 使用同样的边界；逐字高亮与新的强制对齐供应商未在本轮接入。模板页只在支持的模板下显示“跟随口播编排（可选）”，可选择已有音频及其对应转写，不自动启动付费任务。

模板定义可声明可复用关键词规则，避免把某一次配音的绝对秒数写死：

```json
{
  "speech": {
    "mode": "optional",
    "anchors": [
      { "eventId": "feature-card", "text": "{{text2}}", "occurrence": 1 }
    ]
  }
}
```

`eventId` 必须是模板已有的事件，关键词在该事件所属镜头中查找，`occurrence` 指定第几次出现。事件沿用自身 `offsetMs` 和 `durationMs`，不能超出新的镜头长度；关键词落在一个较粗的词组中时，以该词组的真实起点绑定。

换配音或改变承载原声的画面时，会清理旧词时间、来源记录和依赖词的事件，保留独立叠加内容；随后复用已接受画面，用新音频及其转写重新准备对齐。调整音量保留对齐；裁剪、分割和变速同步映射词时间，裁去全部语音的片段不再显示口播字幕。词时间只用于内容与时间的对应，不能据此宣称嘴型同步。

协议依据：[Eleven v3](https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api)、[Music](https://fal.ai/models/fal-ai/elevenlabs/music/api)、[Sound Effects V2](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api)、[MiniMax Voice Clone](https://fal.ai/models/fal-ai/minimax/voice-clone/api)。
