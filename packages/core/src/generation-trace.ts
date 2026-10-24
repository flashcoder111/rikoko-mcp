import { randomUUID } from "node:crypto";
import { AppError, type Context } from "../../contracts/src/index.js";
import type { Service } from "./index.js";
import { fingerprint } from "./index.js";

/** Persist failure evidence after the failed transaction has rolled back. No URLs/tickets/credentials. */
export async function tracedPreparation<T>(
  service: Service,
  c: Context,
  raw: any,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      error.status === 401 ||
      error.status === 403
    )
      throw error;
    const traceId = randomUUID();
    await service.scoped(c, "write", (tx) =>
      tx.put({
        id: traceId,
        type: "generation-trace",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        outcome: "rejected",
        stage:
          error.details?.stage ??
          (/ANALYSIS|REMAKE_SOURCE|REMAKE_COVERAGE/.test(error.code)
            ? "analysis"
            : /REFERENCE|MEDIA/.test(error.code)
              ? "reference_delivery"
              : /PLAN|SHOT|REMAKE/.test(error.code)
                ? "planning"
                : /PROMPT/.test(error.code)
                  ? "prompt"
                  : /MODEL|CAPABILITY/.test(error.code)
                    ? "model_selection"
                    : "preparation"),
        code: error.code,
        upstreamTraceId: error.details?.generationTraceId,
        attempt: {
          request: raw?.request,
          plan: raw?.plan,
          model: raw?.input?.model,
          mode: raw?.input?.mode,
          prompt: raw?.input?.prompt,
          direction: raw?.direction,
          references: raw?.input?.references ?? [],
        },
      }),
    );
    error.details = {
      ...error.details,
      recordId: error.details?.recordId ?? traceId,
      generationTraceId: traceId,
    };
    throw error;
  }
}

export async function generationTraceGet(
  service: Service,
  c: Context,
  id: string,
) {
  return service.scoped(c, "read", async (tx) => {
    const failed = await tx.get(id, c.accountId, "generation-trace");
    if (failed)
      return {
        traceId: failed.id,
        outcome: failed.outcome,
        stage: failed.stage,
        code: failed.code,
        upstreamTraceId: failed.upstreamTraceId ?? null,
        attempt: failed.attempt,
        createdAt: failed.createdAt,
      };
    const job = await tx.get(id, c.accountId, "job");
    const saved = await tx.get(
      job?.preparedRequestId ?? id,
      c.accountId,
      "generation-preparation",
    );
    const prepared =
      saved ??
      (job?.input?.kind === "generate"
        ? {
            id: job.id,
            createdAt: job.createdAt,
            input: job.input,
            providerRequest: {
              prompt: job.input.prompt,
              parameters: job.input.parameters,
              referenceBindings: [],
            },
            prompt: { text: job.input.prompt },
            references: job.input.references ?? [],
            workflow: null,
            referenceState: "historical_unverified",
            requestHash: null,
          }
        : null);
    if (!prepared)
      throw new AppError("NOT_FOUND", "Generation trace not found", 404);
    const jobs = job
      ? [job]
      : (await tx.list(c.accountId, "job")).filter(
          (j) => j.preparedRequestId === prepared.id,
        );
    const workflow = prepared.workflow;
    const reports = workflow?.analysis
      ? [
          workflow.analysis.report,
          ...(workflow.analysis.binding.componentReports ?? []),
        ]
      : [];
    const analysisJobs = [];
    for (const report of reports) {
      if (report.provenance.evidence === "provider-live-assembled") continue;
      const origin =
        (await tx.get(report.provenance.jobId, c.accountId, "job")) ??
        (await tx.list(c.accountId, "job")).find(
          (j) => j.remoteJobId === report.provenance.jobId,
        );
      analysisJobs.push({
        jobId: report.provenance.jobId,
        input: origin?.input ?? null,
        rawReport: origin?.analysisRawReport ?? null,
        normalizedReport: report,
      });
    }
    return {
      traceId: prepared.id,
      protocol: workflow?.protocol ?? "legacy-unbound",
      createdAt: prepared.createdAt,
      evidenceComplete: !!workflow,
      stages: {
        request: workflow?.request ?? null,
        analysis: workflow?.analysis
          ? { ...workflow.analysis, providerJobs: analysisJobs }
          : null,
        planning: workflow?.plan ?? null,
        prompt: prepared.prompt,
        delivery: {
          state: prepared.referenceState,
          model: prepared.input.model,
          mode: prepared.input.mode,
          parameters: prepared.providerRequest.parameters,
          references: (prepared.references ?? []).map((r: any, i: number) => ({
            assetId: r.assetId,
            kind: r.kind,
            role: r.role,
            sha256: r.sha256,
            field: prepared.providerRequest.referenceBindings[i]?.field,
            index: prepared.providerRequest.referenceBindings[i]?.index,
          })),
          providerPrompt: prepared.providerRequest.prompt,
        },
        execution: jobs.map((j) => ({
          jobId: j.id,
          status: j.status,
          phase: j.phase,
          createdAt: j.createdAt,
          finishedAt: j.finishedAt,
          outputs: j.outputs ?? [],
          errorCode: j.error?.code ?? null,
          preflight: j.referenceDeliveryEvidence ?? null,
        })),
      },
      checks: {
        compiledPromptMatchesSubmission:
          prepared.prompt.text === prepared.providerRequest.prompt,
        requestHash: prepared.requestHash,
        workflowHash: workflow ? fingerprint(workflow) : null,
      },
      interpretation:
        "Snapshots identify where wording, shot structure and media bindings changed. A completed job proves execution, not semantic or visual fidelity. Missing historical evidence is reported as missing, never reconstructed.",
    };
  });
}
