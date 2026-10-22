# 字幕样式本地验收 · 2026-10-17

状态：本地实现及验证完成。未提交、推送、发布或更新用户已安装的 MCP 服务；未创建分支。已有工作区改动保留。

## 实现范围

- 统一字幕样式协议：内置 Noto Sans SC / Noto Serif SC、五档真实字重、描边、阴影、底色不透明度。旧文档缺省字段保持旧渲染方式，单属性编辑不会插入默认值覆盖其他样式。
- 工作台字幕面板提供样式预设、字体/粗细及效果控件、文字描述、可选已有参考分析。描述设置只产生草稿，保存创建新版本并本地导出。
- `caption_style_prepare` 只读生成配置；读取已完成、属于当前账户且绑定源视频的 `visualStyle`。参考中无需字幕。用户明确参数优先，未匹配描述返回 `unmatched`；工作台不自动应用不完整解析。
- `reference_adapt` 支持 `matchCaptionStyle` / `captionDescription` / `captionStyle`；聊天支持常见字幕外观描述。宿主 Agent 可将更复杂描述转成经协议验证的属性。
- MP4 烧录效果，SRT 保持纯文本和时间；不改变已接受画面、配音、字幕文字或口播词时间。
- 字体与完整 OFL 许可证打包，浏览器和 Python 读取同一文件；不调用外部字体 CDN。新增字体文件共约 42.9 MB，按需在浏览器加载。

## 验证

- `pnpm test`：67 个测试文件、455 项通过。随后加入组合否定描述回归并调整输入控件，最后定向运行字幕及聊天测试：4 个文件、46 项通过。
- `pnpm test:media` / Python unittest：10 项通过，包括真实字体字重像素差异、中文字符、描边与阴影像素、FFmpeg 的场景字幕及事件字幕输出、SRT 内容。
- `pnpm build`（包含 TypeScript 检查）：通过；新增字体 URL 由服务端 `/fonts` 路由提供，Vite 保留运行时 URL。
- 修改文件 Prettier 检查、`git diff --check`：通过。
- Playwright 使用本机 Chrome，在独立临时数据库中实际选择宋体/粗体、提交文字描述、检查字体成功加载与 CSS 效果、保存新版本、执行 Worker、刷新验证样式持久化。无页面错误。桌面 1440×1000、手机 390×844 已检查。
- `npm pack --dry-run --json --ignore-scripts`：运行时包含字体目录全部 6 个文件，压缩包约 28.2 MB。公共源码导出包含 `packages/render` 整个目录。
- 来源归属检查、未知字体/非法效果拒绝、字体路径白名单、无付费任务、保持字幕时间等回归通过。

## 本地证据

`artifacts/caption-styles-2026-10-17/`（忽略目录，未发布）：

- `desktop.png`、`mobile.png`：实际浏览器截图。
- `browser-result.json`：字体加载、计算样式、保存后的配置、真实渲染状态。
- `video.mp4`、`preview.png`、`captions.srt`：本地合成测试成片，画面为程序化测试素材，不是真实参考视频或 AI 生成证据。
- `build.log`、`package-files.json`：构建与打包检查。

## 边界

风格推荐是基于现有视觉分析描述的本地规则，不是精确字体识别。没有发起付费视觉分析、语音识别或视频生成。未做 Linux/Windows 实机浏览器验收；可变字体在本机 Pillow/FreeType 和 Chrome 验证。SRT 不包含样式，也未加入逐字动画或任意用户字体上传。
