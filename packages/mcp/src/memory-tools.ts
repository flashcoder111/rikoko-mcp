import type { Context } from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import {
  memorySaveSchema,
  ruleSetSaveSchema,
  ruleUpsertSchema,
  memoryGetSchema,
  memoryPageSchema,
  memoryHistorySchema,
  memoryChangeSchema,
  resolveContextSchema,
} from "../../core/src/creative-memory-contracts.js";
import {
  memorySave,
  ruleSetSave,
  ruleUpsert,
  memoryGet,
  memorySearch,
  memoryHistory,
  memoryChange,
} from "../../core/src/creative-memory.js";
import { resolveCreativeContext } from "../../core/src/creative-context.js";

export const memoryTools = {
  memory_save: {
    schema: memorySaveSchema,
    description:
      "Save an explicitly requested local brand, series, character, separate character-look, or configured voice-profile. For updates use id and expectedVersion; data is a field-level patch, arrays replace. Use user_instruction only for actual user directions; inferred knowledge remains draft. References must be owned images. Does not generate, recognize faces or clone voices. Read capabilities.creativeMemory.dataFields for supported per-kind fields.",
  },
  memory_get: {
    schema: memoryGetSchema,
    description:
      "Read one owned local memory record or structured rule by ID, including version and source. Read before updating. No generation.",
  },
  memory_search: {
    schema: memoryPageSchema,
    description:
      "Search owned local characters, aliases, brands, series and creative rules. Paginated; active records by default. Names are not unique: resolve ambiguous matches rather than selecting an arbitrary identity. No model or generation.",
  },
  memory_history: {
    schema: memoryHistorySchema,
    description:
      "Read paginated versions of an existing owned memory record, newest first. Frozen work snapshots remain separate.",
  },
  memory_archive: {
    schema: memoryChangeSchema,
    description:
      "Stop future automatic use of a local memory or rule, preserving history and existing work. Requires current expectedVersion and stable idempotencyKey.",
  },
  memory_delete: {
    schema: memoryChangeSchema,
    description:
      "Delete an owned local memory record, its editable history and mutation cache. Dependent records must be detached first. Keeps independent media, frozen creative-context snapshots and project revisions; disclose this scope. Does not delete photos. Requires expectedVersion and idempotencyKey.",
  },
  rule_set_save: {
    schema: ruleSetSaveSchema,
    description:
      "Create or patch a named local creative rule set with account/brand/series/character/project scope. Existing scope is immutable. Individual rules are maintained with rule_upsert, never overwritten by saving the collection.",
  },
  rule_upsert: {
    schema: ruleUpsertSchema,
    description:
      "Add one typed creative rule or patch a rule by id/expectedVersion. New rules require ruleSetId and definition. Omitted fields are preserved. Conditions are exact taskKind/language matches. Deduplicates identical adds; contradictory required rules in the same set fail. Inference cannot become active. Does not buy or generate media.",
  },
  rule_list: {
    schema: memoryPageSchema,
    description:
      "List/search local structured creative rules, optionally filtered by ruleSetId. Paginated and active-only by default. Use memory_get for full record and memory_history for versions.",
  },
  creative_context_resolve: {
    schema: resolveContextSchema,
    description:
      "Resolve local creative rules and explicitly selected characters/looks for this task; automatically includes matching active rule sets. Saves a frozen local snapshot and returns its id for creativeContextId in workspace_request_save/plan/commit. Returns conflicts, unknown conditions, missing references, overrides and review needs. No render or paid model. Resolve blockers before committing; visual identity is never auto-certified.",
  },
};
export type MemoryToolName = keyof typeof memoryTools;
export function callMemoryTool(
  service: Service,
  c: Context,
  name: MemoryToolName,
  raw: unknown,
) {
  switch (name) {
    case "memory_save":
      return memorySave(service, c, raw);
    case "rule_set_save":
      return ruleSetSave(service, c, raw);
    case "rule_upsert":
      return ruleUpsert(service, c, raw);
    case "memory_get":
      return memoryGet(service, c, raw);
    case "memory_search":
      return memorySearch(service, c, raw);
    case "rule_list":
      return memorySearch(service, c, {
        ...memoryPageSchema.parse(raw),
        kind: "creative-rule",
      });
    case "memory_history":
      return memoryHistory(service, c, raw);
    case "memory_archive":
      return memoryChange(service, c, raw, false);
    case "memory_delete":
      return memoryChange(service, c, raw, true);
    case "creative_context_resolve":
      return resolveCreativeContext(service, c, raw);
  }
}
