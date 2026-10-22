# MCP 调用错误与恢复

本约定覆盖 rikoko 自己的 HTTP/MCP 错误。MCP SDK 在进入工具回调前拒绝的参数、宿主的连接错误或熔断提示，仍可能使用宿主/SDK 原生错误格式。

## 返回值

成功响应保留原来的 `content` 和 `structuredContent.result`，图片继续使用原生 MCP image blocks。不要把宿主拼接后的展示文本视为 JSON。Hermes 的 `result` 文本可能包含 JSON、`MEDIA:` 路径或自然语言；优先读取 `structuredContent.result`，并保留原图片块。

失败响应保持 `isError: true`。HTTP 的 `error`、MCP 的 `structuredContent.error` 和错误文本中的 JSON 使用相同结构：

```json
{
  "error": {
    "code": "MEDIA_DEPENDENCY_MISSING",
    "message": "Media inspection failed at extract_frame: ffmpeg_not_found.",
    "traceId": "00000000-0000-4000-8000-000000000000",
    "details": {
      "stage": "extract_frame",
      "reason": "ffmpeg_not_found",
      "systemCode": "ENOENT"
    },
    "recovery": {
      "action": "check_environment",
      "retrySameInput": false,
      "instruction": "Check FFmpeg on the backend that performs inspection before retrying."
    }
  }
}
```

示例 instruction 为说明文字；以运行时实际返回为准。Hermes 可能把上述错误 JSON 再包装为字符串，读出其错误字段即可，不要作为成功结果处理。HTTP → 本地 MCP 桥接保留后端 traceId；媒体诊断在后端日志中记录相同 ID。未知异常不返回堆栈、命令或原始 stderr。

## 恢复规则

| 情况 | 操作 |
| --- | --- |
| 字段或生产计划不合法 | 根据字段路径/问题清单修正；`production_plan_validate` 直接接收 plan，save 接收 `{plan, planId?, expectedVersion?}`。不能删除复刻或审核约束来绕过校验。 |
| `PLAN_CONFLICT` | 通过 `record_get` 读取当前计划，合并当前意图，再用最新版本保存。不能只替换版本号后覆盖旧内容。 |
| `MEDIA_DEPENDENCY_MISSING` | 检查运行媒体处理的后端是否能启动 FFmpeg，不能以 Agent 自己终端的环境替代。 |
| `MEDIA_SOURCE_MISSING` / `MEDIA_PERMISSION_DENIED` / `MEDIA_STORAGE_FULL` | 修复对应存储或目录访问问题；减少采样无效。 |
| `MEDIA_PROCESS_FAILED` | 检查解码、视频流和 FFmpeg 功能。reason 由已知 stderr 特征分类，不返回原始路径、URL、凭据或媒体元数据。 |
| `MEDIA_OUTPUT_MISSING` | 检查请求的抽帧位置和真实素材是否能产生画面。 |
| `MEDIA_TIMEOUT` | 根据 stage 判断是否可缩小区间或减少抽帧；不能把所有媒体错误当成超时。 |
| `MEDIA_BUSY` / `RESULT_NOT_READY` | 等待再查询已有操作，不能重新提交生成任务。 |
| `BACKEND_TRANSPORT_ERROR` / `BACKEND_RESPONSE_INVALID` | 写操作结果可能未知。先读取已有记录/任务，再决定是否重试。 |
| `BACKEND_TOOL_UNAVAILABLE` | 桥接端公布的工具不在当前后端中。更新并重启匹配的后端后再重载宿主；仅改参数或重载桥接端不能解决。 |
| Hermes 暂停连接 | 保留首次底层错误，等待提示的冷却时间后再调用。修复原因，不能通过重复调用、重连或关闭保护来绕过。 |

## 免费媒体环境自检

```sh
pnpm clients doctor hermes --media
```

诊断使用已安装配置建立独立 MCP 连接，在对应后端调用 `media_runtime_check`。工具使用小型合成图片验证临时文件读写、FFmpeg 缩放/PNG 提取和灰度解码，随后清理临时文件。它不读取用户文件、不保存资产、不调用模型、不收费。旧后端缺少该工具时，doctor 会明确报告并返回非零状态。

自检不证明用户的视频编码可解码、资产存储可访问、宿主模型看见像素或附件投递成功，也不会重载原有 Hermes 聊天。代码更新只有被实际运行的服务加载后才生效；仅重载 MCP 不会替换仍在运行的旧后端。

Hermes 重启网关后，已有聊天也可能仍缓存旧工具列表和 stdio 进程。应在原会话确认新工具及错误结构确实可用；本机验证中完整退出并重开 Hermes 后才生效。

自动多帧抽样会用 FFprobe 的视频包时间戳约束片尾请求点，避免容器音轨比视频更长时抽不到最后一帧。该步骤的错误阶段为 `probe_video`，缺失 FFprobe 时原因是 `ffprobe_not_found`。显式 `timesMs` 不自动前移，越过最后一帧仍可能返回 `MEDIA_OUTPUT_MISSING`。时间字段始终表示请求位置，不是逐帧解码时间证明。

## 验证

`tests/mcp-reliability.test.ts` 使用真实 HTTP 后端和 MCP 客户端执行上传、计划校验/保存、冲突恢复和 FFmpeg 抽帧；同时覆盖文件丢失、损坏媒体、错误路径、诊断泄露和零生成任务。

本机 Hermes 兼容检查可通过环境变量选择实际安装的适配器源码：

```sh
HERMES_MCP_HANDLERS=/absolute/path/to/Hermes/workspace/tools/mcp_tool_handlers.py pnpm exec vitest run tests/hermes-result-bridge.test.ts
```

测试执行该版本实际的结果转换函数；图片缓存、文本清理/截断等外围依赖使用受控替身，不启动宿主 Agent、不读取账号配置、不发送消息。因此它验证返回值转换兼容性，不代表真实聊天/视觉验收。CI 未提供该路径时明确跳过这一项。
