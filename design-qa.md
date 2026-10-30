# 双模式界面验收 · 2026-10-11

## 结论与验收边界

本地双模式、基础剪辑、保存和真实导出已跑通。桌面界面基于实际登录后的 Pollo MCP 结果和 Vizard Agent 工作台复刻交互与布局，使用 rikoko 品牌。尚不能认定“所有界面状态完全复刻 + H3 新生成端到端”全部验收完成：没有执行新的付费 H3 请求，也没有取得有效的源站手机视口截图。

## 对照依据

| 对象 | 源站截图 | 实现截图 | 尺寸与状态 |
| --- | --- | --- | --- |
| 对话结果 | `artifacts/ui-replica/source/pollo-complete.png` | `artifacts/ui-replica/conversation-final.png` | 两张均为 1849 × 929，完成态、浅色；源站为图片，实作为 H3 样片剪辑后的视频 |
| 工作台 | `artifacts/ui-replica/source/vizard-workspace.png` | `artifacts/ui-replica/workspace-final.png` | 两张均为 1849 × 929，深色、紧凑时间线、底部媒体库 |
| 时间线和媒体库局部 | `artifacts/ui-replica/source/vizard-detail.png` | `artifacts/ui-replica/workspace-detail.png` | 从完整截图相同区域 x=360, y=535 裁切，均为 1489 × 300 |
| 标注 | `artifacts/ui-replica/source/vizard-annotation.png` | `artifacts/ui-replica/annotation.png` | 箭头、矩形、颜色和撤销；真实 PNG 回传另经操作验证 |

桌面对照按同一 CSS 视口与截图像素尺寸进行，无倍密度缩放。完整截图成对置于同一次图像审阅中；局部对照也成对审阅。动态内容不同，未把篮球和 H3 视频的画幅/颜色差异归为界面误差。源站宿主 ChatGPT 的导航和账号功能没有作为本产品功能复制。

实作另检查 390 × 844 手机及 820 × 1180 平板。DOM 文档宽度分别为 390 和 820，无页面横向溢出。`source/vizard-mobile.png` 实际仍是桌面尺寸，不作为手机复刻依据；手机四个工作区标签是本产品的响应式适配。

## 必需视觉检查

- **字体和排版：** Vizard 的 IBM Plex Sans 已本地打包，工作台使用 13–14px 界面字号和接近源站的层级。中文使用系统回退字体。实际项目标题省略、素材文件名省略和状态文字换行可读。
- **布局和间距：** 桌面保持 48px 顶栏、360px 对话列、中央舞台、缩略图尺和底部 154px 级媒体卡。局部对照中媒体区和时间线接近源站位置。新增作品范围选择、剪辑展开及版本/导出按钮占用额外空间，属于真实编辑功能的扩展。
- **颜色和表面：** 对话白色背景、淡蓝用户消息和灰色工具行；工作台深色舞台、细分隔线与粉色选择/编辑状态。移除此前米色/绿色工作区外观。实作未冒用厂商品牌标识。
- **图像和图标：** 使用真实媒体和实际解码的时间线缩略图；未用生成图或 CSS 绘画冒充视频素材。标准控件使用一致的 Lucide 图标。H3 示例与篮球/温室源内容不同，按用户指定的 H3 开发素材处理。
- **文案：** 显示实际版本、任务状态、文件名与错误；不虚构生成百分比或 Agent 执行步骤。标题/控件使用本产品文案，不声称由 Pollo/Vizard 提供服务。
- **交互与可访问性：** 输入/按钮有标签，使用原生按钮、选择框和范围控件；支持 Enter 提交、Shift+Enter 换行、撤销/重做、分割快捷键和 Escape 关闭面板。存在可见焦点与 reduced-motion 样式。未宣称完成 WCAG 全量审计、屏幕阅读器或所有放大倍率测试。

## 迭代记录

1. **P1，默认工作台密度与源站不同：** 初版始终显示多轨编辑工具，占据过多舞台空间。改为默认紧凑时间线，通过“剪辑”展开真正的编辑工具；调整媒体区尺寸及顶栏排列。后续 `workspace-final.png` 和局部对照确认默认结构接近源站，`workspace-editing.png` 保留扩展剪辑状态。
2. **P2，手机底栏定位冲突：** 原有 top 规则与新增 bottom 定位冲突。清除 top，使 390 × 844 下标签条位于 y=796–844；预览、对话、剪辑和媒体均可到达。
3. **P2，手机视频卡留白过大：** 原固定最小高度在实际视频上造成灰色填充。真实视频就绪时取消固定高度，保留原画幅。`mobile-conversation.png` 确认结果可完整显示并保留下载/进入工作台操作。
4. **P2，草稿切换/刷新丢失：** 按不可变版本存储编辑历史，成功保存新版本后再清理旧草稿。手机裁切、重排和 fit 三项修改在刷新后保留，并保存为 v3。
5. **状态修复：** H3 生成恢复记录按作品保存，并保存提示词；切换作品重置对话子树；异步素材接入等待完成后再恢复操作。成片播放避免再次叠加片段音量。这些修复经代码检查和最终构建检查，未借此宣称 H3 付费生成已实测。

## 功能检查

- 对话与工作台使用同一项目、版本与导出。
- 实际字幕修改、撤销/重做、分割、手机数值裁切、片段重排、填充方式、草稿恢复、保存新版本及导出。
- 实际媒体列表切换、VIDEO 类型筛选、关键词 `official` 搜索和侧边/底部切换。
- 箭头/矩形画面标注生成并上传真实 PNG，携带时间和区域进入对话附件。未把这项功能描述为 AI 局部重绘。
- 真实渲染输出包含 4 个片段，ffprobe 验证 4.5 秒、H.264 视频及 AAC 音轨；证据在 `artifacts/ui-replica/verification.json`。
- 最终加载与播放检查没有捕获到浏览器 error 日志。
- 117 项 TypeScript 测试及 3 项媒体测试通过；生产构建和格式检查通过。覆盖率仅适用于已有核心/服务/Provider 测试范围，不代表前端自动化覆盖率。

## 剩余验收项

1. 配置服务端 fal 凭据和付费开关、具备可用账户额度，并取得本轮测试预算后，实测 H3 的新生成、进度、结果、下载和转入剪辑全流程。目前使用的是 fal 官方公开 H3 样片。
2. 取得源站有效手机截图及可操作状态后，再验收手机端逐项视觉复刻。现有手机端已做实际可用性测试。
3. 整个 ChatGPT 宿主外壳、厂商计费/登录、剪映完整特效库/关键帧/跟踪等不属于已实现功能；自由自然语言规划仍依赖项目已有的可选模型配置或外部 MCP Agent。

## 实现检查清单

- [x] 源站与实作完整截图、局部截图成对审阅
- [x] 手机和平板边界、实际编辑、保存与导出
- [x] 最终生产构建、格式、核心和媒体测试
- [ ] H3 新付费生成端到端验证
- [ ] 源站手机逐项对照验收

final result: blocked

## 2026-10-11 — 原对话宿主接入

默认产品入口已明确为 Codex / Hermes / Claude 原对话，网页聊天保留独立使用和调试。新增 stdio 本地媒体桥接、四种客户端配置、Keychain 安装器、Apps 原对话续改与工作台版本同步。卡片 DOM/bridge 测试验证同步、消息拒绝回退与轮询竞争；全套 125 项测试通过。

真实 SDK 进程已完成同一作品跨 profile 创建、编辑、恢复并取得真实 MP4。该结果不是三个厂商应用 UI 均已验收：Codex MCP 待重载、Claude Desktop 待登录、Hermes 主机待确认。证据与安装状态见 [三端接入验收](docs/acceptance/host-integration.md)。此前网页截图不再被用作原生宿主接入的完成证据。

---

## Project workspace redesign — 2026-10-30

- Source: `/var/folders/px/ghk7pf1d5qb0c2m7wy13c0xm0000gn/T/codex-clipboard-1063b81d-74a4-4f49-b063-1cba9e97e773.png` (2513 × 1202, normalized to 2048 × 980).
- Implementation: `/Users/west/.codex/visualizations/2026/10/30/01a18cb6-5892-7a92-9b98-eb6dd7edea5b/project-table-final.png` (2048 × 980 CSS viewport, density 1); source and implementation both show a populated list with the first request expanded.
- Full comparison: `/Users/west/.codex/visualizations/2026/10/30/01a18cb6-5892-7a92-9b98-eb6dd7edea5b/project-comparison-final.png`.
- Focused comparison: `/Users/west/.codex/visualizations/2026/10/30/01a18cb6-5892-7a92-9b98-eb6dd7edea5b/project-comparison-detail.png`.
- Mobile: `/Users/west/.codex/visualizations/2026/10/30/01a18cb6-5892-7a92-9b98-eb6dd7edea5b/project-table-mobile.png` at 390 × 844.
- Findings and fixes: initial P2 mobile view required horizontal scrolling to see status and download. Changed narrow-screen rows to a stacked layout with those controls visible; verified the revised mobile screenshot. Desktop spacing was tightened after the first capture so the table sits closer to the heading as in the reference.
- Typography: restrained UI text and monospace model identifiers follow the reference; Chinese uses system fallback. Spacing: narrow top bar and sidebar, wide table, similarly sized rows, separators, and expandable prompt. Colors: neutral white and warm gray with green completion state. Imagery: thumbnails use the actual task output, rather than copying third-party customer imagery. Copy: rikoko names and real job data replace the reference product and its data. Filters, preview and local update entry remain intentional additions.
- Verified in the in-app browser: automatic local connection, request expansion, preview dialog, search, mobile navigation, and visible download links. No browser console errors observed. Preview data is isolated fixture data, not customer records.
- final result: passed
