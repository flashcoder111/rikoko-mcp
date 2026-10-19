import { Hono } from "hono";
import { captionFontBytes } from "../../../packages/render/src/fonts.js";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  originValidation,
} from "@modelcontextprotocol/hono";
import { ZodError } from "zod";
import {
  AppError,
  type Context,
} from "../../../packages/contracts/src/index.js";
import { Service } from "../../../packages/core/src/index.js";
import { publicServiceInfo } from "../../../packages/core/src/service-info.js";
import { publicBaseUrl } from "../../../packages/core/src/urls.js";
import { completeUpload } from "../../../packages/core/src/assets.js";
import {
  starterBytes,
  starterPreview,
} from "../../../packages/templates/src/local-library.js";
import {
  deliveryAsset,
  mediaResponse,
} from "../../../packages/core/src/delivery.js";
import { createMcpServer } from "../../../packages/mcp/src/index.js";
import {
  tools,
  callTool,
  type ToolName,
} from "../../../packages/mcp/src/tools.js";
export function createApp(
  service: Service,
  options: {
    allowedHosts?: string[];
    studioDir?: string;
    instanceId?: string;
  } = {},
) {
  const app = new Hono<{ Variables: { principal: Context } }>();
  const hosts = options.allowedHosts ?? ["localhost", "127.0.0.1", "[::1]"];
  app.use("*", hostHeaderValidation(hosts));
  app.use("*", originValidation(hosts));
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
    );
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof AppError)
      return c.json(
        { error: { code: e.code, message: e.message } },
        e.status as any,
      );
    if (e instanceof ZodError)
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: e.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("; "),
          },
        },
        400,
      );
    if (e instanceof SyntaxError)
      return c.json(
        { error: { code: "INVALID_JSON", message: "Malformed JSON" } },
        400,
      );
    console.error("Request failed", e.constructor.name);
    return c.json(
      { error: { code: "INTERNAL", message: "Request failed" } },
      500,
    );
  });
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      ...(options.instanceId
        ? { instanceId: options.instanceId, pid: process.pid }
        : {}),
    }),
  );
  app.get("/service-info", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await publicServiceInfo(service));
  });
  app.get("/fonts/:filename", async (c) => {
    const bytes = await captionFontBytes(c.req.param("filename"));
    if (!bytes) return c.notFound();
    c.header("Content-Type", "font/ttf");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(new Uint8Array(bytes));
  });
  const sessionName = "video_session";
  const browserOrigin = (url: string) =>
    new URL(process.env.PUBLIC_BASE_URL ? publicBaseUrl() : url).origin;
  const sameOrigin = (c: any) => {
    if (c.req.header("origin") !== browserOrigin(c.req.url))
      throw new AppError(
        "FORBIDDEN",
        "Same-origin browser request required",
        403,
      );
  };
  app.post("/auth/session", async (c) => {
    sameOrigin(c);
    const auth = c.req.header("authorization") ?? "";
    if (!auth.startsWith("Bearer "))
      throw new AppError("UNAUTHORIZED", "API key required", 401);
    const principal = await service.authenticate(auth.slice(7));
    const token = await service.browserSession(principal);
    const old = getCookie(c, sessionName);
    if (old) await service.revokeSession(old);
    setCookie(c, sessionName, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: browserOrigin(c.req.url).startsWith("https:"),
      path: "/",
      maxAge: 86400,
    });
    c.header("Cache-Control", "no-store");
    return c.json({ connected: true });
  });
  app.get("/auth/session", async (c) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(c, sessionName);
    if (!token) return c.json({ connected: false });
    await service.sessionPrincipal(token);
    return c.json({ connected: true });
  });
  app.delete("/auth/session", async (c) => {
    sameOrigin(c);
    const token = getCookie(c, sessionName);
    if (token) await service.revokeSession(token);
    deleteCookie(c, sessionName, { path: "/" });
    c.header("Cache-Control", "no-store");
    return c.json({ connected: false });
  });
  const auth = async (c: any, next: () => Promise<void>) => {
    const value = c.req.header("authorization") ?? "";
    if (value.startsWith("Bearer "))
      c.set("principal", await service.authenticate(value.slice(7)));
    else {
      const token = getCookie(c, sessionName);
      if (!token) throw new AppError("UNAUTHORIZED", "请先连接工作空间。", 401);
      if (!["GET", "HEAD"].includes(c.req.method)) sameOrigin(c);
      c.set("principal", await service.sessionPrincipal(token));
    }
    c.header("Cache-Control", "no-store");
    await next();
  };
  app.use("/api/*", auth);
  app.get("/api/starter-templates/:id/preview", async (c) => {
    await service.scoped(c.get("principal"), "read", async () => {});
    return mediaResponse(
      await starterPreview(c.req.param("id")),
      "video/mp4",
      "rikoko-template-preview.mp4",
      c.req.header("range"),
    );
  });
  app.get("/api/starter-assets/:id/file", async (c) => {
    await service.scoped(c.get("principal"), "read", async () => {});
    return mediaResponse(
      await starterBytes(c.req.param("id")),
      "image/png",
      "rikoko-illustration.png",
      c.req.header("range"),
    );
  });
  app.use("/mcp", auth);
  app.use("/mcp", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("/api/tools/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.post("/api/tools/:name", async (c) => {
    const name = c.req.param("name");
    if (!Object.hasOwn(tools, name))
      throw new AppError("NOT_FOUND", "Tool not found", 404);
    return c.json({
      result: await callTool(
        service,
        c.get("principal"),
        name as ToolName,
        await c.req.json(),
      ),
    });
  });
  app.all("/mcp", async (c) => {
    const principal = c.get("principal");
    const handler = createMcpHandler(
      () =>
        createMcpServer((name, input) =>
          callTool(service, principal, name, input),
        ),
      { maxRequestBodySize: 2 * 1024 * 1024 },
    );
    return handler.fetch(c.req.raw);
  });
  app.put(
    "/api/uploads/:id",
    bodyLimit({ maxSize: 100 * 1024 * 1024 }),
    async (c) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      return c.json({
        result: await completeUpload(
          service,
          c.get("principal"),
          c.req.param("id"),
          bytes,
        ),
      });
    },
  );
  app.get("/api/assets/:id/file", async (c) => {
    const asset = await service.get(
      c.get("principal"),
      "asset",
      c.req.param("id"),
    );
    return mediaResponse(
      await service.storage.read(asset.storageKey),
      asset.mime,
      `${asset.id}.${asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "wav" : asset.kind === "image" ? "png" : "txt"}`,
      c.req.header("range"),
    );
  });
  app.get("/delivery/:token/:assetId", async (c) => {
    const asset = await deliveryAsset(
      service,
      c.req.param("token"),
      c.req.param("assetId"),
    );
    return mediaResponse(
      await service.storage.read(asset.storageKey),
      asset.mime,
      asset.id,
      c.req.header("range"),
    );
  });
  app.get("/share", async (c) => {
    const token = c.req.header("X-Preview-Token");
    if (!token)
      throw new AppError("UNAUTHORIZED", "Preview token required", 401);
    const { revision, jobs } = await service.resolveShare(token);
    return c.json({ revision, jobs });
  });
  app.get("/share/assets/:id", async (c) => {
    const token = c.req.header("X-Preview-Token");
    if (!token)
      throw new AppError("UNAUTHORIZED", "Preview token required", 401);
    const view = await service.resolveShare(token);
    if (!view.jobs.some((j) => j.outputs.includes(c.req.param("id"))))
      throw new AppError("NOT_FOUND", "Asset not shared", 404);
    const asset = await service.db.transaction((tx) =>
      tx.get(c.req.param("id"), view.revision.accountId, "asset"),
    );
    if (!asset) throw new AppError("NOT_FOUND", "Asset missing", 404);
    return new Response(
      (await service.storage.read(asset.storageKey)) as BodyInit,
      { headers: { "Content-Type": asset.mime, "Cache-Control": "no-store" } },
    );
  });
  if (options.studioDir) {
    app.use("*", serveStatic({ root: options.studioDir }));
    app.get("*", serveStatic({ path: options.studioDir + "/index.html" }));
  }
  return app;
}
