import { builtinPrompts } from "./builtin-prompts.js";
import type { Context } from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { starterTemplates, type LibraryTemplate } from "./starters.js";
import { personalTemplates } from "./personal.js";
import type { PromptTemplate } from "./prompt-schema.js";
export type LibraryPrompt = PromptTemplate & {
  sourceKind: "builtin" | "cloud" | "personal";
  upstream?: LibraryTemplate["upstream"];
  updateAvailable?: LibraryTemplate["updateAvailable"];
};
export async function templateLibrary(service: Service, c: Context) {
  await service.scoped(c, "read", async () => {});
  const client = cloudConnection(service)?.templates;
  const snapshot = client
    ? await client.list(c)
    : {
        templates: [],
        promptTemplates: [],
        syncedAt: null,
        source: undefined,
        revision: 0,
      };
  const cloud: LibraryTemplate[] = snapshot.templates.map(
    (t: LibraryTemplate) => ({ ...t, sourceKind: "cloud" }),
  );
  const official = [
    ...starterTemplates.filter((t) => !cloud.some((x) => x.id === t.id)),
    ...cloud,
  ];
  const cloudPrompts: LibraryPrompt[] = (snapshot.promptTemplates ?? []).map(
    (t: PromptTemplate) => ({ ...t, sourceKind: "cloud" }),
  );
  const promptTemplates: LibraryPrompt[] = [
    ...builtinPrompts
      .filter((t) => !cloudPrompts.some((x) => x.id === t.id))
      .map((t) => ({ ...t, sourceKind: "builtin" as const })),
    ...cloudPrompts,
  ];
  const personal = (await personalTemplates(service, c)).map((r) => {
    const t = r.template;
    const upstream = t.upstream;
    const latest =
      upstream &&
      (t.kind === "prompt" ? promptTemplates : official).find(
        (x) => x.id === upstream.id,
      );
    const matchesSource =
      upstream &&
      (upstream.source === "builtin" || upstream.source === snapshot.source);
    return {
      ...t,
      ...(matchesSource && latest && latest.version > upstream.version
        ? {
            updateAvailable: {
              id: latest.id,
              version: latest.version,
              sourceKind: latest.sourceKind,
            },
          }
        : {}),
    };
  });
  return {
    schemaVersion: 1,
    revision: snapshot.revision ?? 0,
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    configured: !!client,
    templates: [
      ...official,
      ...personal.filter((t) => t.kind !== "prompt"),
    ] as LibraryTemplate[],
    promptTemplates: [
      ...promptTemplates,
      ...personal.filter((t) => t.kind === "prompt"),
    ] as LibraryPrompt[],
  };
}
