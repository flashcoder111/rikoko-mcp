import { describe, expect, it } from "vitest";
import {
  productionShotDirection,
  validateProductionPlan,
} from "../packages/core/src/production-plan.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import { productionReviewObligations } from "../packages/core/src/production-quality-review.js";

function fixture() {
  const initialState = {
    bench: { presence: "visible" as const },
    component: {
      presence: "visible" as const,
      supportedBy: "bench",
      properties: { attached: "no" },
    },
    cover: { presence: "absent" as const },
  };
  const endState = {
    ...structuredClone(initialState),
    component: {
      ...initialState.component,
      properties: { attached: "yes" },
    },
  };
  return {
    title: "Device assembly",
    width: 720,
    height: 1280,
    process: {
      version: 1,
      objects: [
        { id: "bench", label: "Assembly bench" },
        {
          id: "component",
          label: "One component",
          supportRequired: true,
          allowedSupportIds: ["bench"],
        },
        { id: "cover", label: "Cover" },
      ],
    },
    shots: [
      {
        id: "assemble",
        durationMs: 4000,
        initialState: { component: "ready" },
        action: "Attach the component once",
        endState: { component: "attached" },
        process: {
          initialState,
          endState,
          stateAnchor: {
            mode: "text_only",
            reason: "No verified process frame is available yet",
          },
          operations: [
            {
              id: "attach",
              description: "Attach the single component",
              role: "main",
              preconditions: { component: initialState.component },
              effects: { component: endState.component },
              timing: {
                approach: { startMs: 0, endMs: 800 },
                contact: { startMs: 800, endMs: 1200 },
                completion: { startMs: 1200, endMs: 2600 },
                hold: { startMs: 2600, endMs: 4000 },
              },
            },
          ],
        },
      },
    ],
  };
}

const codes = (raw: unknown) =>
  validateProductionPlan(raw).issues.map((issue) => issue.code);

describe("declared process state and shot actions", () => {
  it("preserves optional legacy plans and accepts a single grounded operation", () => {
    const input = fixture();
    const result = validateProductionPlan(input);
    expect(result.valid).toBe(true);
    expect(result.plan.process).toEqual(input.process);
    expect(result.recommendations).toContainEqual(
      expect.objectContaining({ code: "STATE_ANCHOR_RECOMMENDED" }),
    );
    const { process: _, ...legacy } = input;
    expect(
      validateProductionPlan({
        ...legacy,
        shots: legacy.shots.map(({ process: __, ...shot }) => shot),
      }).valid,
    ).toBe(true);
  });

  it("distinguishes occlusion from absence and catches undeclared supports", () => {
    const input: any = fixture();
    input.shots[0].process.initialState.bench.presence = "occluded";
    input.shots[0].process.endState.bench.presence = "occluded";
    expect(codes(input)).not.toContain("PROCESS_SUPPORT_MISSING");
    input.shots[0].process.initialState.bench.presence = "absent";
    expect(codes(input)).toContain("PROCESS_SUPPORT_MISSING");
    input.shots[0].process.initialState.component.supportedBy = "cover";
    expect(codes(input)).toContain("PROCESS_SUPPORT_FORBIDDEN");
  });

  it("rejects repeated applications and final states unsupported by operation effects", () => {
    const input: any = fixture();
    input.shots[0].process.operations[0].preconditions.component.properties.attached =
      "yes";
    expect(codes(input)).toContain("PROCESS_OPERATION_NO_CHANGE");
    input.shots[0].process.endState.cover.presence = "visible";
    expect(codes(input)).toContain("PROCESS_END_STATE_MISMATCH");
  });

  it("requires operation preconditions and complete object identity across frames", () => {
    const input: any = fixture();
    input.shots[0].process.operations[0].preconditions.component = {
      presence: "visible",
      supportedBy: "bench",
      properties: { attached: "already" },
    };
    delete input.shots[0].process.endState.cover;
    expect(codes(input)).toContain("PROCESS_PRECONDITION_MISMATCH");
    expect(codes(input)).toContain("PROCESS_OBJECT_STATE_REQUIRED");
  });

  it("rejects object resets between continuous shots but accepts explained time jumps", () => {
    const input: any = fixture();
    input.shots.push({ ...structuredClone(input.shots[0]), id: "repeat" });
    input.shots[1].initialState = { component: "attached" };
    expect(codes(input)).toContain("PROCESS_STATE_DISCONTINUITY");
    input.shots[1].transition = "time_jump";
    input.shots[1].transitionReason = "A new component is staged off screen";
    expect(codes(input)).not.toContain("PROCESS_STATE_DISCONTINUITY");
  });

  it("rejects phase order, over-budget actions, overlapping changes and overloaded shots", () => {
    const input: any = fixture();
    input.shots[0].process.operations[0].timing.contact.startMs = 500;
    input.shots[0].process.operations[0].timing.hold.endMs = 5000;
    input.shots[0].process.operations.push({
      ...structuredClone(input.shots[0].process.operations[0]),
      id: "second-operation",
    });
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "PROCESS_PHASE_ORDER",
        "PROCESS_DURATION_EXCEEDED",
        "PROCESS_OPERATION_OVERLAP",
        "PROCESS_SHOT_OVERLOADED",
      ]),
    );
  });

  it("never treats a product appearance reference as a process first-frame anchor", () => {
    const input: any = fixture();
    input.shots[0].references = [
      {
        assetId: "product-photo",
        role: "product",
        instruction: "Appearance only",
      },
    ];
    input.shots[0].process.stateAnchor = {
      mode: "first_frame",
      assetId: "product-photo",
    };
    expect(codes(input)).toContain("PROCESS_ANCHOR_REFERENCE_REQUIRED");
    input.shots[0].references[0].role = "first_frame";
    expect(codes(input)).not.toContain("PROCESS_ANCHOR_REFERENCE_REQUIRED");
  });

  it("compiles process identity, states, timing and anchors into every stage direction", () => {
    const { plan } = validateProductionPlan(fixture());
    const shot = plan.shots[0];
    const direction = productionShotDirection(plan, shot);
    const compiled = compilePrompt({
      mode: "text_to_video",
      subject: "Miniature device assembly",
      ...direction,
    });
    expect(compiled.direction.process).toEqual(direction.process);
    expect(compiled.compilerVersion).toBe("rikoko-prompt-compiler-v3");
    expect(compiled.templateVersion).toBe("rikoko-direction-v3");
    expect(compiled.prompt).toContain("component");
    expect(compiled.prompt).toContain("supportedBy=bench");
    expect(compiled.prompt).toContain("contact 800-1200ms");
    expect(compiled.prompt).toContain("hold 2600-4000ms");
    expect(compiled.prompt).not.toContain("cover: absent");
    expect(compiled.direction.process?.endState.cover).toEqual({
      presence: "absent",
    });
    const first = productionShotDirection(plan, shot, "first_frame");
    const last = productionShotDirection(plan, shot, "last_frame");
    expect(first.process?.endState).toEqual(shot.process?.initialState);
    expect(last.process?.initialState).toEqual(shot.process?.endState);
    expect(first.process?.operations).toHaveLength(0);
  });

  it("keeps future occluded materials out of a static shot without deleting their canonical states", () => {
    const input: any = fixture();
    const shot = input.shots[0];
    shot.action = "Hold the completed component with a gentle camera push";
    shot.endState = structuredClone(shot.initialState);
    shot.process.endState = structuredClone(shot.process.initialState);
    shot.process.operations = [];
    for (const state of [shot.process.initialState, shot.process.endState])
      state.cover = {
        presence: "occluded",
        properties: { later: "Paint and fit the decorative enclosure" },
      };
    input.process.objects[1].allowedSupportIds.push("cover");
    const { plan, valid } = validateProductionPlan(input);
    expect(valid).toBe(true);
    const before = structuredClone(plan);
    const compiled = compilePrompt({
      mode: "text_to_video",
      subject: "One component on its bench",
      ...productionShotDirection(plan, plan.shots[0]),
    });
    expect(compiled.prompt).not.toMatch(/cover|decorative enclosure/i);
    expect(compiled.prompt).toContain("Static process hold");
    expect(compiled.prompt).toContain("only the described camera movement");
    expect(compiled.prompt).toContain("do not reset, duplicate or re-add");
    expect(compiled.direction.process?.objects).toEqual(plan.process?.objects);
    expect(compiled.direction.process?.initialState.cover.presence).toBe(
      "occluded",
    );
    expect(plan).toEqual(before);
    expect(productionReviewObligations(plan)).toEqual([
      { id: "process:assemble:state", kind: "visual", shotId: "assemble" },
    ]);
  });

  it("retains hidden supports and operation inputs that are consumed or revealed", () => {
    const input: any = fixture();
    const process = input.shots[0].process;
    input.process.objects.push({ id: "compound", label: "Bonding compound" });
    input.process.objects.push({
      id: "guide",
      label: "Hidden alignment guide",
    });
    for (const state of [process.initialState, process.endState])
      Object.assign(state, {
        bench: { presence: "occluded" },
        guide: { presence: "occluded", properties: { locked: "yes" } },
      });
    process.operations[0].preconditions.guide = process.initialState.guide;
    process.initialState.compound = {
      presence: "occluded",
      properties: { quantity: "one dose" },
    };
    process.endState.compound = { presence: "absent" };
    process.initialState.cover = { presence: "occluded" };
    process.endState.cover = { presence: "visible" };
    for (const id of ["compound", "cover"])
      Object.assign(process.operations[0], {
        preconditions: {
          ...process.operations[0].preconditions,
          [id]: process.initialState[id],
        },
        effects: {
          ...process.operations[0].effects,
          [id]: process.endState[id],
        },
      });
    const { plan, valid } = validateProductionPlan(input);
    expect(valid).toBe(true);
    const before = structuredClone(plan);
    const obligations = productionReviewObligations(plan);
    const compiled = compilePrompt({
      mode: "text_to_video",
      subject: "Device assembly",
      ...productionShotDirection(plan, plan.shots[0]),
    });
    expect(compiled.prompt).toContain("bench: occluded");
    expect(compiled.prompt).toContain("compound=Bonding compound");
    expect(compiled.prompt).toContain("compound: absent");
    expect(compiled.prompt).toContain("cover: visible");
    expect(compiled.prompt).toContain("guide=Hidden alignment guide");
    expect(compiled.prompt).toContain("guide: occluded; locked=yes");
    expect(compiled.prompt).toContain("contact 800-1200ms");
    expect(compiled.direction.process?.operations).toEqual(process.operations);
    expect(plan).toEqual(before);
    expect(productionReviewObligations(plan)).toEqual(obligations);
    expect(obligations).toContainEqual({
      id: "process:assemble:operation:attach",
      kind: "process",
      shotId: "assemble",
      operationId: "attach",
      minHoldMs: 1400,
    });
  });

  it("projects still-image boundaries independently from the video's future operation", () => {
    const input: any = fixture();
    const process = input.shots[0].process;
    process.initialState.cover = { presence: "occluded" };
    process.endState.cover = { presence: "visible" };
    process.operations[0].preconditions.cover = process.initialState.cover;
    process.operations[0].effects.cover = process.endState.cover;
    const { plan, valid } = validateProductionPlan(input);
    expect(valid).toBe(true);
    const prompt = (stage: "first_frame" | "last_frame") =>
      compilePrompt({
        mode: "text_to_image",
        subject: "Device assembly",
        ...productionShotDirection(plan, plan.shots[0], stage),
      }).prompt;
    expect(prompt("first_frame")).not.toContain("cover");
    expect(prompt("last_frame")).toContain("cover: visible");
  });

  it("keeps review requirements in the plan while compiling explicit footage constraints", () => {
    const input: any = fixture();
    input.remake = {
      analysisAssetId: "source-analysis",
      analysisSha256: "a".repeat(64),
      productFacts: [
        "Later fit a decorative enclosure and gold presentation ribbon",
      ],
      requirements: [
        {
          id: "single-operation",
          mode: "preserve",
          origin: "reference",
          description: "Keep physical tool contact visible",
          sourceShotIds: ["source-assembly"],
          evidenceIds: ["contact-evidence"],
        },
      ],
      unknownDecisions: [],
    };
    Object.assign(input.shots[0], {
      productFactIndices: [],
      sourceShotIds: ["source-assembly"],
      purpose: "Show one grounded attachment",
      actionStages: ["Contact, attach, then hold"],
      camera: "Fixed view of the contact point",
      acceptanceCriteria: ["Show the completed attachment before cutting"],
      generationConstraints: ["Keep physical tool contact visible"],
      requirementUses: [
        {
          requirementId: "single-operation",
          application:
            "Hold the same contact point in frame throughout attachment",
        },
      ],
    });
    const { plan, valid } = validateProductionPlan(input);
    expect(valid).toBe(true);
    const before = structuredClone(plan);
    const prompt = (stage: "video" | "first_frame" | "last_frame") =>
      compilePrompt({
        mode: stage === "video" ? "text_to_video" : "text_to_image",
        subject: "Device assembly",
        ...productionShotDirection(plan, plan.shots[0], stage),
      }).prompt;
    for (const stage of ["video", "first_frame", "last_frame"] as const)
      expect(prompt(stage)).not.toContain("gold presentation ribbon");
    expect(prompt("video")).toContain(input.remake.requirements[0].description);
    expect(prompt("video")).not.toContain(
      input.shots[0].requirementUses[0].application,
    );
    expect(prompt("video")).not.toContain("Acceptance 1");
    expect(plan).toEqual(before);
    expect(plan.remake?.productFacts).toEqual(input.remake.productFacts);
    const { process: _, ...legacy } = plan;
    const legacyShot = {
      ...plan.shots[0],
      process: undefined,
      productFactIndices: undefined,
    };
    for (const stage of ["video", "first_frame", "last_frame"] as const)
      expect(
        productionShotDirection(legacy, legacyShot, stage).constraints,
      ).toContain(input.remake.productFacts[0]);
    plan.remake!.productFacts.push("The component housing is cobalt blue");
    plan.shots[0].productFactIndices = [1];
    for (const stage of ["video", "first_frame", "last_frame"] as const) {
      expect(prompt(stage)).toContain("cobalt blue");
      expect(prompt(stage)).not.toContain("gold presentation ribbon");
    }
    delete plan.shots[0].productFactIndices;
    for (const stage of ["video", "first_frame", "last_frame"] as const) {
      expect(prompt(stage)).toContain("cobalt blue");
      expect(prompt(stage)).toContain("gold presentation ribbon");
    }
    plan.shots[0].productFactIndices = [1, 1];
    expect(codes(plan)).toContain("REMAKE_PRODUCT_FACT_INVALID");
    plan.shots[0].productFactIndices = [2];
    expect(codes(plan)).toContain("REMAKE_PRODUCT_FACT_INVALID");
    delete plan.remake;
    expect(codes(plan)).toContain("REMAKE_REQUIREMENTS_REQUIRED");
  });

  it("rejects oversized compiled constraints explicitly instead of truncating them", () => {
    const input: any = fixture();
    input.shots[0].sceneDirection = "z".repeat(19000);
    input.shots[0].process.operations[0].description = "x".repeat(500);
    input.shots[0].process.initialState.component.properties =
      Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `property-${index}`,
          "y".repeat(200),
        ]),
      );
    input.shots[0].process.operations[0].preconditions.component =
      input.shots[0].process.initialState.component;
    const { plan } = validateProductionPlan(input);
    expect(() =>
      compilePrompt({
        mode: "text_to_video",
        subject: "Assembly",
        ...productionShotDirection(plan, plan.shots[0]),
      }),
    ).toThrow(/split|20000/i);
  });

  it("requires own snapshot entries even when object IDs match JavaScript prototype names", () => {
    const input: any = fixture();
    input.process.objects.push({
      id: "constructor",
      label: "Constructor tool",
    });
    expect(validateProductionPlan(input).issues).toContainEqual(
      expect.objectContaining({
        code: "PROCESS_OBJECT_STATE_REQUIRED",
        object: "constructor",
      }),
    );
  });

  it("requires the versioned registry, complete process media shots and a duration budget", () => {
    const input: any = fixture();
    delete input.process;
    expect(codes(input)).toContain("PROCESS_REGISTRY_REQUIRED");
    const missingShot: any = fixture();
    delete missingShot.shots[0].process;
    expect(codes(missingShot)).toContain("PROCESS_SHOT_REQUIRED");
    missingShot.shots[0].visualKind = "graphic";
    expect(codes(missingShot)).not.toContain("PROCESS_SHOT_REQUIRED");
    const missingDuration: any = fixture();
    delete missingDuration.shots[0].durationMs;
    expect(codes(missingDuration)).toContain("PROCESS_DURATION_REQUIRED");
  });

  it("rejects duplicate identities and invalid support declarations", () => {
    const input: any = fixture();
    input.process.objects.push(input.process.objects[0]);
    input.process.objects[1].allowedSupportIds.push("unknown-support");
    expect(codes(input)).toContain("PROCESS_OBJECT_DUPLICATE");
    expect(codes(input)).toContain("PROCESS_SUPPORT_INVALID");
    input.shots[0].process.initialState.component.supportedBy = null;
    expect(codes(input)).toContain("PROCESS_SUPPORT_MISSING");
    input.shots[0].process.initialState.component.supportedBy = "component";
    expect(codes(input)).toContain("PROCESS_SUPPORT_CYCLE");
  });

  it("rejects unknown identities, self relations and relations to absent objects", () => {
    const input: any = fixture();
    input.shots[0].process.initialState.stranger = { presence: "visible" };
    input.shots[0].process.initialState.component.relations = [
      { kind: "touching", targetId: "cover" },
      { kind: "inside", targetId: "component" },
    ];
    input.shots[0].process.initialState.cover.supportedBy = "bench";
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "PROCESS_OBJECT_UNKNOWN",
        "PROCESS_RELATION_INVALID",
        "PROCESS_ABSENT_OBJECT_RELATION",
      ]),
    );
  });

  it("requires actual preconditions for effects, unique operations and a primary action", () => {
    const input: any = fixture();
    input.shots[0].process.operations[0].role = "secondary";
    delete input.shots[0].process.operations[0].preconditions.component;
    input.shots[0].process.operations.push(
      structuredClone(input.shots[0].process.operations[0]),
    );
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "PROCESS_PRECONDITION_REQUIRED",
        "PROCESS_OPERATION_DUPLICATE",
        "PROCESS_MAIN_OPERATION_REQUIRED",
      ]),
    );
  });

  it("requires a justified text-only anchor and binds previous-end anchors to the immediate process shot", () => {
    const input: any = fixture();
    delete input.shots[0].process.stateAnchor.reason;
    expect(codes(input)).toContain("PROCESS_ANCHOR_REASON_REQUIRED");
    input.shots[0].process.stateAnchor = {
      mode: "previous_end",
      assetId: "prior-frame",
      previousShotId: "missing",
    };
    input.shots[0].references = [
      {
        assetId: "prior-frame",
        role: "first_frame",
        instruction: "Exact state",
      },
    ];
    expect(codes(input)).toContain("PROCESS_PREVIOUS_ANCHOR_INVALID");
    const good: any = fixture();
    const hold = structuredClone(good.shots[0]);
    hold.id = "hold";
    hold.initialState = hold.endState;
    hold.process.initialState = hold.process.endState;
    hold.process.operations = [];
    hold.process.stateAnchor = {
      mode: "previous_end",
      assetId: "prior-frame",
      previousShotId: "assemble",
    };
    hold.references = [
      {
        assetId: "prior-frame",
        role: "first_frame",
        instruction: "Exact state",
      },
    ];
    good.shots.push(hold);
    expect(validateProductionPlan(good).valid).toBe(true);
    hold.references[0].usage = "analysis_only";
    expect(codes(good)).toContain("PROCESS_ANCHOR_REFERENCE_REQUIRED");
  });
});
