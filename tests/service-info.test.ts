import { expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { Database } from "../packages/db/src/index.js";
import {
  loadPlans,
  plansSchema,
  publicServiceInfo,
  setServiceInfo,
} from "../packages/core/src/service-info.js";
import { createApp } from "../apps/server/src/app.js";
const plan = {
  id: "test-plan",
  name: "测试套餐",
  description: "测试数据",
  priceMinor: 100,
  currency: "USD",
  allowanceCents: 100,
  features: ["测试模型"],
  purchaseUrl: "https://checkout.example.com/test",
};
it("publishes only validated configured packages without inventing prices or exposing config", async () => {
  const db = await Database.open();
  const dir = await mkdtemp(join(tmpdir(), "plans-test-"));
  try {
    const service = new Service(db, new LocalStorage(dir));
    expect((await publicServiceInfo(service)).plans).toEqual([]);
    await writeFile(join(dir, "plans.json"), JSON.stringify({ plans: [plan] }));
    setServiceInfo(service, {
      mode: "official",
      plans: await loadPlans(join(dir, "plans.json")),
    });
    const r = await createApp(service).request(
      "http://localhost/service-info",
      { headers: { Host: "localhost" } },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      mode: "official",
      catalogStatus: "ready",
      plans: [plan],
    });
    for (const purchaseUrl of [
      "javascript:alert(1)",
      "http://checkout.example.com",
      "https://user:secret@example.com",
    ])
      expect(() =>
        plansSchema.parse({ plans: [{ ...plan, purchaseUrl }] }),
      ).toThrow();
    expect(() =>
      plansSchema.parse({ plans: [{ ...plan, apiKey: "secret" }] }),
    ).toThrow();
    expect(await loadPlans()).toEqual({ plans: [] });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it("shows upstream catalog failures explicitly without leaking raw service errors", async () => {
  const service = {} as Service;
  setServiceInfo(service, {
    mode: "official",
    plans: { plans: [] },
    officialOrigin: "https://api.example.com",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("private diagnostic");
    }),
  );
  try {
    expect(await publicServiceInfo(service)).toEqual({
      mode: "official",
      plans: [],
      catalogStatus: "unavailable",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ plans: [plan] })),
    );
    expect((await publicServiceInfo(service)).plans).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
