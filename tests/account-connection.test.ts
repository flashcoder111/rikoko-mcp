import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AccountConnection } from "../packages/cloud-client/src/account-connection.js";

let dir: string, controllers: AccountConnection[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-account-"));
  controllers = [];
});
afterEach(async () => {
  for (const c of controllers) c.close();
  await rm(dir, { recursive: true, force: true });
});
function fixture(expires = 900) {
  let refreshes = 0,
    revoked = false;
  const connectionId = randomUUID(),
    accountId = randomUUID();
  const activation = vi.fn();
  const token = () => ({
    access_token: `rikoko_${"a".repeat(43)}`,
    refresh_token: "b".repeat(43),
    token_type: "Bearer",
    expires_in: expires,
    connection_id: connectionId,
    account_id: accountId,
    connection_expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
  });
  const fetcher = vi.fn(async (url: any, options: any) => {
    const u = new URL(url);
    if (u.pathname === "/account-connection.json")
      return Response.json({
        version: 1,
        clientId: "rikoko-mcp",
        apiOrigin: "https://api.example",
      });
    if (u.origin !== "https://api.example")
      throw Error("Unexpected credential destination");
    if (u.pathname === "/oauth/token") {
      const body = JSON.parse(options.body);
      if (body.grant_type === "refresh_token") refreshes++;
      if (revoked)
        return Response.json(
          { error: { code: "INVALID_GRANT" } },
          { status: 401 },
        );
      return Response.json(token());
    }
    if (u.pathname === "/oauth/revoke") {
      revoked = true;
      return Response.json({ revoked: true });
    }
    if (u.pathname === "/v1/usage") {
      if (revoked)
        return Response.json(
          { error: { code: "UNAUTHORIZED" } },
          { status: 401 },
        );
      return Response.json({ accountId, availableCredits: 1000 });
    }
    throw Error("Unexpected request");
  }) as unknown as typeof fetch;
  const make = () => {
    const c = new AccountConnection({
      directory: join(dir, "credentials"),
      website: "https://rikoko.example",
      activate: activation,
      fetcher,
      openBrowser: async () => false,
    });
    controllers.push(c);
    return c;
  };
  return {
    make,
    activation,
    fetcher,
    accountId,
    connectionId,
    refreshes: () => refreshes,
  };
}
async function callback(
  controller: AccountConnection,
  overrides: Record<string, string> = {},
) {
  const start = await controller.start();
  const auth = new URL(start.authorizationUrl);
  const url = new URL(auth.searchParams.get("redirect_uri")!);
  url.searchParams.set("state", auth.searchParams.get("state")!);
  url.searchParams.set("code", "c".repeat(43));
  for (const [key, value] of Object.entries(overrides))
    url.searchParams.set(key, value);
  return fetch(url);
}

it("opens a PKCE flow, saves private credentials, restores and reads real shared credits without returning secrets", async () => {
  const f = fixture(),
    c = f.make();
  const start = await c.start();
  expect(start.browserOpened).toBe(false);
  expect(start.authorizationUrl).toContain("code_challenge_method=S256");
  expect((await c.status()).status).toBe("awaiting_authorization");
  const response = await callback(c);
  expect(response.status).toBe(200);
  await response.text();
  const status = await c.status();
  expect(status).toMatchObject({
    status: "connected",
    availableCredits: 1000,
    accountId: f.accountId,
  });
  expect(JSON.stringify(status)).not.toMatch(
    /rikoko_a|refresh_token|access_token/,
  );
  const file = join(dir, "credentials/account-connection.json");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(join(dir, "credentials"))).mode & 0o777).toBe(0o700);
  expect(JSON.parse(await readFile(file, "utf8")).apiOrigin).toBe(
    "https://api.example",
  );
  const restored = f.make();
  await restored.restore();
  expect(await restored.status()).toMatchObject({
    status: "connected",
    accountId: f.accountId,
  });
  expect(f.activation.mock.calls.at(-1)![0].id).toBe(f.connectionId);
  await expect(c.start()).rejects.toMatchObject({
    code: "ACCOUNT_ALREADY_CONNECTED",
  });
});
it("rejects forged callbacks and handles cancellation without issuing credentials", async () => {
  const f = fixture(),
    c = f.make();
  const forged = await callback(c, { state: "x".repeat(43) });
  expect(forged.status).toBe(400);
  await forged.text();
  expect((await c.status()).status).toBe("awaiting_authorization");
  const denied = await callback(c, { error: "access_denied" });
  await denied.text();
  expect((await c.status()).status).toBe("denied");
  expect(f.activation).not.toHaveBeenCalled();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it("refreshes once for concurrent requests with a stable connection identity, then revokes and persists disconnection", async () => {
  const f = fixture(1),
    c = f.make();
  await (await callback(c)).text();
  const statuses = await Promise.all([c.status(), c.status(), c.status()]);
  expect(statuses.every((v) => v.status === "connected")).toBe(true);
  expect(f.refreshes()).toBe(1);
  await c.disconnect();
  expect((await c.status()).status).toBe("disconnected");
  expect(
    await readFile(join(dir, "credentials/account-connection.json"), "utf8"),
  ).not.toContain("access_token");
  const restored = f.make();
  await restored.restore();
  await expect(
    f.activation.mock.calls.at(-1)![0].token(),
  ).rejects.toMatchObject({ code: "ACCOUNT_CONNECTION_REQUIRED" });
});
it("fails closed on credential permission changes and symlinks", async () => {
  const f = fixture(),
    c = f.make();
  await (await callback(c)).text();
  const file = join(dir, "credentials/account-connection.json");
  await chmod(file, 0o644);
  await expect(f.make().restore()).rejects.toThrow("private");
  await chmod(file, 0o600);
  const backup = join(dir, "backup.json");
  const { rename } = await import("node:fs/promises");
  await rename(file, backup);
  await symlink(backup, file);
  await expect(f.make().restore()).rejects.toThrow();
});

it("binds cloud credentials to the local owner across all gateway operations", async () => {
  const { GatewayClient } =
    await import("../packages/cloud-client/src/gateway.js");
  const { Database } = await import("../packages/db/src/index.js");
  const { Service } = await import("../packages/core/src/index.js");
  const { LocalStorage } = await import("../packages/storage/src/index.js");
  const { FalProvider } = await import("../packages/providers/src/index.js");
  const db = await Database.open();
  try {
    const service = new Service(
      db,
      new LocalStorage(dir),
      new FalProvider([], undefined, false),
    );
    const first = await service.createAccount("owner", 0),
      second = await service.createAccount("other", 0);
    const owner = await service.authenticate(first.key),
      other = await service.authenticate(second.key);
    const fetcher = vi.fn(async () =>
      Response.json({ availableCredits: 1000 }),
    ) as unknown as typeof fetch;
    const gateway = new GatewayClient(
      service,
      "https://api.example",
      {
        id: randomUUID(),
        ownerAccountId: owner.accountId,
        token: async () => "fixture-token",
      },
      fetcher,
    );
    expect(await gateway.usage(owner)).toEqual({ availableCredits: 1000 });
    const calls = [
      () => gateway.usage(other),
      () => gateway.models(other),
      () => gateway.get(other, "job"),
      () => gateway.quote(other, {}),
      () => gateway.submit(other, { input: {}, idempotencyKey: "fixture" }),
      () => gateway.action(other, "job", "cancel"),
      () => gateway.prepare(other, {}),
      () => gateway.preparationSupported(other),
    ];
    for (const invoke of calls)
      await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await db.close();
  }
});
