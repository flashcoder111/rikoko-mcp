# Third-party notices

- TikTok link acquisition uses the separately installed `yt-dlp` Python package (Unlicense, https://github.com/yt-dlp/yt-dlp) and `curl_cffi` (MIT, https://github.com/lexiforest/curl_cffi). Exact packages and transitive dependencies are pinned in `python/uv.lock`; upstream license texts remain in the installed distributions. FFmpeg/ffprobe use the existing system toolchain.

The application core, fixtures generator, tool definitions, recipes and studio are original implementations. Hypit source, Skills and example media have not been copied. Earlier research remains separate reference material.

Dependency source and license metadata are captured in `docs/integrations/code-manifest.json`, `pnpm-lock.yaml`, `python/uv.lock` and the generated `artifacts/release/dependency-licenses.json`. The MCP SDK examples informed API usage; tool/business implementations are original. Consult the installed packages for complete license texts.

- MCP Apps extension (`@modelcontextprotocol/ext-apps` 2.0.3): MIT, upstream at https://github.com/modelcontextprotocol/ext-apps.
- MCP TypeScript SDK and middleware: Apache-2.0, upstream at https://github.com/modelcontextprotocol/typescript-sdk.
- Hono, React, Vite, Zod, node-postgres, pg-boss and AWS JavaScript SDK: consult pinned package licenses and generated dependency report.
- PGlite: Apache-2.0; embedded PostgreSQL has its own PostgreSQL license.
- Pillow: HPND; jsonschema: MIT; Python/transitive notices remain applicable.
- FFmpeg: build-dependent LGPL/GPL. The tested Homebrew build enables GPL and libx264; it is not bundled in this source tree. A distributed container must include applicable notices, source offer/materials and its actual build configuration. Container release compliance has not been verified.
- The legacy default subtitle font is loaded from the operating system and is not redistributed. Explicit subtitle font choices bundle unmodified Noto Sans SC and Noto Serif SC variable TTF files from https://github.com/google/fonts under SIL Open Font License 1.1. Source URLs, hashes and full licenses are retained in `packages/render/fonts/`.
- WhisperX and other researched projects are optional candidates, not vendored code or installed default dependencies. No pretrained weights are bundled or downloaded by the default demo.

The root Apache-2.0 LICENSE is the proposed license for original code. Final public-release review, model/service permissions and container SBOM remain separate release gates.

## UI interaction reference (2026-10-11)

The new conversation and expanded editor are independent implementations informed by user-requested observations of Pollo MCP and Vizard Agent. Their application code, logos and proprietary assets are not redistributed. The media in `artifacts/ui-replica/minimax-h3-official-sample.mp4` is a public fal MiniMax H3 example downloaded for local development verification; it is not a new generation or a product marketing asset. Review its rights before redistribution.

- `lucide-react`: ISC; icons from https://lucide.dev.
- `@fontsource/ibm-plex-sans`: font files under SIL Open Font License 1.1; package code under MIT. Upstream IBM Plex: https://github.com/IBM/plex. Font license is retained in the installed package.
