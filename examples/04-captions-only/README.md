# E04 / 04-captions-only

预置字幕真实烧录，复用原音频；不是 ASR。

从项目根目录执行 `pnpm demo`，共用脚本依顺序建立素材，运行全部八例；不重复启动开发服务。当前例证据在 `artifacts/acceptance/<run>/E04*.json` 和 `outputs/E04*`。

输入配置见 `request.json`，可重放代码见 `scripts/demo.ts` 的 E04。恢复时用返回的 job_id 查询，已有任务不要换幂等键重复提交；重新运行整个 demo 会创建新作品，不覆盖旧版本。

本目录记录的是本地子检查，不代表计划书中对应完整 AI/人工质量门槛通过。
