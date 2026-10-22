# 官方与个人模板复用闭环

日期：2026-10-22。运行时：0.1.32。本地实现与验证；未提交、未推送、未部署、未切换正在运行的宿主服务。沿用两个仓库原有分支，保留已有改动。

## 已实现

- 官方成片编排模板和图片/视频提示词模板共用管理员发布、不可变版本、回滚、下架与手动目录同步。目录包含 `templates` 和 `promptTemplates`，旧客户端仍能读取成片目录。
- 同 ID 官方云端条目优先于内置条目；显式 `sourceKind=builtin` 可继续选择内置版本。同步保留旧缓存版本；同源同 ID/version 内容变更被拒绝，失败不覆盖旧缓存。
- `template_save` 从一个已保存 revision、模板 preparation、显式 composition 或 prompt 创建个人模板。个人 ID 独立于官方，按账户隔离；更新必须提供当前 expectedVersion，每次写入新历史版本；重复幂等键不重复创建，内容变化返回冲突。
- `template_list` / `template_match` 包含个人成片模板与提示词候选。`template_prepare` 复用已有素材；`template_prompt_prepare` 渲染声明的文字参数，不调用生成模型。
- 显式命名的个人成片模板可进入本地 workspace_plan；更自由的内容改写由 Agent 检索后完成。
- `template_prepare` 返回服务端 preparationId；将其作为 templatePreparationId 提交 workspace_commit 后，项目保留来源 ID、版本、哈希和快照，编辑后的 revision 可再保存为个人模板。
- 官方更新只改变官方目录。个人条目通过 updateAvailable 提示上游新版本，不执行合并或替换；用户明确要求调整时再保存新的个人版本。
- 当前管理界面新增 `/templates`：官方/个人过滤、搜索、成片与提示词内容、手动同步、从已保存作品版本保存个人模板。旧编辑组件也保留保存入口。
- rikoko-platform 的管理员界面支持新建提示词模板；公共运行时依赖更新为固定的 `vendor/rikoko-0.1.32.tgz`，无兄弟仓库源码依赖。

## 边界

个人模板保存在当前本地账户数据库，引用该账户的本地素材；不上传个人内容，不提供跨设备私有云同步或社区发布。官方模板源仍需配置可达 URL。历史目录定义保留不等于所有历史媒体均已离线下载；缺少素材仍需从官方存储获取。

提示词模板是可复用创作数据，不自动选择模型、提供参考素材、授予生成权限或证明质量。动态提示词通过 template_prompt_prepare 和既有生成准备链路使用；历史强类型 director kit 选择器继续保持原版本行为。忠实替换任务仍须遵守已有计划与提示词编译约束。

## 验证

- TDD：新增生命周期测试最初在云端同 ID 优先、个人保存和来源绑定等缺口上失败；实现后通过。另补提示词长参数反例并修复 schema 上限不一致。
- 7 个模板/素材/口播/UI 测试文件：58 项通过；当次新增核心模块覆盖率为语句 90.79%、分支 84.07%、函数 97.56%、行 90.44%。后续补长参数测试通过。
- 管理界面、工作台、指南、云边界、导演模板等 8 个测试文件：35 项通过。
- 最终生命周期、个人保存 UI、管理界面 3 文件：20 项通过。
- `pnpm build` 通过；平台 `pnpm verify:runtime` 和 `pnpm build:cloud` 通过。
- `pnpm exec tsx scripts/verify-template-lifecycle.ts` 使用隔离数据库、临时服务与本机 Chrome：浏览器保存个人模板 → 同步官方 v2 → 个人 v1 保持原内容 → Agent 检索并准备复用；桌面/手机无横向溢出，未出现页面异常。
- 浏览器证据：`output/template-lifecycle-2026-10-22/personal-template-desktop.png`、`personal-template-mobile.png`。
- 平台 cloud / reference-catalog 两文件最终 27 项通过，包含真实云 API 应用与本地固定运行时包之间的发布、同步、个人修改和 Agent 复用。媒体相关测试使用已安装依赖的 MEDIA_PYTHON；未设置该变量的首次宽范围运行有两项环境缺依赖失败，补齐解释器路径后通过。
- 0.1.32 包 SHA-256：`d7689c982d05193e007e341d2e52da30caa97fd1c9c15376d0c1988bb47af21f`。平台依赖及锁文件已更新，包校验通过。
- 逐项检查了来源隔离、官方命名空间、旧缓存迁移、并发写入版本条件、来源绑定、模板文本的非指令边界与 UI 保存状态；`git diff --check` 和本次改动文件格式检查通过。
- 无付费生成。不同测试组存在重叠，不将以上数字直接相加。
