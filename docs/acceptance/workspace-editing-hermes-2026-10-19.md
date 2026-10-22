# 工作台编辑与 Hermes 联动验收（2026-10-19）

## 本次改动

- 工作台新增“改文案”“换音乐”直接入口。字幕输入即时进入可撤销草稿，保存不再依赖额外的“应用字幕”按钮。
- 音乐面板增加音频上传，沿用原有上传授权与素材校验，上传后从背景音乐列表选择；保留配乐和原声音量调节。
- 保存入口统一为“保存并合成预览”；明确提示复用现有素材、不会重新生成画面。桌面宽屏编辑面板不再遮挡主保存按钮。
- `workspace_handoff_prepare` 在账户事务内校验作品最新版本、选中镜头、附件归属与幂等键，保存可由原 Hermes 会话读取的请求，不创建模型或渲染任务。
- 工作台交接入口提供 Hermes 桌面深链接和复制指令。桌面插件要求用户选择原会话，保留已有草稿，追加继续指令，由用户发送。插件不自动调用模型。
- 浏览器发现更新版本后提供“载入最新版本”，有本地修改时不自动覆盖；准备中改变镜头/要求时丢弃过期返回。
- 插件安装脚本、公共源码导出清单、运行时包文件清单和宿主指引已补齐。

## 验证证据

- TypeScript 类型检查、修改文件格式检查及 `git diff --check` 通过。
- workspace、request、planner、conversation UI、editor UI、handoff UI、Hermes 插件 SDK 边界、MCP native chat、host integration、host guides、public export 的相关回归通过。
- `scripts/verify-workspace-handoff.ts` 在临时数据库和零预算账号中通过真实浏览器操作：输入字幕、上传音乐、选择音乐、调整音量、保存新版本、真实 FFmpeg 合成；确认原视频 assetId 保持不变，任务全部为 `render`。
- 同一浏览器完成交接准备，服务端读取确认请求携带当前版本和镜头；准备前后任务数量不变。模拟 MCP 后续修改后，网页可载入最新字幕。手机宽度 390px 无横向溢出；无浏览器页面错误。
- 截图与机器结果：`artifacts/workspace-handoff/caption-edit.png`、`hermes-handoff.png`、`mobile.png`、`result.json`。
- 已安装本机 `~/.hermes/desktop-plugins/rikoko-workspace/plugin.js`。通过 Hermes 实际界面的 Capabilities → Plugins 确认“rikoko 工作台联动”显示 Desktop on disk，开关为 on。
- 本机 4310 服务返回的前端 bundle 与本次本地构建相同。使用 Hermes 安装配置对应凭据向新接口提交空输入，得到参数校验错误 `INVALID_INPUT/400`，确认运行后端已识别此接口；该探测不创建数据。

## 边界

浏览器自动化的 URL 安全策略禁止打开 `hermes://`，没有绕过。完整“点击深链接 → 原生会话输入框插入”尚未进行真实端到端验收；插件的目标会话选择与追加草稿通过 SDK 替身测试，实际插件加载已确认。用户可使用复制继续指令的备用入口。

没有向 Hermes 发送消息，没有执行付费模型调用，没有修改用户作品用于验收；仅使用临时账号和合成测试素材。未创建 Git 分支、未提交或推送、未发布云端。本次未重启后端或 Hermes；运行中的本机服务与前端已单独检查，不能由此推定云端已更新。

操作与接口说明见 [工作台编辑与 Hermes 联动](../architecture/workspace-hermes-handoff.md)。
