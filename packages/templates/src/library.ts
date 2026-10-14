import type { Context } from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { starterTemplates, type LibraryTemplate } from "./starters.js";

export async function templateLibrary(service: Service, c: Context) {
  await service.scoped(c, "read", async () => {});
  const client = cloudConnection(service)?.templates;
  const snapshot = client
    ? await client.list(c)
    : { templates: [], syncedAt: null };
  const templates: LibraryTemplate[] = [
    ...starterTemplates,
    ...snapshot.templates
      .filter(
        (t: LibraryTemplate) => !starterTemplates.some((s) => s.id === t.id),
      )
      .map((t: LibraryTemplate) => ({ ...t, sourceKind: "cloud" as const })),
  ];
  return { ...snapshot, configured: !!client, templates };
}
