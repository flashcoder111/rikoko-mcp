import type { Entity } from "../../../packages/contracts/src/index.js";
import { api, type Capabilities } from "./api";

export type DashboardData = {
  projects: Entity[];
  assets: Entity[];
  jobs: Entity[];
  revisions: Entity[];
  capabilities: Capabilities;
};
export const activeStatuses = new Set(["queued", "running"]);
export const attentionStatuses = new Set([
  "failed",
  "blocked_external",
  "submission_unknown",
]);
export const newestFirst = (items: Entity[]) =>
  [...items].sort((a, b) =>
    String(b.updatedAt ?? b.createdAt).localeCompare(
      String(a.updatedAt ?? a.createdAt),
    ),
  );
export function jobProjectId(
  job: Entity,
  revisions: Entity[],
): string | undefined {
  return (
    job.input?.production?.projectId ??
    revisions.find(
      (revision) => revision.id === (job.revisionId ?? job.input?.revisionId),
    )?.projectId
  );
}
export function outputAssets(data: DashboardData): Entity[] {
  const ids = new Set(data.jobs.flatMap((job) => job.outputs ?? []));
  return newestFirst(
    data.assets.filter(
      (asset) =>
        ids.has(asset.id) && ["video", "image", "audio"].includes(asset.kind),
    ),
  );
}
export async function loadDashboard(): Promise<DashboardData> {
  const [projects, assets, jobs, revisions, capabilities] = await Promise.all([
    api<Entity[]>("records_list", { type: "project" }),
    api<Entity[]>("records_list", { type: "asset" }),
    api<Entity[]>("records_list", { type: "job" }),
    api<Entity[]>("records_list", { type: "revision" }),
    api<Capabilities>("capabilities"),
  ]);
  return {
    projects: newestFirst(projects),
    assets,
    jobs: newestFirst(jobs),
    revisions,
    capabilities,
  };
}
