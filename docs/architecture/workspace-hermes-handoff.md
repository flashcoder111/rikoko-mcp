# 工作台编辑与 Hermes 联动

工作台直接编辑文案和背景音乐，保存时复用现有视频素材，只运行本地 `render` 合成。按钮统一为“保存并合成预览”。修改独立字幕不重配音，也不能移除烧进原片的文字；原视频混合的音乐与人声由原声音量一起控制。

## 用户流程

1. 打开作品工作台，点击“改文案”，选中镜头后直接输入。文案即时加入草稿，无需额外点击“应用字幕”。
2. 点击“换音乐”，选择已有音频或上传音乐。上传完成后从背景音乐列表选择，调节配乐音量，播放预览试听。
3. 点击“保存并合成预览”。新版本保留原画面资产，旧版本可恢复。
4. 需要 Agent 继续处理时，先保存手动修改，再展开“交给 Hermes 继续”，填写要求并准备交接。
5. 点击“打开 Hermes，选择原会话”。在 Hermes 中选择原会话，点击“在所选会话中继续”，要求会追加到输入框；用户发送后开始执行。原有草稿不会被替换。也可复制继续指令到原对话。
6. Hermes 保存修改后，工作台会检测到新版本。若浏览器正在查看旧版本，点击“载入最新版本”；有本地草稿时不会自动覆盖草稿。

## 安装桌面联动

在源码目录运行 `pnpm hermes:plugin`，将托管插件安装到 `$HERMES_HOME/desktop-plugins/rikoko-workspace/plugin.js`（默认 `~/.hermes/`）。已有托管文件更新前备份；非托管同名文件拒绝覆盖。Hermes 默认热加载，可在 Capabilities → Plugins 查看，必要时执行 Reload desktop plugins。CLI 和没有插件的其他宿主使用复制指令入口。

后端必须加载包含 `workspace_handoff_prepare` 的新源码或运行时，网页需要对应的新构建。只安装桌面插件不更新后端。旧 Hermes 会话至少要能调用已有的 `workspace_request_get`、`workspace_snapshot` 和 `workspace_commit`；刷新 MCP 可获得最新工具列表。

插件采用 [Hermes Desktop SDK](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/desktop-plugin-sdk.md) 的 route、`host.request("session.list")`、`host.openSession` 和 `host.composer.insertText` 接口。没有读取 Hermes 凭据，没有后台消息发送，也没有把网页自由文本直接放入深链接。

## 数据与执行边界

- `workspace_handoff_prepare` 校验账户权限、作品当前 head、选中镜头和附件归属，并以幂等键保存一个 `workspace-request`。准备请求不创建作业或报价。
- 深链接只包含 requestId 和 projectId；这两个 ID 本身不提供读权限。具体要求由 Hermes 经自己已有的 rikoko 连接读取。
- Hermes 先读请求再读最新 snapshot。已提交请求不重复提交；旧版本要求需结合最新状态处理。
- 桌面插件不默认选择会话，按当前 profile / connection 列出会话；选择后只向该会话的输入框追加草稿。中途切换连接则中止。
- “准备完成”只表示上下文已保存，不表示 Hermes 已接收或执行。真正发送、工具执行与付费生成仍使用 Hermes 原有流程。

## 验证

`pnpm exec tsx scripts/verify-workspace-handoff.ts` 使用临时数据库、零预算账号和合成测试素材，运行真实浏览器及 FFmpeg，覆盖输入文案、上传并选择音乐、音量、保存合成、素材复用、交接准备、模拟 Agent 更新后的版本载入和手机布局。它不向 Hermes 发送消息。测试生成的截图和结果保存在 `artifacts/workspace-handoff/`。
