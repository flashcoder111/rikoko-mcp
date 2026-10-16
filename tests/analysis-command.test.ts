import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  analysisCommand,
  parseAnalysisSetting,
} from "../packages/core/src/analysis-commands.js";
import { resolveAnalysisDetail } from "../packages/mcp/src/reference-settings.js";
let db: Database, dir: string;
afterEach(async () => {
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("accepts English and Chinese precision commands and rejects ambiguous options", () => {
  expect(analysisCommand.usage).toContain("/analysis");
  for (const [input, expected] of [
    ["概览", "overview"],
    ["逐镜头", "shots"],
    ["复刻", "recreate"],
    ["自动", "auto"],
    [" RECREATE ", "recreate"],
  ])
    expect(parseAnalysisSetting(input)).toBe(expected);
  expect(parseAnalysisSetting("")).toBeUndefined();
  expect(() => parseAnalysisSetting("high")).toThrow(/overview/);
});
it("persists account defaults without jobs, supports reset and keeps explicit requests first", async () => {
  dir = await mkdtemp(join(tmpdir(), "analysis-command-"));
  db = await Database.open();
  const service = new Service(db, new LocalStorage(dir));
  const c = await service.authenticate(
    (await service.createAccount("test", 0)).key,
  );
  const settings = (input = {}) =>
    callTool(service, c, "reference_analysis_settings", input);
  expect(await settings()).toMatchObject({
    detail: "auto",
    scope: "account",
    submitted: false,
  });
  expect(await resolveAnalysisDetail(service, c, { purpose: "inspect" })).toBe(
    "shots",
  );
  expect(await resolveAnalysisDetail(service, c, { purpose: "remake" })).toBe(
    "recreate",
  );
  await settings({ detail: "overview" });
  expect(await settings()).toMatchObject({ detail: "overview" });
  const resumed = new Service(db, new LocalStorage(dir));
  expect(await resolveAnalysisDetail(resumed, c, { purpose: "remake" })).toBe(
    "overview",
  );
  expect(
    await resolveAnalysisDetail(service, c, {
      purpose: "remake",
      detail: "recreate",
    }),
  ).toBe("recreate");
  const other = await service.authenticate(
    (await service.createAccount("other", 0)).key,
  );
  expect(
    await callTool(service, other, "reference_analysis_settings", {}),
  ).toMatchObject({ detail: "auto" });
  const readOnly = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "read",
        scopes: ["read"],
        budgetCents: 0,
      })
    ).key,
  );
  expect(
    await callTool(service, readOnly, "reference_analysis_settings", {}),
  ).toMatchObject({ detail: "overview" });
  await expect(
    callTool(service, readOnly, "reference_analysis_settings", {
      detail: "shots",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(settings({ detail: "high" })).rejects.toThrow();
  expect(await settings()).toMatchObject({ detail: "overview" });
  await settings({ detail: "auto" });
  expect(await resolveAnalysisDetail(service, c, { purpose: "remake" })).toBe(
    "recreate",
  );
  expect(await service.list(c, "job")).toHaveLength(0);
  expect(await service.list(c, "quote")).toHaveLength(0);
  const caps = await callTool(service, c, "capabilities", {});
  expect(caps.commands.agentEntry).toBe("/rikoko");
  expect(caps.commands.items).toContainEqual(analysisCommand);
});
