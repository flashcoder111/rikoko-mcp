import { z } from "zod";
import { idSchema } from "../../contracts/src/index.js";

const description = z.string().trim().min(1).max(500);
export const processObjectStateSchema = z
  .object({
    presence: z.enum(["visible", "occluded", "absent"]),
    supportedBy: idSchema.nullable().optional(),
    relations: z
      .array(
        z
          .object({
            kind: z.string().trim().min(1).max(80),
            targetId: idSchema,
          })
          .strict(),
      )
      .max(20)
      .optional(),
    properties: z
      .record(
        z.string().trim().min(1).max(80),
        z.string().trim().min(1).max(300),
      )
      .refine((value) => Object.keys(value).length <= 20)
      .optional(),
  })
  .strict();
export const processStateSchema = z
  .record(idSchema, processObjectStateSchema)
  .refine((value) => Object.keys(value).length <= 50);
export const productionProcessSchema = z
  .object({
    version: z.literal(1),
    objects: z
      .array(
        z
          .object({
            id: idSchema,
            label: z.string().trim().min(1).max(160),
            supportRequired: z.boolean().optional(),
            allowedSupportIds: z.array(idSchema).max(50).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const intervalSchema = z
  .object({
    startMs: z.number().int().min(0).max(600000),
    endMs: z.number().int().min(0).max(600000),
  })
  .strict();
export const processOperationSchema = z
  .object({
    id: idSchema,
    description,
    role: z.enum(["main", "secondary"]),
    preconditions: processStateSchema,
    effects: processStateSchema,
    timing: z
      .object({
        approach: intervalSchema,
        contact: intervalSchema,
        completion: intervalSchema,
        hold: intervalSchema,
      })
      .strict(),
  })
  .strict();
export const processShotSchema = z
  .object({
    initialState: processStateSchema,
    endState: processStateSchema,
    operations: z.array(processOperationSchema).max(16),
    stateAnchor: z
      .object({
        mode: z.enum(["first_frame", "previous_end", "text_only"]),
        assetId: idSchema.optional(),
        previousShotId: idSchema.optional(),
        reason: description.optional(),
      })
      .strict(),
  })
  .strict();
export const processDirectionSchema = processShotSchema.extend({
  ...productionProcessSchema.shape,
  stage: z.enum(["video", "first_frame", "last_frame"]),
});
export type ProcessState = z.infer<typeof processStateSchema>;
export type ProcessShot = z.infer<typeof processShotSchema>;
export type ProductionProcess = z.infer<typeof productionProcessSchema>;
export type ProcessDirection = z.infer<typeof processDirectionSchema>;
export type ProductionProcessIssue = {
  code: string;
  shotId: string;
  object?: string;
  message: string;
};
type ProcessShotLike = {
  id: string;
  visualKind?: string;
  process?: ProcessShot;
  durationMs?: number;
  transition?: string;
  transitionReason?: string;
  references: { assetId: string; role: string; usage?: string }[];
};
type ProcessPlanLike = {
  process?: ProductionProcess;
  shots: ProcessShotLike[];
};
const phases = ["approach", "contact", "completion", "hold"] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
function stateOf(snapshot: ProcessState, id: string) {
  return Object.hasOwn(snapshot, id) ? snapshot[id] : undefined;
}

/** Checks only authored object facts and timing; this is not a physics or vision oracle. */
export function validateProductionProcess(plan: ProcessPlanLike) {
  const issues: ProductionProcessIssue[] = [];
  const recommendations: ProductionProcessIssue[] = [];
  const add = (
    code: string,
    shotId: string,
    message: string,
    object?: string,
  ) => issues.push({ code, shotId, message, ...(object ? { object } : {}) });
  if (!plan.process) {
    for (const shot of plan.shots)
      if (shot.process)
        add(
          "PROCESS_REGISTRY_REQUIRED",
          shot.id,
          "Declare the versioned process object registry before authoring process shots",
        );
    return { issues, recommendations };
  }
  const objects = new Map(
    plan.process.objects.map((object) => [object.id, object]),
  );
  if (objects.size !== plan.process.objects.length)
    add(
      "PROCESS_OBJECT_DUPLICATE",
      "",
      "Process objects need stable, unique IDs",
    );
  for (const object of objects.values())
    for (const support of object.allowedSupportIds ?? [])
      if (!objects.has(support) || support === object.id)
        add(
          "PROCESS_SUPPORT_INVALID",
          "",
          "Allowed supports must name another registered object",
          object.id,
        );
  const validateState = (
    snapshot: ProcessState,
    shotId: string,
    location: string,
    complete = true,
  ) => {
    if (complete)
      for (const id of objects.keys())
        if (!stateOf(snapshot, id))
          add(
            "PROCESS_OBJECT_STATE_REQUIRED",
            shotId,
            `${location}: declare ${id} as visible, occluded or absent`,
            id,
          );
    for (const [id, state] of Object.entries(snapshot)) {
      const object = objects.get(id);
      if (!object) {
        add(
          "PROCESS_OBJECT_UNKNOWN",
          shotId,
          `${location}: use registered object IDs`,
          id,
        );
        continue;
      }
      const support = state.supportedBy;
      if (state.presence === "absent" && (support || state.relations?.length))
        add(
          "PROCESS_ABSENT_OBJECT_RELATION",
          shotId,
          `${location}: absent objects cannot support or contact other objects; occluded objects still exist`,
          id,
        );
      if (state.presence !== "absent" && object.supportRequired && !support)
        add(
          "PROCESS_SUPPORT_MISSING",
          shotId,
          `${location}: declare the physical support for ${id}`,
          id,
        );
      if (support) {
        if (support === id || !objects.has(support))
          add(
            "PROCESS_SUPPORT_INVALID",
            shotId,
            `${location}: support must be another registered object`,
            id,
          );
        else if (
          complete &&
          (!stateOf(snapshot, support) ||
            stateOf(snapshot, support)?.presence === "absent")
        )
          add(
            "PROCESS_SUPPORT_MISSING",
            shotId,
            `${location}: support ${support} must exist, even if occluded`,
            id,
          );
        if (
          object.allowedSupportIds &&
          !object.allowedSupportIds.includes(support)
        )
          add(
            "PROCESS_SUPPORT_FORBIDDEN",
            shotId,
            `${location}: ${support} is outside the declared allowed supports`,
            id,
          );
        const seen = new Set([id]);
        let cursor: string | null | undefined = support;
        while (cursor) {
          if (seen.has(cursor)) {
            add(
              "PROCESS_SUPPORT_CYCLE",
              shotId,
              `${location}: support relationships cannot form a cycle`,
              id,
            );
            break;
          }
          seen.add(cursor);
          cursor = stateOf(snapshot, cursor)?.supportedBy;
        }
      }
      for (const relation of state.relations ?? [])
        if (
          !objects.has(relation.targetId) ||
          relation.targetId === id ||
          (complete &&
            (!stateOf(snapshot, relation.targetId) ||
              stateOf(snapshot, relation.targetId)?.presence === "absent"))
        )
          add(
            "PROCESS_RELATION_INVALID",
            shotId,
            `${location}: relations must target another existing object`,
            id,
          );
    }
  };
  let previous: ProcessShotLike | undefined;
  for (const shot of plan.shots) {
    const process = shot.process;
    if (!process) {
      if (shot.visualKind !== "graphic")
        add(
          "PROCESS_SHOT_REQUIRED",
          shot.id,
          "Each media shot needs process states, operations (empty for a hold), and an explicit state anchor",
        );
      continue;
    }
    validateState(process.initialState, shot.id, "Initial state");
    validateState(process.endState, shot.id, "End state");
    if (!shot.durationMs)
      add(
        "PROCESS_DURATION_REQUIRED",
        shot.id,
        "Declare durationMs so operation and settled hold intervals can be checked",
      );
    if (
      previous?.process &&
      (!shot.transition || shot.transition === "continuous")
    )
      for (const id of objects.keys())
        if (
          !same(
            stateOf(previous.process.endState, id),
            stateOf(process.initialState, id),
          )
        )
          add(
            "PROCESS_STATE_DISCONTINUITY",
            shot.id,
            "Preserve the previous end state or declare an explained time jump/independent scene",
            id,
          );
    const anchor = process.stateAnchor;
    if (anchor.mode === "text_only") {
      if (!anchor.reason)
        add(
          "PROCESS_ANCHOR_REASON_REQUIRED",
          shot.id,
          "Explain why no verified process-state image anchors this shot",
        );
      recommendations.push({
        code: "STATE_ANCHOR_RECOMMENDED",
        shotId: shot.id,
        message:
          "Create and inspect a first frame for this exact process state; a finished-product appearance image is not a state anchor",
      });
    } else {
      if (
        !anchor.assetId ||
        !shot.references.some(
          (reference) =>
            reference.assetId === anchor.assetId &&
            reference.role === "first_frame" &&
            reference.usage !== "analysis_only",
        )
      )
        add(
          "PROCESS_ANCHOR_REFERENCE_REQUIRED",
          shot.id,
          "Bind the inspected process-state image as an actual first_frame reference; product/style references do not qualify",
        );
      if (
        anchor.mode === "previous_end" &&
        (!previous ||
          anchor.previousShotId !== previous.id ||
          shot.transition !== "continuous")
      )
        add(
          "PROCESS_PREVIOUS_ANCHOR_INVALID",
          shot.id,
          "A previous-end anchor must identify the preceding process shot and continue its state",
        );
    }
    const operationIds = new Set<string>();
    if (
      process.operations.filter((operation) => operation.role === "main")
        .length > 1
    )
      add(
        "PROCESS_SHOT_OVERLOADED",
        shot.id,
        "Split this shot: each generated shot may contain at most one main state-changing operation, followed by a visible settled hold",
      );
    if (
      process.operations.length &&
      !process.operations.some((operation) => operation.role === "main")
    )
      add(
        "PROCESS_MAIN_OPERATION_REQUIRED",
        shot.id,
        "Identify one main operation; secondary actions cannot hide a sequence of main operations",
      );
    for (const operation of process.operations) {
      if (operationIds.has(operation.id))
        add(
          "PROCESS_OPERATION_DUPLICATE",
          shot.id,
          "Operation IDs must be unique within a shot",
        );
      operationIds.add(operation.id);
      validateState(
        operation.preconditions,
        shot.id,
        `${operation.id} preconditions`,
        false,
      );
      validateState(
        operation.effects,
        shot.id,
        `${operation.id} effects`,
        false,
      );
      const changed = Object.keys(operation.effects);
      if (
        !changed.length ||
        changed.every((id) =>
          same(
            stateOf(operation.preconditions, id),
            stateOf(operation.effects, id),
          ),
        )
      )
        add(
          "PROCESS_OPERATION_NO_CHANGE",
          shot.id,
          `${operation.id} repeats an already-satisfied state; remove the operation or declare the actual state change`,
        );
      for (const id of changed)
        if (!stateOf(operation.preconditions, id))
          add(
            "PROCESS_PRECONDITION_REQUIRED",
            shot.id,
            `${operation.id} must declare the prior state of every affected object`,
            id,
          );
      let end = 0;
      for (const phase of phases) {
        const interval = operation.timing[phase];
        if (interval.endMs <= interval.startMs || interval.startMs < end)
          add(
            "PROCESS_PHASE_ORDER",
            shot.id,
            `${operation.id}: approach, contact, completion and settled hold must be positive, ordered intervals`,
          );
        if (shot.durationMs && interval.endMs > shot.durationMs)
          add(
            "PROCESS_DURATION_EXCEEDED",
            shot.id,
            `${operation.id}: split the operation or increase shot duration; ${phase} exceeds the shot budget`,
          );
        end = interval.endMs;
      }
    }
    for (let i = 0; i < process.operations.length; i++) {
      const first = process.operations[i];
      for (const second of process.operations.slice(i + 1)) {
        const overlap =
          first.timing.approach.startMs < second.timing.hold.endMs &&
          second.timing.approach.startMs < first.timing.hold.endMs;
        const conflict =
          Object.keys(first.effects).some(
            (id) =>
              stateOf(second.preconditions, id) || stateOf(second.effects, id),
          ) ||
          Object.keys(second.effects).some((id) =>
            stateOf(first.preconditions, id),
          );
        if (overlap && conflict)
          add(
            "PROCESS_OPERATION_OVERLAP",
            shot.id,
            `${first.id} and ${second.id} overlap on dependent objects; preserve contact/completion/hold or split the shot`,
          );
      }
    }
    const current: ProcessState = Object.assign(
      Object.create(null),
      process.initialState,
    );
    const events = process.operations
      .flatMap((operation) => [
        { at: operation.timing.approach.startMs, effect: false, operation },
        { at: operation.timing.completion.endMs, effect: true, operation },
      ])
      .sort((a, b) => a.at - b.at || Number(b.effect) - Number(a.effect));
    for (const event of events) {
      if (event.effect) {
        Object.assign(current, event.operation.effects);
        validateState(
          current,
          shot.id,
          `${event.operation.id} completed state`,
        );
      } else {
        for (const [id, expected] of Object.entries(
          event.operation.preconditions,
        ))
          if (!same(stateOf(current, id), expected))
            add(
              "PROCESS_PRECONDITION_MISMATCH",
              shot.id,
              `${event.operation.id} starts from a different state than the declared process timeline`,
              id,
            );
      }
    }
    if (!same(current, process.endState))
      add(
        "PROCESS_END_STATE_MISMATCH",
        shot.id,
        "End state must follow the declared operation effects; do not add, remove or reset objects between operations",
      );
    previous = shot;
  }
  return { issues, recommendations };
}

export function processShotDirection(
  plan: ProcessPlanLike,
  shot: ProcessShotLike,
  stage: ProcessDirection["stage"] = "video",
): ProcessDirection | undefined {
  if (!plan.process || !shot.process) return undefined;
  return {
    ...plan.process,
    ...shot.process,
    stage,
    initialState:
      stage === "last_frame"
        ? shot.process.endState
        : shot.process.initialState,
    endState:
      stage === "first_frame"
        ? shot.process.initialState
        : shot.process.endState,
    operations: stage === "video" ? shot.process.operations : [],
  };
}
/** Select provider-visible facts without changing the canonical process contract. */
function processPromptObjects(process: ProcessDirection) {
  const states = [process.initialState, process.endState];
  const selected = new Set<string>();
  for (const object of process.objects) {
    if (
      states.some((snapshot) => snapshot[object.id]?.presence === "visible") ||
      !same(process.initialState[object.id], process.endState[object.id])
    )
      selected.add(object.id);
  }
  // Preconditions can include hidden tools or consumed material. Keep explicit
  // operation participants even when neither boundary shows them.
  for (const operation of process.operations) {
    states.push(operation.preconditions, operation.effects);
    for (const id of [
      ...Object.keys(operation.preconditions),
      ...Object.keys(operation.effects),
    ])
      selected.add(id);
  }
  // Preserve actual support/contact dependencies, never the registry's list of
  // possible future supports. Set iteration also visits newly added dependencies.
  for (const id of selected)
    for (const snapshot of states) {
      const object = snapshot[id];
      if (object?.supportedBy) selected.add(object.supportedBy);
      for (const relation of object?.relations ?? [])
        selected.add(relation.targetId);
    }
  return selected;
}
function renderProcessState(state: ProcessState, selected: Set<string>) {
  return Object.entries(state)
    .filter(([id]) => selected.has(id))
    .map(
      ([id, object]) =>
        `${id}: ${object.presence}${object.supportedBy !== undefined ? `; supportedBy=${object.supportedBy ?? "none"}` : ""}` +
        (object.relations ?? [])
          .map((relation) => `; ${relation.kind}=${relation.targetId}`)
          .join("") +
        Object.entries(object.properties ?? {})
          .map(([key, value]) => `; ${key}=${value}`)
          .join(""),
    )
    .join(" | ");
}
export function renderProcessDirection(process: ProcessDirection) {
  const selected = processPromptObjects(process);
  return [
    `Process v1 (${process.stage}). Keep stable object identity; occluded means present outside view, absent means not present.`,
    "Keep objects outside this shot out of frame. Preserve already completed but occluded work unchanged; do not reset, duplicate or re-add it. Show only the declared state and operations, without introducing later process steps.",
    `Objects in this shot: ${process.objects
      .filter((object) => selected.has(object.id))
      .map(
        (object) =>
          `${object.id}=${object.label}${object.supportRequired ? " (support required)" : ""}`,
      )
      .join(" | ")}`,
    `Process start: ${renderProcessState(process.initialState, selected)}`,
    ...process.operations.map(
      (operation) =>
        `${operation.role} operation ${operation.id}: ${operation.description}. ` +
        phases
          .map(
            (phase) =>
              `${phase} ${operation.timing[phase].startMs}-${operation.timing[phase].endMs}ms`,
          )
          .join(", ") +
        `. Preconditions: ${renderProcessState(operation.preconditions, selected)}. Effects: ${renderProcessState(operation.effects, selected)}.`,
    ),
    `Process end: ${renderProcessState(process.endState, selected)}`,
    ...(process.stage === "video" && process.operations.length === 0
      ? [
          "Static process hold: keep the same process state and declared composition. Allow only the described camera movement or micro-motion; do not begin another operation or the next process step.",
        ]
      : []),
    `State anchor: ${process.stateAnchor.mode}${process.stateAnchor.assetId ? ` asset=${process.stateAnchor.assetId}` : ""}${process.stateAnchor.previousShotId ? ` from shot=${process.stateAnchor.previousShotId}` : ""}${process.stateAnchor.reason ? `; ${process.stateAnchor.reason}` : ""}. Product appearance alone does not define the starting process state.`,
  ].join("\n");
}
