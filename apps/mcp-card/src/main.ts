import { App } from "@modelcontextprotocol/ext-apps";
type Result = {
  jobId: string;
  title?: string;
  status?: string;
  error?: string;
  workspace?: string;
  projectId?: string;
  revisionId?: string;
  media?: { mimeType: string; url: string; name: string }[];
};
const app = new App({ name: "Video Workbench", version: "0.2.0" }, {});
const title = document.getElementById("title")!;
const status = document.getElementById("status")!;
const video = document.getElementById("video") as HTMLVideoElement;
const image = document.getElementById("image") as HTMLImageElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const studio = document.getElementById("studio") as HTMLButtonElement;
const files = document.getElementById("files")!;
const followup = document.getElementById("followup") as HTMLFormElement;
const request = document.getElementById("request") as HTMLTextAreaElement;
const send = document.getElementById("send") as HTMLButtonElement;
const fallback = document.getElementById("fallback") as HTMLTextAreaElement;
let current: Result | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  checks = 0,
  loading = false,
  generation = 0;
const labels: Record<string, string> = {
  queued: "等待处理",
  running: "正在制作",
  completed: "制作完成",
  failed: "制作失败",
  blocked_external: "等待配置",
  cancelled: "已取消",
  submission_unknown: "等待核对",
};
function data(result: unknown): Result | undefined {
  const r = result as { structuredContent?: { result?: Result } };
  const value = r?.structuredContent?.result;
  return value && typeof value.jobId === "string" ? value : undefined;
}
function render(result: Result) {
  current = result;
  document.getElementById("pending")!.hidden = !!result.media?.some((m) =>
    /^(video|image|audio)\//.test(m.mimeType),
  );
  document.getElementById("pending-label")!.textContent =
    result.error ?? labels[result.status ?? ""] ?? "正在读取任务";
  title.textContent = result.title ?? "你的视频";
  status.textContent =
    result.error ?? labels[result.status ?? ""] ?? "正在读取任务";
  studio.hidden = !result.workspace;
  followup.hidden = !result.projectId;
  files.replaceChildren();
  for (const player of [video, audio]) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  image.removeAttribute("src");
  video.hidden = true;
  image.hidden = true;
  audio.hidden = true;
  for (const media of result.media ?? []) {
    let url: URL;
    try {
      url = new URL(media.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    if (media.mimeType.startsWith("video/") && video.hidden) {
      video.src = media.url;
      video.hidden = false;
    } else if (
      media.mimeType.startsWith("image/") &&
      video.hidden &&
      image.hidden
    ) {
      image.src = media.url;
      image.alt = media.name;
      image.hidden = false;
    } else if (media.mimeType.startsWith("audio/") && audio.hidden) {
      audio.src = media.url;
      audio.hidden = false;
    }
    const button = document.createElement("button");
    button.textContent = media.mimeType.startsWith("video/")
      ? "打开视频"
      : media.mimeType.startsWith("image/")
        ? "打开图片"
        : media.name;
    button.addEventListener(
      "click",
      () =>
        void app.openLink({ url: media.url }).catch(() => {
          status.textContent =
            "当前宿主无法打开链接，请让 Agent 返回文件地址。";
        }),
    );
    files.append(button);
  }
}
async function poll() {
  if (!current?.jobId || loading) return;
  const expected = generation;
  loading = true;
  refresh.disabled = true;
  try {
    const next = data(
      await app.callServerTool({
        name: "workspace_result",
        arguments: { jobId: current.jobId },
      }),
    );
    if (expected !== generation) return;
    if (!next) throw Error("无法读取任务结果，请在对话中继续查询。");
    render(next);
    if (["queued", "running"].includes(next.status ?? "") && ++checks < 120)
      timer = setTimeout(() => void poll(), 5000);
  } catch (error) {
    if (expected !== generation) return;
    status.textContent =
      error instanceof Error
        ? error.message
        : "连接中断，任务仍保存在工作空间。";
  } finally {
    if (expected === generation) {
      loading = false;
      refresh.disabled = false;
    }
  }
}
app.ontoolresult = (result) => {
  const next = data(result);
  if (!next) return;
  if (timer) clearTimeout(timer);
  generation++;
  loading = false;
  refresh.disabled = false;
  checks = 0;
  render(next);
  if (!next.status || ["queued", "running"].includes(next.status)) void poll();
};
refresh.addEventListener("click", async () => {
  if (loading) return;
  if (timer) clearTimeout(timer);
  const expected = ++generation;
  checks = 0;
  if (current?.projectId) {
    loading = true;
    refresh.disabled = true;
    try {
      const response = await app.callServerTool({
        name: "workspace_snapshot",
        arguments: { projectId: current.projectId },
      });
      if (expected !== generation) return;
      const snapshot = (
        response.structuredContent as {
          result?: {
            headRevisionId: string;
            jobs: { id: string; revisionId: string }[];
          };
        }
      )?.result;
      const job = snapshot?.jobs.find(
        (j) => j.revisionId === snapshot.headRevisionId,
      );
      if (!snapshot || !job)
        throw Error("The latest revision has no render yet");
      current = {
        ...current,
        revisionId: snapshot.headRevisionId,
        jobId: job.id,
      };
      void app
        .updateModelContext({
          content: [
            {
              type: "text",
              text: `Hypit project ${current.projectId}, latest revision ${current.revisionId}, job ${current.jobId}. Read workspace_snapshot before editing.`,
            },
          ],
        })
        .catch(() => {});
    } catch {
      if (expected !== generation) return;
      status.textContent = "无法同步工作台，请在当前对话中要求刷新这份作品。";
      return;
    } finally {
      if (expected === generation) {
        loading = false;
        refresh.disabled = false;
      }
    }
  }
  void poll();
});
followup.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!request.value.trim() || !current?.projectId) return;
  const text = `继续修改 Hypit 作品 ${current.projectId}：${request.value.trim()}\n请先读取 workspace_snapshot 的最新版本，再执行修改并在当前对话返回媒体结果。`;
  send.disabled = true;
  fallback.hidden = true;
  try {
    const response = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text }],
    });
    if (response.isError) throw Error("Host rejected message");
    request.value = "";
    status.textContent = "已交给当前对话继续处理。";
  } catch {
    fallback.value = text;
    fallback.hidden = false;
    status.textContent =
      "当前宿主未开放卡片发送消息；复制下方内容到原对话即可继续。";
  } finally {
    send.disabled = false;
  }
});
studio.addEventListener("click", () => {
  if (current?.workspace)
    void app.openLink({ url: current.workspace }).catch(() => {
      status.textContent = "请让 Agent 返回工作台链接。";
    });
});
window.addEventListener("pagehide", () => {
  generation++;
  if (timer) clearTimeout(timer);
});
void app.connect().catch(() => {
  status.textContent = "当前宿主未连接卡片，可在对话中查询任务并取回文件。";
});
