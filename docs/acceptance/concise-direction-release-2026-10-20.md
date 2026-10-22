# rikoko 0.1.27 部署与汉堡首轮比较

用户授权部署优化后的运行时并重做汉堡视频，与上一版及 Hypit 逐镜比较。沿用现有分支，未创建分支、提交或推送。

## 发布

- 云端镜像：`video-workbench-cloud:20261020-concise-direction-v1`。
- 本地运行时：`.data/releases/20261020-concise-direction/runtime`。
- 从已部署 0.1.26 提取基线，仅纳入 sceneDirection、精简分析交接和相应指导内容等 13 个文件及版本更新。
- 编译器 `rikoko-prompt-compiler-v5`，模板 `rikoko-scene-direction-v1`，分析指令 `reference-v2.3-concise`。
- 四个宿主配置更新；新建 stdio 连接验证通过。当前已打开的 Codex 会话仍缓存旧工具 schema，新字段调用通过相同 Codex 配置建立的新 SDK 连接完成。旧会话需重新连接 MCP 才能直接识别新字段。
- 延后发布的 workspace UI、Hermes handoff 等无关工作未纳入。平台业务代码、前端与迁移共 54 文件对比保持旧镜像内容。
- runtime tgz SHA-256：`a96f8bf48f7ff3003b5979f7284ae4fe4b7c5bbbacc51201edeefaeb16b01e2e`。未发布 npm。
- 云端切换前后 jobs 均为 103、active 为 0；模型配置哈希不变，数据库容器不变，compose 仅替换 cloud 镜像。备份与旧镜像保留。

## 验证

- 运行时相关 7 文件、93 测试通过；typecheck 通过。
- 平台测试首次有两项分析版本硬编码断言过时；改为协议常量后，受影响文件 3 测试通过。平台 typecheck、runtime package verification 通过。
- 候选镜像在禁网、只读容器中完成真实本地渲染，不调用模型。
- 部署后公共 HTTPS health 确认 runtimeVersion=0.1.27；认证 generation protocol 和错误源视频绑定防护通过。
- 本地 4310 原有 164 jobs 保留；4311 验证服务也切换。四个宿主 stdio 配置连接验证通过。
- 部署证据：`artifacts/concise-direction-release-2026-10-20/` 下 activation.log、cloud-live-verification.json、host-verification.json、runtime-tests.log 等。

## 实际生成结果

四次 MiniMax 首轮生成全部成功，testing 结算 chargedCents 均为 0。输入图／视频哈希和模型配置与上一版相同；没有新生成图片、没有质量重试。两版剪辑参数保持一致。

视觉取样结论：S01 工序错误仍存在；S02 下降更明显但新增双肉饼；S03 敞口铺菜明显改善；S04 背景更干净但主体变小，品牌布局仍是旧版。不能宣称整片稳定提升或追平 Hypit。

正式成片 15 秒、1080×1920、24 fps；workspace_result purpose=final 技术验证通过。用户要求的逐镜比较另存报告，正式可选视觉 review 状态仍为 unreviewed。

完整比较报告：`/Users/west/project/rikoko test/comparison-2026-10-20-optimized/逐镜对比报告.md`。该目录含三版同步视频、四镜原片和对比片、取样图、全部实际输入及提示词。

## 本轮发现的操作链问题

计划自动创建项目后，将原 request 关联该项目会增加 request 版本，旧计划绑定随即过期；生成与渲染本身完成，但 final 查询报 REQUEST_CONFLICT。已正式重绑相同计划，并按现有媒体复用接口逐镜保留原 preparation / job 来源，完成交付，没有修改媒体或绕过请求绑定。这一生命周期问题未作为本次发布额外代码修复，应单独回归覆盖。
