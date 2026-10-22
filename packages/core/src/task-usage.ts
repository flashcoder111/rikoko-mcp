import type { Context, Entity } from "../../contracts/src/index.js";
import type { Service } from "./index.js";

const amount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Actual customer charges only. Never convert cents to credits or treat reservations as spend. */
export function summarizeTaskUsage(jobs: Entity[]) {
  const unique = [
    ...new Map(
      jobs.map((job) => [
        job.remoteJobId ? `${job.cloudOrigin}:${job.remoteJobId}` : job.id,
        job,
      ]),
    ).values(),
  ];
  const items = unique.map((job) => {
    const source = ["credits", "external", "testing"].includes(
      job.billingSource,
    )
      ? (job.billingSource as "credits" | "external" | "testing")
      : ("unknown" as const);
    const chargedCredits =
      source === "credits" && amount(job.chargedCredits)
        ? job.chargedCredits
        : null;
    const chargedCents = amount(job.chargedCents) ? job.chargedCents : null;
    const settled =
      ["settled", "confirmed"].includes(job.billingStatus) &&
      (chargedCredits !== null || chargedCents !== null);
    return {
      jobId: job.id,
      operation: job.input?.kind ?? "unknown",
      status: job.status,
      billingSource: source,
      settlement: settled ? "settled" : "pending_or_unknown",
      chargedCredits,
      chargedCents,
      reservedCredits: amount(job.reservedCredits) ? job.reservedCredits : null,
      reservedCents: amount(job.reservedCents) ? job.reservedCents : null,
    };
  });
  const totals = [...new Set(items.map((item) => item.billingSource))].map(
    (source) => {
      const group = items.filter((item) => item.billingSource === source);
      const settled = group.filter((item) => item.settlement === "settled");
      return {
        billingSource: source,
        settledJobCount: settled.length,
        pendingJobCount: group.length - settled.length,
        chargedCredits: settled.some((item) => item.chargedCredits !== null)
          ? settled.reduce((sum, item) => sum + (item.chargedCredits ?? 0), 0)
          : null,
        chargedCents: settled.some((item) => item.chargedCents !== null)
          ? settled.reduce((sum, item) => sum + (item.chargedCents ?? 0), 0)
          : null,
        creditsComplete:
          settled.length === group.length &&
          settled.every((item) => item.chargedCredits !== null),
        centsComplete:
          settled.length === group.length &&
          settled.every((item) => item.chargedCents !== null),
        centsWithoutCredits: settled
          .filter(
            (item) =>
              item.chargedCredits === null && item.chargedCents !== null,
          )
          .reduce((sum, item) => sum + item.chargedCents!, 0),
        jobsWithoutCredits: settled.filter(
          (item) => item.chargedCredits === null,
        ).length,
      };
    },
  );
  return {
    scope: "listed_jobs_only" as const,
    jobCount: items.length,
    items,
    totals,
    instruction:
      "Report this usage to the user at completion, cancellation or failure. Include every job commissioned for this task (analysis, images, video, audio and authorized retries), once each. This is not the account-wide spend or automatically the entire project. Report chargedCredits when present; otherwise report actual USD charges and say the service has not returned a credit count. Keep pending settlement and reservations separate. External provider costs are not rikoko credits. Testing charges do not prove production prices. Do not wait for settlement to deliver or submit another job to obtain a bill.",
  };
}

export async function taskUsage(
  service: Service,
  c: Context,
  jobIds: string[],
) {
  const jobs = await Promise.all(
    [...new Set(jobIds)].map((id) => service.get(c, "job", id)),
  );
  return summarizeTaskUsage(jobs);
}
export type TaskUsage = ReturnType<typeof summarizeTaskUsage>;

export function usageText(usage: TaskUsage) {
  return usage.totals
    .map((total) => {
      const label =
        total.billingSource === "external"
          ? "自有供应商"
          : total.billingSource === "testing"
            ? "测试计费"
            : total.billingSource === "credits"
              ? "官方账户"
              : "计费来源未知";
      const cost =
        total.chargedCredits !== null
          ? `已扣 ${total.chargedCredits} 积分${total.creditsComplete ? "" : "（已返回积分的部分）"}${total.jobsWithoutCredits ? `；另有 ${total.jobsWithoutCredits} 项仅返回金额 USD ${(total.centsWithoutCredits / 100).toFixed(2)}，未换算积分` : ""}`
          : total.chargedCents !== null
            ? `已结算 USD ${(total.chargedCents / 100).toFixed(2)}${total.centsComplete ? "" : "（已返回金额的部分）"}；服务未返回积分数`
            : "实际扣费尚未返回";
      return `${label}：${cost}${total.pendingJobCount ? `；${total.pendingJobCount} 项待结算或状态未知` : ""}。`;
    })
    .join("\n");
}
