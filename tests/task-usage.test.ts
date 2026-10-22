import { expect, it } from "vitest";
import {
  summarizeTaskUsage,
  usageText,
} from "../packages/core/src/task-usage.js";
import { resultText } from "../packages/mcp/src/presentation.js";
const job = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  type: "job",
  accountId: "owner",
  createdAt: "2026-10-22",
  input: { kind: "generate" },
  status: "completed",
  billingSource: "credits",
  billingStatus: "confirmed",
  chargedCents: 20,
  ...fields,
});

it("includes charged failed jobs but never reservations or supplier costs as customer spend", () => {
  const usage = summarizeTaskUsage([
    job("image", { chargedCredits: 12 }),
    job("failed", { status: "failed", chargedCredits: 3, chargedCents: 5 }),
    job("waiting", {
      billingStatus: "pending_reconciliation",
      chargedCents: null,
      reservedCents: 200,
      providerActualCostCents: 99,
    }),
    job("image", { chargedCredits: 12 }),
  ]);
  expect(usage.jobCount).toBe(3);
  expect(usage.totals[0]).toMatchObject({
    chargedCredits: 15,
    chargedCents: 25,
    pendingJobCount: 1,
    creditsComplete: false,
  });
  expect(usageText(usage)).toContain("待结算");
});
it("never converts cents to credits or blends external and testing charges", () => {
  const usage = summarizeTaskUsage([
    job("official"),
    job("external", { billingSource: "external", chargedCents: 40 }),
    job("test", { billingSource: "testing", chargedCents: 0 }),
  ]);
  expect(usage.totals.map((t) => t.chargedCredits)).toEqual([null, null, null]);
  expect(usageText(usage)).toContain("USD 0.20");
  expect(usageText(usage)).toContain("服务未返回积分数");
  expect(usageText(usage)).toContain("自有供应商");
});
it("does not turn a free render into the total production charge", () => {
  const usage = summarizeTaskUsage([
    job("render", { input: { kind: "render" }, chargedCents: 0 }),
  ]);
  const text = resultText({
    jobId: "render",
    status: "completed",
    purpose: "final",
    usage,
  });
  expect(text).toContain("listed jobs only");
  expect(text).toContain("ALL task job IDs");
});
it("deduplicates remote mirrors and treats missing settlement as unknown", () => {
  const usage = summarizeTaskUsage([
    job("local-a", { cloudOrigin: "https://example.com", remoteJobId: "same" }),
    job("local-b", { cloudOrigin: "https://example.com", remoteJobId: "same" }),
    job("unknown", { billingStatus: undefined, chargedCents: undefined }),
  ]);
  expect(usage.jobCount).toBe(2);
  expect(usage.totals[0]).toMatchObject({
    chargedCents: 20,
    pendingJobCount: 1,
  });
});

it("shows monetary-only charges alongside partial credits instead of losing them", () => {
  const usage = summarizeTaskUsage([
    job("credits", { chargedCredits: 8 }),
    job("money", { chargedCents: 55 }),
  ]);
  expect(usageText(usage)).toContain("8 积分");
  expect(usageText(usage)).toContain("USD 0.55");
  expect(usageText(usage)).toContain("未换算积分");
});
