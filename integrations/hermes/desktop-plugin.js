// rikoko managed Hermes Desktop plugin. No credentials or automatic sends.
import { host, useValue, ROUTES_AREA } from "@hermes/plugin-sdk";
import React, { useEffect, useState } from "react";

const h = React.createElement;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
export function readHandoff(hash) {
  const route = new URL(hash.replace(/^#/, ""), "https://rikoko.invalid");
  if (route.pathname !== "/rikoko-handoff") return null;
  const request = route.searchParams.get("request") ?? "";
  const project = route.searchParams.get("project") ?? "";
  return idPattern.test(request) && idPattern.test(project)
    ? { request, project }
    : null;
}
export function handoffPrompt({ request, project }) {
  return [
    "/rikoko 继续工作台中的修改。",
    `先调用 workspace_request_get，requestId=${request}，读取用户要求、素材和选中镜头。`,
    `再调用 workspace_snapshot，projectId=${project}，读取最新版本；不要沿用聊天里的旧版本。`,
    "如果请求已经 submitted，读取现有任务结果，不重复提交。若版本已变化，核对修改是否仍适用，不能覆盖较新的修改。",
    "改文案、换现有音乐使用 workspace_commit 编辑并合成，复用现有画面。只有用户明确要求新画面或新配音时才准备对应生成，并遵循报价授权。",
    "若当前 rikoko 连接找不到该请求，请检查工作空间连接，不要猜测作品或另建副本。完成后返回同一作品的工作台链接。",
  ].join("\n");
}
function HandoffPage() {
  const profile = useValue(host.state.profile);
  const connection = useValue(host.state.connectionId);
  const [hash, setHash] = useState(window.location.hash);
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const context = readHandoff(hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    let active = true;
    setSessions([]);
    setSelected("");
    setMessage("");
    host
      .request("session.list", { limit: 100 })
      .then((result) => {
        if (active)
          setSessions(Array.isArray(result.sessions) ? result.sessions : []);
      })
      .catch(() => {
        if (active)
          setMessage(
            "无法读取会话，请连接 Hermes 后重试，或复制指令到原会话。",
          );
      });
    return () => {
      active = false;
    };
  }, [profile, connection]);
  async function continueInSession() {
    if (working || !context || !sessions.some((s) => s.id === selected)) return;
    const sameHost = () =>
      host.state.profile.get() === profile &&
      host.state.connectionId.get() === connection;
    if (!sameHost()) return;
    setWorking(true);
    try {
      await host.openSession(selected, { profile });
      if (!sameHost()) throw Error("连接已切换，请返回工作台重新交接。");
      // Only the explicitly selected conversation may receive this draft.
      // insertText preserves any text the user already typed.
      const inserted = await host.composer.insertText(
        selected,
        handoffPrompt(context),
        { mode: "block" },
      );
      if (!inserted)
        throw Error(
          "会话输入框尚未就绪。请从工作台复制继续指令，粘贴到所选原会话。",
        );
      host.notify({
        kind: "info",
        message: "工作台要求已带入输入框，发送后 Hermes 将读取最新作品继续。",
      });
    } catch (e) {
      host.notifyError(e, "未能带入输入框，请复制继续指令到原会话。");
    } finally {
      setWorking(false);
    }
  }
  return h(
    "div",
    { style: { padding: 24, maxWidth: 720, overflow: "auto" } },
    h("h2", null, "继续 rikoko 工作台修改"),
    !context
      ? h("p", { role: "alert" }, "交接链接无效，请从 rikoko 工作台重新打开。")
      : h(
          React.Fragment,
          null,
          h(
            "p",
            null,
            "选择原来的 rikoko 会话。修改要求会带入输入框，由你发送；这里不会自动生成或扣费。",
          ),
          h(
            "label",
            null,
            "目标会话",
            h(
              "select",
              {
                "aria-label": "Hermes 目标会话",
                value: selected,
                onChange: (e) => setSelected(e.target.value),
                style: { display: "block", width: "100%", margin: "12px 0" },
              },
              h("option", { value: "" }, "请选择原会话"),
              ...sessions.map((s) =>
                h(
                  "option",
                  { key: s.id, value: s.id },
                  `${s.title || "未命名会话"} · ${s.id}`,
                ),
              ),
            ),
          ),
          h(
            "button",
            {
              disabled: !selected || working,
              onClick: () => void continueInSession(),
            },
            working ? "正在打开…" : "在所选会话中继续",
          ),
          h(
            "p",
            null,
            "无法打开时，可复制以下指令到原会话。请确保该会话连接了同一个 rikoko 工作空间。",
          ),
          h("textarea", {
            "aria-label": "继续指令",
            readOnly: true,
            value: handoffPrompt(context),
            rows: 8,
            style: { width: "100%" },
          }),
          message && h("p", { role: "status" }, message),
        ),
  );
}
export default {
  id: "rikoko-workspace",
  name: "rikoko 工作台联动",
  register(ctx) {
    ctx.register({
      id: "handoff",
      area: ROUTES_AREA,
      data: { path: "/rikoko-handoff" },
      render: () => h(HandoffPage),
    });
  },
};
