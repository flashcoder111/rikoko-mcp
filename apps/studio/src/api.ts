import type {
  Composition,
  Entity,
} from "../../../packages/contracts/src/index.js";
export type GenerationModel = {
  id: string;
  name: string;
  description: string;
  kind: "image" | "video" | "audio";
  category?: "speech" | "music" | "sound";
  maxCostCents: number;
  available: boolean;
  requiresVoiceProfile?: boolean;
  generationInput?: { mode: string };
  fixedParameters?: Record<string, string | number | boolean>;
};
export type Capabilities = {
  workspace: { conversationPlanner: string };
  providers: GenerationModel[];
  generation: {
    mode: "official" | "custom";
    billingSource: "credits" | "external" | "testing";
    error: string | null;
  };
};
export type Revision = Entity & {
  projectId: string;
  composition: Composition;
  version?: number;
};
export type Job = Entity & {
  revisionId: string;
  status: string;
  outputs: string[];
  steps: { id: string; state: string }[];
  error?: { message: string };
};
export type Message = {
  id: string;
  text: string;
  summary: string;
  origin: string;
  revisionId: string;
  jobId: string;
  version: number;
  createdAt: string;
};
export type Snapshot = {
  project: Entity;
  revision: Revision | null;
  headRevisionId: string | null;
  revisions: Revision[];
  jobs: Job[];
  messages: Message[];
  links: { workspace: string; conversation: string };
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  name: string,
  input: unknown = {},
): Promise<T> {
  const response = await fetch(`/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "Request failed. Please try again.",
    );
  }
  return body.result;
}
export const statusLabels: Record<string, string> = {
  queued: "Queued",
  running: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked_external: "Setup required",
  submission_unknown: "Needs review",
};
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} sec`;
export const duration = (revision?: Revision | null) =>
  revision?.composition.scenes.reduce((n, scene) => n + scene.durationMs, 0) ??
  0;
export const latestJob = (jobs: Job[], revisionId?: string) =>
  jobs.find((j) => j.revisionId === revisionId);
