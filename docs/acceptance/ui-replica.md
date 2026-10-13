# Conversation + expanded editor verification — 2026-10-11

This iteration replaces the prior cream/green shell with a white conversation result surface informed by Pollo MCP, and a dark expanded workspace informed by the authenticated Vizard Agent project. This is independently implemented interaction/layout work, not copied vendor application code. It is not a claim that every product feature or AI capability of either vendor has been reproduced.

## Verified source

- Pollo live ChatGPT app result: finished media card, Download and Reprompt actions. Source screenshot under `artifacts/ui-replica/source/pollo-complete.png`. Reprompt began host response handling; immediately stopped, with no follow-up generation submitted by us.
- Vizard Agent: 1849 × 929 screenshot, 360 px conversation column, 48 px header, IBM Plex Sans, dark media stage, preview controls, thumbnail ruler, bottom/side media placement, grid/list/search/type/sort, and annotation tools. Source screenshots under `artifacts/ui-replica/source/`.
- Chrome's source mobile viewport override did not alter the returned dimensions. `source/vizard-mobile.png` is still desktop, so it is not mobile-reference evidence. Our mobile interaction is an intentional adaptation.

## Implemented

- Default white conversation, inline native video result, status/error/cancel, download, prompt revision, optional expanded workspace. MCP App HTML uses a matching neutral card and preserves non-App fallbacks.
- MiniMax H3 text-to-video: fixed 5 second / 768P profiles for 16:9, 9:16, 1:1; server-side credentials; quote confirmation; durable queue, poll, delivery, and handoff into an editable project. No arbitrary client parameter cost override.
- Workspace: real media playback, seek, mute, playback speed, fullscreen, source downloads, actual decoded thumbnail frames, media preview/search/type/sort/grid/list, project library versus all assets, and bottom/side library.
- Timeline: select, split at playhead, reorder, drag trim edges, numeric trim, delete, caption text/color/size, source volume, music selection/gain, fit, format, local undo/redo, refresh-safe draft, save as immutable revision, version view/restore and actual MP4 export.
- Annotation: pen/arrow/rectangle, colors, undo/clear, frame time and annotated PNG attachment handed to the conversation. This supplies editing context; it does not itself perform AI inpainting.
- Mobile: preview/chat/edit/media tabs, full-width inspector, touch trim and precise numeric controls. Desktop drag-and-drop has explicit previous/next controls as the phone alternative.

## Checks and evidence

- 117 tests in 15 TypeScript test files pass. Coverage: 94.22% statements, 87.27% branches, 94.82% functions, 94.87% lines. This coverage covers core/server/provider logic, not a claim of automated frontend coverage.
- Three Python media tests pass; TypeScript/Vite production builds and formatting checks pass.
- Browser: loaded actual public fal H3 sample; edited second clip caption; undo/redo; split at 2.993 seconds; saved version 2; mobile trimmed first clip to 1.5 seconds, moved it later, changed fit, reloaded to confirm three draft edits survived, saved version 3.
- Export verification: `artifacts/ui-replica/verification.json`; four scenes, expected and actual duration both 4.5 seconds, H.264 video plus AAC audio. Playback output: `artifacts/ui-replica/edited-h3.mp4`.
- Desktop 1849 × 929 and mobile 390 × 844 checked in the in-app browser. Mobile document width equals 390 pixels, with bottom tab bar at y=796–844.
- Tablet 820 × 1180 also checked, with document width equal to 820 pixels. Media VIDEO filtering, `official` search, list view and side/bottom placement were exercised. Frame annotation produced an actual PNG attachment. Final reload/playback reported no captured browser errors.
- Final source comparison, iteration evidence and outstanding gates are recorded in the project-root `design-qa.md`.

## H3 source and remaining boundary

Official API and schema:
- https://fal.ai/models/minimax/h3/text-to-video
- https://fal.ai/models/minimax/h3/text-to-video/api
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/text-to-video

Public listed 768P rate on this date: US$0.06/second, therefore US$0.30 for the locked five-second profile. The sample is fal's public model example, not a newly purchased generation. Paid calls remain disabled until a server FAL_KEY, ENABLE_PAID_PROVIDERS=true, sufficient local account/key budget and a user-approved test spending limit are available. The current session did not run a paid H3 request. No production deployment or external Hermes/mobile-network integration is claimed.

The app implements basic video editing, not CapCut's complete professional feature set (effects catalogue, transitions, keyframes, automatic face tracking and social publishing remain outside this implementation). Free-form agent reasoning still requires the existing optional creative planner or an external MCP agent; local explicit editing commands are supported without it.
