import { readFile } from "node:fs/promises";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { publicBaseUrl } from "../../core/src/urls.js";
export const cardUri = "ui://video-workbench/result.html";
export function registerResultCard(server: McpServer, resourceOrigin?: string) {
  registerAppResource(server, "Video result", cardUri, {}, async () => {
    const script = await readFile(
      new URL("../../../apps/mcp-card/dist/card.js", import.meta.url),
      "utf8",
    );
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:transparent;margin:0;padding:0}h2{font-size:14px;font-weight:400;margin:0;color:#999}p{color:#888;font-size:12px;line-height:1.8}#card{position:relative;border-radius:10px;overflow:hidden;background:#f5f5f5;min-height:220px}video,img{width:100%;max-height:480px;object-fit:contain;display:block;background:#141416}audio{width:100%;padding:30px}button{font:inherit;font-size:12px;background:#fff;color:#444;border:1px solid #ddd;border-radius:7px;padding:7px 10px;cursor:pointer;margin:4px 6px 4px 0}button:hover{background:#eee}textarea{display:block;width:100%;font:inherit;border:1px solid #ddd;border-radius:8px;padding:10px;margin-top:10px;resize:vertical}button:focus-visible,textarea:focus-visible{outline:2px solid #777;outline-offset:2px}button:disabled{opacity:.5;cursor:default}@media(prefers-reduced-motion:reduce){.orb{animation:none!important}}#files{display:inline}#status{margin:10px 0}#pending{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#999;gap:16px}.orb{height:28px;width:28px;border:2px solid #ddd;border-top-color:#999;border-radius:50%;animation:turn 1s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}[hidden]{display:none!important}@media(prefers-color-scheme:dark){body{color:#ddd}#card{background:#252528}button{background:#252528;color:#ddd;border-color:#444}}
      </style></head><body><h2 id="title">rikoko · Generate a video</h2><p id="status" role="status">正在连接任务…</p><div id="card"><div id="pending"><span class="orb"></span><span id="pending-label">正在读取任务</span></div><video id="video" controls playsinline hidden></video><img id="image" hidden alt=""><audio id="audio" controls hidden></audio></div><div id="files"></div><button id="refresh">同步最新版本</button><button id="studio" hidden>打开工作台 ↗</button><form id="followup" hidden><label for="request">继续在当前对话修改</label><textarea id="request" rows="2" maxlength="2000" placeholder="例如：把第一段缩短到 2 秒"></textarea><button id="send" type="submit">发送到原对话</button><textarea id="fallback" readonly hidden aria-label="复制到原对话的修改要求"></textarea></form><p>工作台仅用于可选的手动剪辑。媒体链接有效期为一小时。</p><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    return {
      contents: [
        {
          uri: cardUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                resourceDomains: [
                  new URL(resourceOrigin ?? publicBaseUrl()).origin,
                ],
              },
            },
          },
        },
      ],
    };
  });
}
