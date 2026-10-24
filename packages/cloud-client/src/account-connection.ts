import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson } from "../../bootstrap/src/config.js";
import { AppError, type Context } from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import { cloudOrigin, cloudRequest } from "./http.js";
import { credentialEnvelope } from "./credential-envelope.js";

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const tokens = z.object({
  access_token: z.string().regex(/^rikoko_[A-Za-z0-9_-]{43}$/),
  refresh_token: opaque,
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(900),
  connection_id: z.string().uuid(),
  account_id: z.string().uuid(),
  connection_expires_at: z.string().datetime(),
});
const stored = tokens.omit({ expires_in: true }).extend({
  expiresAt: z.number(),
  apiOrigin: z.string().transform(cloudOrigin),
});
type Credential = z.infer<typeof stored>;
type Active = { apiOrigin: string; id: string; token: () => Promise<string> };
type Pending = {
  state: string;
  verifier: string;
  redirect: string;
  apiOrigin: string;
  url: string;
  server: Server;
  timer: NodeJS.Timeout;
};
const controllers = new WeakMap<Service, AccountConnection>();
export const accountConnection = (service: Service) => controllers.get(service);
const required = () =>
  new AppError(
    "ACCOUNT_CONNECTION_REQUIRED",
    "Connect your rikoko account again",
    401,
  );

export class AccountConnection {
  private credential?: Credential;
  private pending?: Pending;
  private refreshing?: Promise<string>;
  private busy = false;
  private lastStatus = "disconnected";
  private file: string;
  constructor(
    private options: {
      directory: string;
      website: string;
      activate: (value: Active) => void;
      fetcher?: typeof fetch;
      openBrowser?: (url: string) => Promise<boolean>;
    },
  ) {
    cloudOrigin(options.website);
    this.file = join(options.directory, "account-connection.json");
  }
  async restore() {
    try {
      const value: any = await credentialEnvelope(
        await readPrivateJson(this.file),
        true,
      );
      if (value.disconnected === true) {
        const apiOrigin = cloudOrigin(value.apiOrigin);
        this.options.activate({
          apiOrigin,
          id: "disconnected",
          token: async () => {
            throw required();
          },
        });
        return;
      }
      this.credential = stored.parse(value);
      this.activate();
      this.lastStatus = "connected";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private activate() {
    const value = this.credential!;
    this.options.activate({
      apiOrigin: value.apiOrigin,
      id: value.connection_id,
      token: () => this.token(),
    });
  }
  private async save(value: unknown) {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.options.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("Account credential directory must be private (0700)");
    const temporary = `${this.file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify(await credentialEnvelope(value)) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async start() {
    if (this.credential)
      throw new AppError(
        "ACCOUNT_ALREADY_CONNECTED",
        "Disconnect the current account before connecting another",
        409,
      );
    if (this.busy)
      throw new AppError("CONNECTION_BUSY", "Connection is in progress", 409);
    if (this.pending)
      return {
        status: "awaiting_authorization",
        authorizationUrl: this.pending.url,
      };
    this.busy = true;
    try {
      const website = cloudOrigin(this.options.website);
      const { data } = await cloudRequest(
        website,
        "/account-connection.json",
        this.options.fetcher ?? fetch,
      );
      const discovery = z
        .object({
          version: z.literal(1),
          clientId: z.literal("rikoko-mcp"),
          apiOrigin: z.string().transform(cloudOrigin),
        })
        .parse(data);
      const state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(32).toString("base64url");
      const server = createServer((req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'",
        );
        const p = this.pending;
        let url: URL;
        try {
          if ((req.url?.length ?? 0) > 2048) throw Error("Callback too long");
          url = new URL(req.url ?? "/", "http://127.0.0.1");
        } catch {
          res.writeHead(400).end("Invalid callback.");
          return;
        }
        if (
          !p ||
          req.method !== "GET" ||
          req.headers.host !== new URL(p.redirect).host ||
          url.pathname !== "/callback" ||
          url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.get("state") !== p.state
        ) {
          res.writeHead(400).end("Invalid authorization callback.");
          return;
        }
        if (this.busy) {
          res.writeHead(409).end("Connection is in progress.");
          return;
        }
        if (url.searchParams.get("error") === "access_denied") {
          this.cancel("denied");
          res.end("Connection cancelled. Return to your agent.");
          return;
        }
        const code = url.searchParams.get("code");
        if (
          url.searchParams.getAll("code").length !== 1 ||
          !opaque.safeParse(code).success ||
          this.busy
        ) {
          res.writeHead(400).end("Invalid authorization code.");
          return;
        }
        this.busy = true;
        void this.complete(code!, p)
          .then(() => {
            res.end(
              "rikoko connected. Return to your agent; your account credits are ready.",
            );
          })
          .catch(() => {
            this.lastStatus = "failed";
            res
              .writeHead(400)
              .end(
                "Connection failed. Return to your agent and connect again.",
              );
          })
          .finally(() => {
            this.busy = false;
            this.cancel(this.lastStatus);
          });
      });
      server.requestTimeout = 10000;
      server.headersTimeout = 10000;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const url = new URL("/dashboard/", website);
      url.search = new URLSearchParams({
        pane: "keys",
        connect: "1",
        client_id: "rikoko-mcp",
        response_type: "code",
        redirect_uri: redirect,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        state,
      }).toString();
      const timer = setTimeout(() => {
        if (!this.busy) this.cancel("expired");
      }, 5 * 60000);
      timer.unref();
      server.unref();
      this.pending = {
        state,
        verifier,
        redirect,
        apiOrigin: discovery.apiOrigin,
        url: url.href,
        server,
        timer,
      };
      this.lastStatus = "awaiting_authorization";
      this.busy = false;
      const browserOpened = await (this.options.openBrowser ?? openBrowser)(
        url.href,
      ).catch(() => false);
      return {
        status: this.lastStatus,
        authorizationUrl: url.href,
        browserOpened,
        instructions:
          "Open this URL on this computer and authorize your signed-in rikoko account. Then call account_connection_status. No API key or paid generation is needed.",
      };
    } finally {
      if (!this.pending) this.busy = false;
    }
  }
  private async complete(code: string, pending: Pending) {
    const { data } = await cloudRequest(
      pending.apiOrigin,
      "/oauth/token",
      this.options.fetcher ?? fetch,
      {
        body: {
          grant_type: "authorization_code",
          client_id: "rikoko-mcp",
          code,
          code_verifier: pending.verifier,
          redirect_uri: pending.redirect,
        },
      },
    );
    const response = tokens.parse(data);
    const credential = {
      ...response,
      apiOrigin: pending.apiOrigin,
      expiresAt: Date.now() + response.expires_in * 1000,
    };
    try {
      if (this.pending !== pending) throw required();
      await this.save(credential);
    } catch (error) {
      await cloudRequest(
        pending.apiOrigin,
        "/oauth/revoke",
        this.options.fetcher ?? fetch,
        {
          body: {
            client_id: "rikoko-mcp",
            token: response.refresh_token,
          },
        },
      ).catch(() => {});
      throw error;
    }
    this.credential = credential;
    this.activate();
    this.lastStatus = "connected";
  }
  private async token(): Promise<string> {
    if (this.busy && !this.pending) throw required();
    if (!this.credential) throw required();
    if (this.credential.expiresAt > Date.now() + 60000)
      return this.credential.access_token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async refresh() {
    const previous = this.credential!;
    try {
      const { data } = await cloudRequest(
        previous.apiOrigin,
        "/oauth/token",
        this.options.fetcher ?? fetch,
        {
          body: {
            grant_type: "refresh_token",
            client_id: "rikoko-mcp",
            refresh_token: previous.refresh_token,
          },
        },
      );
      const response = tokens.parse(data);
      if (
        response.account_id !== previous.account_id ||
        response.connection_id !== previous.connection_id
      )
        throw required();
      const next = {
        ...response,
        apiOrigin: previous.apiOrigin,
        expiresAt: Date.now() + response.expires_in * 1000,
      };
      await this.save(next);
      this.credential = next;
      return next.access_token;
    } catch {
      this.lastStatus = "reconnect_required";
      throw required();
    }
  }
  async status() {
    if (!this.credential) return { status: this.lastStatus };
    try {
      const { data } = await cloudRequest(
        this.credential.apiOrigin,
        "/v1/usage",
        this.options.fetcher ?? fetch,
        { key: await this.token() },
      );
      this.lastStatus = "connected";
      return {
        status: "connected",
        accountId: this.credential.account_id,
        connectionId: this.credential.connection_id,
        availableCredits: data.availableCredits,
        expiresAt: this.credential.connection_expires_at,
      };
    } catch {
      return { status: "reconnect_required" };
    }
  }
  async disconnect() {
    if (this.busy)
      throw new AppError("CONNECTION_BUSY", "Connection is in progress", 409);
    this.busy = true;
    try {
      await this.refreshing?.catch(() => {});
      const value = this.credential;
      if (value) {
        // Keep the credential if offline, so a retry can actually revoke the connection.
        await cloudRequest(
          value.apiOrigin,
          "/oauth/revoke",
          this.options.fetcher ?? fetch,
          {
            body: {
              client_id: "rikoko-mcp",
              token: value.refresh_token,
            },
          },
        );
        await this.save({ disconnected: true, apiOrigin: value.apiOrigin });
        this.credential = undefined;
        this.options.activate({
          apiOrigin: value.apiOrigin,
          id: "disconnected",
          token: async () => {
            throw required();
          },
        });
      }
      this.cancel("disconnected");
      return { status: "disconnected" };
    } finally {
      this.busy = false;
    }
  }
  private cancel(status: string) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.server.close();
      this.pending = undefined;
    }
    this.lastStatus = status;
  }
  close() {
    this.cancel(this.lastStatus);
  }
}

async function openBrowser(url: string): Promise<boolean> {
  // No shell interpolation. Windows/headless hosts receive the clickable URL.
  if (process.platform === "win32") return false;
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "darwin" ? "open" : "xdg-open",
      [url],
      { stdio: "ignore" },
    );
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 3000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  });
}

export function registerAccountConnection(
  service: Service,
  connection: AccountConnection,
) {
  controllers.set(service, connection);
}
export async function requireLocalConnection(service: Service, c: Context) {
  await service.scoped(c, "write", async () => {});
  const controller = accountConnection(service);
  if (!service.localVideoDownloads || !controller)
    throw new AppError(
      "LOCAL_CONNECTION_ONLY",
      "Account connection requires the local rikoko runtime",
      403,
    );
  // A local installation has one owner; keys of another local account cannot switch its wallet.
  const owner = await service.db.transaction(
    async (tx) =>
      (
        await tx.query(
          "SELECT account_id AS id FROM api_keys ORDER BY created_at,id LIMIT 1",
        )
      ).rows[0],
  );
  if (owner?.id !== c.accountId)
    throw new AppError(
      "FORBIDDEN",
      "Only the local workspace owner can connect",
      403,
    );
  return controller;
}
