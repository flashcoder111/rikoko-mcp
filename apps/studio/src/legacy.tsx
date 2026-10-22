import React, { useEffect, useRef, useState } from "react";
import "./style.css";
type RecordItem = { id: string; [key: string]: any };
const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  blocked_external: "等待配置",
  submission_unknown: "等待供应商核对",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const authHeaders = (key: string): Record<string, string> =>
  key === "session" ? {} : { Authorization: `Bearer ${key}` };
export default function LegacyApp() {
  const [key, setKey] = useState(
      location.pathname === "/preview" ? "" : "session",
    ),
    [keyDraft, setKeyDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [view, setView] = useState("workspace");
  const [projects, setProjects] = useState<RecordItem[]>([]),
    [revisions, setRevisions] = useState<RecordItem[]>([]),
    [assets, setAssets] = useState<RecordItem[]>([]),
    [jobs, setJobs] = useState<RecordItem[]>([]),
    [usage, setUsage] = useState<any>({ availableCents: 0, reservedCents: 0 }),
    [capabilities, setCapabilities] = useState<any>();
  const [selected, setSelected] = useState<RecordItem>(),
    [mode, setMode] = useState("from-scratch"),
    [title, setTitle] = useState("Orbit 随行杯"),
    [description, setDescription] = useState("轻巧随行，让每一天保持轻盈。"),
    [cta, setCta] = useState("把好状态带在身边"),
    [source, setSource] = useState(""),
    [start, setStart] = useState("0"),
    [end, setEnd] = useState("3");
  const [video, setVideo] = useState(""),
    [time, setTime] = useState(0),
    [sceneId, setSceneId] = useState(""),
    [text, setText] = useState(""),
    [feedback, setFeedback] = useState(""),
    [variantText, setVariantText] = useState(
      "新的一天，从轻盈开始\n你的随行好搭档\n把生活装进这一杯",
    ),
    [rights, setRights] = useState(false);
  const [voiceText, setVoiceText] = useState("Welcome to your next story."),
    [language, setLanguage] = useState("en"),
    [transcript, setTranscript] = useState(""),
    [model, setModel] = useState(""),
    [prompt, setPrompt] = useState(""),
    [shareUrl, setShareUrl] = useState(""),
    [notice, setNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const token = useRef(
    location.pathname === "/preview" ? location.hash.slice(1) : "",
  );
  const call = async (name: string, input: unknown = {}, useKey = key) => {
    const r = await fetch(`/api/tools/${name}`, {
      method: "POST",
      headers: {
        ...authHeaders(useKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error?.message ?? "请求失败");
    return d.result;
  };
  const refresh = async (useKey = key) => {
    const [p, r, a, j, u, c] = await Promise.all([
      call("records_list", { type: "project" }, useKey),
      call("records_list", { type: "revision" }, useKey),
      call("records_list", { type: "asset" }, useKey),
      call("records_list", { type: "job" }, useKey),
      call("usage_get", {}, useKey),
      call("capabilities", {}, useKey),
    ]);
    setProjects(p);
    setRevisions(r);
    setAssets(a);
    setCapabilities(c);
    if (c.cloud?.generation) {
      const refreshed = await Promise.all(
        j.map(async (job: RecordItem) => {
          if (
            job.executionTarget !== "cloud" ||
            !["queued", "running"].includes(job.status)
          )
            return job;
          try {
            return await call(
              "record_get",
              { type: "job", id: job.id },
              useKey,
            );
          } catch {
            return job;
          }
        }),
      );
      setJobs(refreshed);
      setUsage(await call("cloud_usage", {}, useKey));
    } else {
      setJobs(j);
      setUsage(u);
    }
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (!key) return;
    const timer = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [key]);
  useEffect(() => {
    if (selected) {
      setSceneId(selected.composition.scenes[0].id);
      setText(selected.composition.scenes[0].text);
    }
  }, [selected?.id]);
  const latest = selected
    ? jobs.find((j) => j.revisionId === selected.id && j.status === "completed")
    : undefined;
  useEffect(() => {
    let active = true;
    let url = "";
    setVideo("");
    const assetId = latest?.outputs?.[0];
    if (!assetId) return;
    fetch(
      token.current
        ? `/share/assets/${assetId}`
        : `/api/assets/${assetId}/file`,
      {
        headers: token.current
          ? { "X-Preview-Token": token.current }
          : authHeaders(key),
      },
    )
      .then(async (r) => {
        if (!r.ok) throw Error("预览加载失败");
        url = URL.createObjectURL(await r.blob());
        if (active) setVideo(url);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [latest?.id, key]);
  useEffect(() => {
    if (!token.current) return;
    history.replaceState(null, "", "/preview");
    fetch("/share", { headers: { "X-Preview-Token": token.current } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message);
        setSelected(d.revision);
        setJobs(d.jobs);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function submit(input: unknown) {
    return call("job_submit", {
      idempotencyKey: crypto.randomUUID(),
      input,
    });
  }
  async function renderRevision(revision: RecordItem) {
    await submit({
      kind: "render",
      revisionId: revision.id,
      composition: revision.composition,
    });
    setSelected(revision);
    await refresh();
  }
  async function create() {
    if (mode === "rawcut") {
      if (!source) throw Error("请先选择原片");
      await submit({
        kind: "trim",
        assetId: source,
        segments: [
          {
            startMs: Math.round(Number(start) * 1000),
            endMs: Math.round(Number(end) * 1000),
          },
        ],
        width: 360,
        height: 640,
      });
      setView("jobs");
      await refresh();
      return;
    }
    if (mode === "reference-remix" && !source) throw Error("请选择参考视频");
    const project = await call("project_create", { title, brief: description });
    const plan = await call("plan_create", {
      projectId: project.id,
      recipe: {
        mode,
        title,
        product: { name: title, description, cta },
        ...(mode === "reference-remix" ? { referenceAssetId: source } : {}),
        width: 360,
        height: 640,
        language: "zh",
      },
    });
    const revision = await call("record_get", {
      type: "revision",
      id: plan.revisionId,
    });
    await renderRevision(revision);
    setNotice("本地编排已入队。参考理解与新镜头生成需要另行配置模型。");
  }
  async function upload(file: File) {
    if (!rights) throw Error("请先确认有权使用此素材");
    const buffer = await file.arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const intent = await call("upload_create", {
      name: file.name,
      bytes: file.size,
      sha256: hash,
      source: "studio-upload",
      license: "user-authorized",
      rightsConfirmed: true,
    });
    const response = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: authHeaders(key),
      body: buffer,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message ?? "上传失败");
    setSource(data.result.id);
    await refresh();
    setNotice(`已导入 ${file.name}`);
  }
  async function download(assetId: string, name: string) {
    const r = await fetch(`/api/assets/${assetId}/file`, {
      headers: authHeaders(key),
    });
    if (!r.ok) throw Error("下载失败");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function waitJob(job: RecordItem) {
    for (let i = 0; i < 120; i++) {
      const j = await call("record_get", { type: "job", id: job.id });
      if (j.status === "completed") return j;
      if (
        [
          "failed",
          "blocked_external",
          "cancelled",
          "submission_unknown",
        ].includes(j.status)
      )
        throw Error(j.error?.message ?? statusLabels[j.status]);
      await sleep(1000);
    }
    throw Error("任务仍在后台执行，请在任务列表查看");
  }
  async function saveScene(voice = false) {
    if (!selected) return;
    let changes: any = { text };
    if (voice) {
      const job = await waitJob(
        await submit({
          kind: "tts",
          text,
          language,
          voice: "default",
          engine: "fal",
          model: "elevenlabs-voice",
        }),
      );
      const audio = await call("record_get", {
        type: "asset",
        id: job.outputs[0],
      });
      changes = {
        text,
        audioAssetId: audio.id,
        durationMs:
          (Math.ceil((audio.metadata.durationMs / 1000) * 24) / 24) * 1000,
      };
      changes.durationMs = Math.ceil(changes.durationMs);
    }
    const rev = await call("revision_revise", {
      revisionId: selected.id,
      patch: { type: "scene", sceneId, changes },
    });
    await renderRevision(rev);
  }
  if (token.current)
    return (
      <main className="shared">
        <span className="eyebrow">SHARED PREVIEW</span>
        <h1>{selected?.composition.title ?? "加载预览"}</h1>
        {error && <p role="alert">{error}</p>}
        {video ? <video controls src={video} /> : <p>此版本暂无完成的视频</p>}
        <p>只读预览 · 访问权限一小时后到期</p>
      </main>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">◒</span>
          <span>
            Video
            <br />
            <b>Workbench</b>
          </span>
        </a>
        <div className="rail-label">创作空间</div>
        {[
          ["workspace", "◫", "工作台"],
          ["assets", "▧", "素材库"],
          ["audio", "♫", "字幕与声音"],
          ["jobs", "≋", "任务与用量"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`nav ${view === id ? "active" : ""}`}
          >
            <span>{icon}</span>
            {label}
            {id === "jobs" && (
              <small>
                {
                  jobs.filter((j) => ["queued", "running"].includes(j.status))
                    .length
                }
              </small>
            )}
          </button>
        ))}
        <div className="rail-label projects-label">最近作品</div>
        {projects.slice(0, 6).map((p) => (
          <button
            className="project-link"
            key={p.id}
            onClick={() => {
              setSelected(revisions.find((r) => r.projectId === p.id));
              setView("workspace");
            }}
          >
            <i />
            {p.title}
          </button>
        ))}
        <div className="sidebar-bottom">
          <span className="online-dot" /> 本地工作空间
          <p>素材、版本与创作，保存在一起。</p>
          <button
            className="text-button"
            onClick={async () => {
              if (key === "session") {
                const response = await fetch("/auth/session", {
                  method: "DELETE",
                });
                if (!response.ok) {
                  setError("断开连接失败，请重试。");
                  return;
                }
                window.dispatchEvent(new Event("session-expired"));
              }
              setKey("");
              setVideo("");
            }}
          >
            断开连接
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            我的工作空间 <span className="slash">/</span>{" "}
            {view === "workspace"
              ? "视频创作"
              : view === "assets"
                ? "素材库"
                : view === "audio"
                  ? "字幕与声音"
                  : "任务与用量"}
          </span>
          <div>
            <span className="pill">LOCAL FIRST</span>
            <span className="avatar">W</span>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div>
              <span className="eyebrow">FROM AN IDEA TO YOUR NEXT STORY</span>
              <h1>
                {view === "workspace"
                  ? "让想法，成为下一条视频。"
                  : view === "assets"
                    ? "每份素材，都能再次创作。"
                    : view === "audio"
                      ? "让故事，有自己的声音。"
                      : "每一步创作，都有迹可循。"}
              </h1>
              <p>从参考、脚本或已有视频开始，在同一份作品中持续修改。</p>
            </div>
            <span className="version-label">WORKBENCH / 01</span>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="busy" role="status">
              <span className="spinner" />
              {busy}
            </div>
          )}
          {view === "workspace" && (
            <>
              <section className="create-panel">
                <div className="section-heading">
                  <h2>开始一份新作品</h2>
                  <span>01 / BRIEF</span>
                </div>
                <div className="mode-grid">
                  {[
                    [
                      "from-scratch",
                      "✧",
                      "从零创作",
                      "用商品资料和脚本构建故事",
                    ],
                    [
                      "reference-remix",
                      "▣",
                      "参考再创作",
                      "保留灵感，换成自己的表达",
                    ],
                    ["rawcut", "⌁", "已有视频加工", "选取片段，适配新的画幅"],
                  ].map(([id, icon, label, detail]) => (
                    <button
                      className={`mode-card ${mode === id ? "selected" : ""}`}
                      key={id}
                      onClick={() => setMode(id)}
                    >
                      <span className="mode-icon">{icon}</span>
                      <b>{label}</b>
                      <small>{detail}</small>
                      <span className="radio" />
                    </button>
                  ))}
                </div>
                <div className="brief-grid">
                  <label>
                    作品 / 商品名称
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    表达重点
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <label>
                    结尾引导
                    <input
                      value={cta}
                      onChange={(e) => setCta(e.target.value)}
                    />
                  </label>
                </div>
                {mode !== "from-scratch" && (
                  <div className="source-row">
                    <label>
                      选择{mode === "rawcut" ? "原片" : "参考素材"}
                      <select
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        <option value="">从素材库选择</option>
                        {assets
                          .filter((a) => a.kind === "video")
                          .map((a) => (
                            <option value={a.id} key={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {mode === "rawcut" && (
                      <>
                        <label>
                          起点（秒）
                          <input
                            type="number"
                            value={start}
                            onChange={(e) => setStart(e.target.value)}
                          />
                        </label>
                        <label>
                          终点（秒）
                          <input
                            type="number"
                            value={end}
                            onChange={(e) => setEnd(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
                <div className="create-footer">
                  <p>
                    <span className="online-dot" /> 免费本地编排 · 9:16 ·
                    保留可修改版本
                  </p>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => run("正在建立作品…", create)}
                  >
                    生成本地预览 <span>↗</span>
                  </button>
                </div>
                <p className="hint">
                  默认使用原创图形和文字。AI
                  参考理解、新镜头生成需配置供应商；此预览不代表 AI 生成。
                </p>
              </section>
              <section className="workspace-grid">
                <div className="preview-panel">
                  <div className="section-heading">
                    <h2>{selected?.composition.title ?? "作品预览"}</h2>
                    <span>02 / PREVIEW</span>
                  </div>
                  <div className="preview-stage">
                    {video ? (
                      <video
                        ref={videoRef}
                        controls
                        src={video}
                        onTimeUpdate={(e) =>
                          setTime(e.currentTarget.currentTime)
                        }
                      />
                    ) : (
                      <div className="preview-empty">
                        <span className="orbit" />
                        <b>{selected ? "视频正在路上" : "故事从这里展开"}</b>
                        <p>
                          {selected
                            ? "任务完成后，成片会显示在这里"
                            : "填写创作要求，生成第一份本地预览"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="timeline">
                    {selected?.composition.scenes.map((s: any, i: number) => (
                      <button
                        className={s.id === sceneId ? "current" : ""}
                        key={s.id}
                        onClick={() => {
                          setSceneId(s.id);
                          setText(s.text);
                          const seconds =
                            selected.composition.scenes
                              .slice(0, i)
                              .reduce(
                                (v: number, s: any) => v + s.durationMs,
                                0,
                              ) / 1000;
                          if (videoRef.current)
                            videoRef.current.currentTime = seconds;
                        }}
                        style={{ flex: s.durationMs }}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {s.text.slice(0, 12)}
                        <small>{(s.durationMs / 1000).toFixed(1)}s</small>
                      </button>
                    ))}
                  </div>
                  <div className="preview-footer">
                    <span>
                      {time.toFixed(1)}s <span className="slash">/</span>{" "}
                      {selected
                        ? (
                            selected.composition.scenes.reduce(
                              (t: number, s: any) => t + s.durationMs,
                              0,
                            ) / 1000
                          ).toFixed(1)
                        : "0.0"}
                      s
                    </span>
                    {latest && (
                      <div>
                        <button
                          className="text-button"
                          onClick={() =>
                            run("准备下载…", () =>
                              download(latest.outputs[0], "video.mp4"),
                            )
                          }
                        >
                          下载视频 ↓
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            run("准备字幕…", () =>
                              download(latest.outputs[1], "captions.srt"),
                            )
                          }
                        >
                          字幕 ↓
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="edit-panel">
                  <div className="section-heading">
                    <h2>局部修改</h2>
                    <span>03 / REFINE</span>
                  </div>
                  {selected ? (
                    <>
                      <label>
                        当前镜头
                        <select
                          value={sceneId}
                          onChange={(e) => {
                            setSceneId(e.target.value);
                            setText(
                              selected.composition.scenes.find(
                                (s: any) => s.id === e.target.value,
                              ).text,
                            );
                          }}
                        >
                          {selected.composition.scenes.map(
                            (s: any, i: number) => (
                              <option key={s.id} value={s.id}>
                                镜头 {i + 1} · {s.id}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        镜头文案
                        <textarea
                          rows={3}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                        />
                      </label>
                      <div className="two-buttons">
                        <button
                          disabled={!!busy}
                          onClick={() => run("保存新版本…", () => saveScene())}
                        >
                          保存并预览
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            run("为这句重新配音…", () => saveScene(true))
                          }
                        >
                          重新配音
                        </button>
                      </div>
                      <label>
                        替换画面素材
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const assetId = e.target.value;
                            if (assetId)
                              run("替换镜头…", async () => {
                                const revision = await call("revision_revise", {
                                  revisionId: selected.id,
                                  patch: {
                                    type: "scene",
                                    sceneId,
                                    changes: { assetId },
                                  },
                                });
                                await renderRevision(revision);
                              });
                          }}
                        >
                          <option value="">选择一份图片 / 视频</option>
                          {assets
                            .filter((a) => ["image", "video"].includes(a.kind))
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        字幕风格
                        <select
                          value={selected.composition.captionStyle.color}
                          onChange={(e) => {
                            const color = e.target.value;
                            run("更新字幕样式…", async () => {
                              const revision = await call("revision_revise", {
                                revisionId: selected.id,
                                patch: {
                                  type: "style",
                                  style: {
                                    ...selected.composition.captionStyle,
                                    color,
                                  },
                                },
                              });
                              await renderRevision(revision);
                            });
                          }}
                        >
                          <option value="#ffffff">纯白</option>
                          <option value="#d7f5ae">浅绿</option>
                          <option value="#ffd66b">暖黄</option>
                        </select>
                      </label>
                      <label>
                        定位反馈
                        <textarea
                          rows={2}
                          placeholder="描述此处需要修改的内容"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                      </label>
                      <button
                        disabled={!!busy || !feedback.trim()}
                        onClick={() =>
                          run("保存反馈…", async () => {
                            await call("feedback_add", {
                              revisionId: selected.id,
                              sceneId,
                              atMs: Math.round(time * 1000),
                              text: feedback,
                            });
                            setFeedback("");
                            setNotice("反馈已记录到当前版本。");
                          })
                        }
                      >
                        记录 {time.toFixed(1)}s 的反馈
                      </button>
                      <p className="hint">
                        每次修改生成新版本，其他镜头素材继续复用。
                      </p>
                    </>
                  ) : (
                    <div className="edit-empty">
                      创建或选择作品后，按镜头修改文案、声音和画面。
                    </div>
                  )}
                </div>
              </section>
              {selected && (
                <section className="versions-panel">
                  <div className="section-heading">
                    <h2>版本与变体</h2>
                    <button
                      onClick={() =>
                        run("创建分享链接…", async () => {
                          const s = await call("preview_share", {
                            revisionId: selected.id,
                          });
                          setShareUrl(location.origin + s.url);
                        })
                      }
                    >
                      分享当前预览 ↗
                    </button>
                  </div>
                  {shareUrl && (
                    <p className="share-link">
                      <a href={shareUrl} target="_blank" rel="noreferrer">
                        打开一小时预览链接
                      </a>
                      <span>链接包含访问权限，仅分享给指定的人。</span>
                    </p>
                  )}
                  <div className="version-list">
                    {revisions
                      .filter((r) => r.projectId === selected.projectId)
                      .map((r, i) => (
                        <button
                          key={r.id}
                          className={selected.id === r.id ? "chosen" : ""}
                          onClick={() => setSelected(r)}
                        >
                          <span>
                            v
                            {revisions.filter(
                              (v) => v.projectId === selected.projectId,
                            ).length - i}
                          </span>
                          <b>
                            {r.label ?? (r.parentId ? "局部修订" : "原始版本")}
                          </b>
                          <small>
                            {new Date(r.createdAt).toLocaleTimeString()}
                          </small>
                        </button>
                      ))}
                  </div>
                  <div className="variant-form">
                    <label>
                      批量开头 · 每行一个
                      <textarea
                        rows={3}
                        value={variantText}
                        onChange={(e) => setVariantText(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={!!busy}
                      className="primary"
                      onClick={() =>
                        run("创建并渲染独立变体…", async () => {
                          const result = await call("revision_variants", {
                            revisionId: selected.id,
                            variants: variantText
                              .split("\n")
                              .filter(Boolean)
                              .map((text, i) => ({
                                label: `开头 ${i + 1}`,
                                text,
                              })),
                          });
                          for (const revision of result)
                            await renderRevision(revision);
                        })
                      }
                    >
                      制作开头变体 ↗
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
          {view === "assets" && (
            <section className="create-panel">
              <div className="section-heading">
                <h2>素材库</h2>
                <span>{assets.length} ASSETS</span>
              </div>
              <div className="upload-area">
                <span>＋</span>
                <h3>导入视频、图片或声音</h3>
                <p>每份素材最多 100 MB。导入后可在不同作品中复用。</p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={rights}
                    onChange={(e) => setRights(e.target.checked)}
                  />
                  我有权使用这份素材
                </label>
                <input
                  aria-label="选择上传素材"
                  type="file"
                  accept="video/*,image/*,audio/*"
                  disabled={!!busy || !rights}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) run("正在校验并导入素材…", () => upload(f));
                  }}
                />
              </div>
              <div className="asset-grid">
                {assets.map((a) => (
                  <article key={a.id}>
                    <span className="asset-icon">
                      {a.kind === "video"
                        ? "▷"
                        : a.kind === "audio"
                          ? "♫"
                          : a.kind === "image"
                            ? "▧"
                            : "≡"}
                    </span>
                    <small>{a.kind.toUpperCase()}</small>
                    <h3>{a.name}</h3>
                    <p>
                      {(a.bytes / 1024).toFixed(1)} KB · {a.provenance.evidence}
                    </p>
                    <button
                      onClick={() =>
                        run("准备下载…", () => download(a.id, a.name))
                      }
                    >
                      下载 ↓
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
          {view === "audio" && (
            <div className="audio-grid">
              <section className="create-panel">
                <div className="section-heading">
                  <h2>单项配音</h2>
                  <span>VOICE</span>
                </div>
                <label>
                  配音文字
                  <textarea
                    rows={5}
                    value={voiceText}
                    onChange={(e) => setVoiceText(e.target.value)}
                  />
                </label>
                <label>
                  语言
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() =>
                    run("创建配音任务…", async () => {
                      await submit({
                        kind: "tts",
                        text: voiceText,
                        language,
                        voice: "default",
                        engine: "fal",
                        model: "elevenlabs-voice",
                      });
                      await refresh();
                      setView("jobs");
                    })
                  }
                >
                  生成独立音频 ↗
                </button>
                <p className="hint">
                  默认使用 ElevenLabs Eleven
                  v3，用于后期修改或替换配音。提交后生成，音频会保存到素材库。
                </p>
              </section>
              <section className="create-panel">
                <div className="section-heading">
                  <h2>单项字幕</h2>
                  <span>CAPTIONS</span>
                </div>
                <label>
                  视频
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">选择素材</option>
                    {assets
                      .filter((a) => a.kind === "video")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  带时间戳的转录 JSON
                  <textarea
                    rows={5}
                    placeholder='{"schemaVersion":1,"language":"zh","durationMs":3000,"words":[...],"evidence":"precomputed"}'
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                  />
                </label>
                <div className="two-buttons">
                  <button
                    disabled={!!busy || !source}
                    onClick={() =>
                      run("创建转录任务…", async () => {
                        await submit({
                          kind: "transcribe",
                          assetId: source,
                          language,
                        });
                        await refresh();
                        setView("jobs");
                      })
                    }
                  >
                    WhisperX 转录
                  </button>
                  <button
                    disabled={!!busy || !source || !transcript}
                    onClick={() =>
                      run("创建字幕任务…", async () => {
                        await submit({
                          kind: "captions",
                          assetId: source,
                          transcript: JSON.parse(transcript),
                        });
                        await refresh();
                        setView("jobs");
                      })
                    }
                  >
                    烧录已有字幕
                  </button>
                </div>
                <p className="hint">
                  WhisperX 需单独安装本地模型；已有字幕可直接渲染。
                </p>
              </section>
              <section className="create-panel">
                <div className="section-heading">
                  <h2>图片 / 视频 / 音频生成</h2>
                  <span>PROVIDER</span>
                </div>
                <label>
                  已配置的模型
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">选择模型</option>
                    {capabilities?.providers?.map((m: any) => (
                      <option key={m.id} value={m.id} disabled={!m.available}>
                        {m.name ?? m.id} · 上限 {m.maxCostCents} 分
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  生成要求
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>
                <button
                  disabled={!!busy || !model || !prompt}
                  onClick={() =>
                    run("创建生成任务…", async () => {
                      await submit({
                        kind: "generate",
                        model,
                        prompt,
                        parameters: {},
                      });
                      await refresh();
                      setView("jobs");
                    })
                  }
                >
                  提交所选模型
                </button>
                <p className="hint">
                  模型和费用来源由 config 配置。生成结果进入同一素材库。
                </p>
              </section>
            </div>
          )}
          {view === "jobs" && (
            <>
              <div className="stats">
                <article>
                  <span>
                    {capabilities?.generation?.billingSource === "external"
                      ? "自有供应商账户"
                      : "官方可用额度"}
                  </span>
                  <b>
                    {capabilities?.generation?.billingSource === "external"
                      ? "直接付费"
                      : (usage.availableCents / 100).toFixed(2)}
                  </b>
                  <small>
                    {capabilities?.generation?.billingSource === "external"
                      ? "余额请在供应商账户查看"
                      : "记账单位 USD · 本地处理免费"}
                  </small>
                </article>
                <article>
                  <span>
                    {capabilities?.generation?.billingSource === "external"
                      ? "官方额度消耗"
                      : "任务预留"}
                  </span>
                  <b>
                    {capabilities?.generation?.billingSource === "external"
                      ? "0"
                      : (usage.reservedCents / 100).toFixed(2)}
                  </b>
                  <small>
                    {capabilities?.generation?.billingSource === "external"
                      ? "自有服务使用本地 Key 预算控制"
                      : "待结算任务占用的额度"}
                  </small>
                </article>
                <article>
                  <span>完成任务</span>
                  <b>
                    {jobs.filter((j) => j.status === "completed").length}
                    <em> / {jobs.length}</em>
                  </b>
                  <small>退出页面后任务继续执行</small>
                </article>
              </div>
              <section className="create-panel">
                <div className="section-heading">
                  <h2>任务记录</h2>
                  <span>ACTIVITY</span>
                </div>
                {jobs.length ? (
                  <div className="job-list">
                    {jobs.map((j) => (
                      <article key={j.id}>
                        <span className={`job-state ${j.status}`}>
                          {statusLabels[j.status] ?? j.status}
                        </span>
                        <div>
                          <b>
                            {j.input.kind} <small>{j.id.slice(0, 8)}</small>
                          </b>
                          <p>
                            {j.error?.message ??
                              `${new Date(j.createdAt).toLocaleString()} · ${j.evidence ?? "待执行"}`}
                          </p>
                        </div>
                        <span>
                          {j.costStatus === "pending_reconciliation"
                            ? "费用待核对"
                            : `${j.actualCostCents} 分`}
                        </span>
                        {["queued", "running"].includes(j.status) ? (
                          <button
                            onClick={() =>
                              run("请求取消…", async () => {
                                await call("job_cancel", { jobId: j.id });
                                await refresh();
                              })
                            }
                          >
                            取消
                          </button>
                        ) : j.outputs?.length > 0 ? (
                          <button
                            onClick={() =>
                              run("准备下载…", () =>
                                download(
                                  j.outputs[0],
                                  assets.find((a) => a.id === j.outputs[0])
                                    ?.name ?? "output",
                                ),
                              )
                            }
                          >
                            下载 ↓
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty">还没有任务，从第一份作品开始。</div>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>rikoko</span>
            <span>创作有版本，素材可复用。</span>
          </footer>
        </main>
      </div>
      {!key && (
        <div className="login-backdrop">
          <form
            className="login-card"
            onSubmit={(e) => {
              e.preventDefault();
              run("正在连接工作空间…", async () => {
                await refresh(keyDraft);
                setKey(keyDraft);
                setKeyDraft("");
              });
            }}
          >
            <span className="brand-icon">◒</span>
            <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
            <h2>连接视频工作台</h2>
            <p>输入工作空间的 API Key。密钥仅保留在当前页面内存中。</p>
            <label>
              工作空间 API Key
              <input
                autoFocus
                autoComplete="off"
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="vw_…"
                required
              />
            </label>
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={!!busy}>
              进入工作台 ↗
            </button>
            <small>本地首次启动时，密钥保存在 .data/local-admin.key</small>
          </form>
        </div>
      )}
    </div>
  );
}
