# 对话附件导入目录

把你要用于创作的图片、音频或视频放到这里，然后在 Codex / Hermes / Claude 原对话说明素材和修改要求。Agent 可调用 `asset_import_file`，上传实际字节并继续创建或修改作品。每个文件上限 100 MiB；需要确认有权使用素材。

这个目录的媒体不进入版本控制。连接器还允许导入工程 `artifacts/` 下的媒体；其他附件目录由操作者通过 `VIDEOWORKBENCH_IMPORT_ROOTS` 配置。浏览器工作台仍可直接上传文件。
