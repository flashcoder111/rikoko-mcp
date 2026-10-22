# Claude adapter

Distinguish Claude Code from Claude Desktop. Both use the same rikoko tools and acceptance rules; a shared `claude` transport label does not tell you which file or display tools are available.

## Claude Code

The installer configures MCP only. Use natural language and read only relevant topics through `rikoko_guide`. Keep the workflow in the current conversation; this guide does not require `context: fork`, a delegated agent, shell interpolation or pre-approved tool permissions.

Use the discovered MCP tool names. Import only the user-selected media path through `asset_import_file` and its configured directories. Claude Code's ability to read a file does not grant the rikoko process access to it; resolve a missing mount/path without inventing an asset ID.

## Claude Desktop

This installer registers local MCP; it does not install a Claude Desktop skill or guarantee `/rikoko`. Accept “use rikoko to…” and the exposed MCP prompts `rikoko_create` / `rikoko_resume` when the client presents them. Read `rikoko_guide` with topic `overview`, then `host-claude` and the relevant production topics. The guide works without a terminal or local Markdown reader and does not register an MCP App.

An attachment visible to Claude is not necessarily accessible to a local MCP process. Use an exposed file path/bytes only when available. Otherwise record the concrete gap and offer the configured import directory or workspace upload. Do not claim that Desktop attachments are automatically uploaded to rikoko or ask for the entire Downloads/home directory.

## Visual review and delivery

Inspect the actual image blocks from `media_inspect`. Native vision capability does not prove a particular connector forwarded them. If only text/metadata is received, obtain user or supported vision-capable review and preserve `unreviewed`; do not label an analysis description as your visual observation.

For both Claude surfaces, prefer the exact returned downloadable media links plus the clickable workspace URL. A `resource_link` may be presented as a link rather than an inline player. A Codex local Markdown embed or Hermes `MEDIA:` line is not a portable Claude attachment. Use native attachments only when this session supports them; `workspace_export` can save a requested local file without making Desktop display it automatically. Keep explicit previews labeled; deliver technically ready completed output without a final AI review gate.

For a new revision, refresh `workspace_snapshot` and use its current base revision. On reconnect, resume existing jobs. Submit requested work directly with job_submit; do not introduce a separate price-confirmation dialog. Respect the host's tool permissions and any explicit user spending limits.

Reference: [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Desktop local MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

Default policy: quickly check critical input images once using actual pixels or user judgment. Do not invoke paid vision review by default. Final videos need no AI review or listening pass for delivery, and quality findings never authorize automatic regeneration. Preserve unknown review status and return technically ready output immediately.
