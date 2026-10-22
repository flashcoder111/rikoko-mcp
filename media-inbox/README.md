# Conversation attachment inbox

Place images, audio, or video for your project here, then describe the media and requested edits in your existing Codex, Hermes, or Claude conversation. The Agent can call `asset_import_file` to upload the actual bytes and continue creating or editing. Each file is limited to 100 MiB, and you must confirm the right to use it.

Media in this directory is excluded from version control. The connector also permits media imports from the project's `artifacts/` directory; macOS Hermes installations additionally allow `~/Library/Application Support/Hermes/composer-images/`. Operators can configure other dedicated attachment directories through `VIDEOWORKBENCH_IMPORT_ROOTS`, then reload the host's MCP connection. If an import directory is rejected, copy the selected media here and import it using the new path. The browser workspace also supports direct file uploads.
