# Plan and verify production quality

Use this playbook for process footage, demonstrations, music-led edits and advertisements. Apply only the parts relevant to the brief. It does not require a particular product, visual style, shot count or music track. The host reasons about the scene; MCP records the declared plan, checks its consistency and binds review evidence. A valid record alone cannot establish plausible physics, good rhythm or persuasive advertising.

Default delivery follows [quick image checks and direct delivery](visual-review.md): check critical images once, no default video/final AI review, and no automatic quality regeneration. The detailed review methods below apply only to an explicitly requested quality review, not every production. Planning and deterministic technical checks remain active. An optional review does not authorize paid repair.

## Establish what is known and what is chosen

Separate user requirements, source observations, supported product facts, host creative decisions and unresolved questions. “Show the brand at the end” does not mean “use a blank logo card” or “hide the brand until the end.” A source has four shots because that was observed, not because the user requested four. Put creative choices in the target shot's purpose and rationale; never manufacture `origin="user"` evidence for them. State relevant uncertainty rather than filling a missing step with an imagined observation.

Inspect the scope of evidence. An analysis of one processing window cannot establish that the entire reference ends there. Contradictory motion descriptions require reinspection or an explicit uncertainty decision. Source timing informs the edit but does not set target shot count, generation duration or cut times.

## Maintain a process ledger

Before writing attractive prose, work through each operation as a state transition. Use stable identities for the same object across shots. Record observable facts needed to distinguish a valid transition from a reset:

- Inventory: how many objects/components exist, which are already installed or applied, and which remain available. Repeated additions are valid only when the plan deliberately specifies a second amount or component.
- Location and relationships: what supports, contains, grips or is attached to each object; orientation and relevant scale. A dangling component needs a support, and a tool releases only after another support takes its load.
- Process state: closed/open, untreated/coated, unassembled/assembled, empty/filled, and any irreversible change. Use facts appropriate to the actual product rather than borrowing another product's mechanism.
- Visibility: an object can be present but hidden behind a cover or outside the frame. **Hidden is not absent.** An unknown hidden state is not evidence that a component has been removed.

For each next shot, compare its starting ledger with the previous settled ledger. A continuous cut preserves identity, quantities and completed operations. For a deliberate time jump, state the skipped operations and resulting state; establish that state in the next first frame. A time jump is an authored edit, not permission for an unexplained reset. Do not require every real-world step to appear on screen.

For example, a lid hidden behind a box remains on the table; it cannot become a second lid. A bottle already filled in one shot stays filled after a camera cut. A coat of varnish cannot disappear when the brush re-enters. A deliberately surreal transformation can use different rules if the brief calls for it; name those rules and review against them rather than calling it ordinary physics.

### Save the process contract

Use `plan.process={version:1,objects:[...]}`. Each object has stable `id`/`label`, with `supportRequired` and `allowedSupportIds` where needed. With this registry, every media shot supplies `shot.process` and `durationMs`; a graphic-only card can omit process state. Keep the shot's ordinary readable `initialState`, `action` and `endState` consistent with the structured process, rather than replacing them with the ledger.

`shot.process.initialState` and `endState` are full maps of every registered object. Each object state has `presence` (`visible`, `occluded`, `absent`), optional `supportedBy` (registered ID or null), `relations=[{kind,targetId}]` and `properties` containing relevant string facts such as count, orientation or assembly stage. Use `occluded` for an object that still exists but is hidden or outside this crop; never erase its support or completed state merely because it cannot be seen. An uncertain property can be described as unknown, but that does not establish a verified starting condition for a dependent operation.

Each `operations` entry names `id`, `description`, `role` (`main`, `secondary`), `preconditions`, `effects` and `timing`. Preconditions/effects map affected IDs to their full object states. Exactly one main operation is needed when the list is nonempty; do not disguise additional major actions as secondary. An unchanged hold uses an empty list. `timing.approach`, `.contact`, `.completion` and `.hold` each contain positive, ordered `{startMs,endMs}` intervals within the shot duration. Dependent operations cannot overlap. The final ledger must follow the declared effects, and a continuous next shot must preserve it. Use `transition="time_jump"` or `"independent"` with `transitionReason` only for a real authored transition, not to silence a continuity error.

`stateAnchor` uses `mode="first_frame"` with an actual `assetId`, `"previous_end"` with that asset and `previousShotId`, or `"text_only"` with a `reason`. Both image modes require the same asset as a real `role="first_frame"` shot reference; a product/style image or analysis-only reference does not qualify. A previous-end anchor must continue the preceding process shot. Inspect the image before claiming it represents the required state. Text-only is supported with an explicit recommendation to strengthen the anchor; it is not proof of visual continuity.

Validation checks declared state consistency, supports, phase order and budget. It cannot infer whether a chosen support is physically appropriate or whether an unknown internal mechanism is real. `production_shot_prompts` carries this contract into compiled image/video direction. Boundary-image prompts describe their respective static states; they do not request the operation. If the compiled prompt is too large, simplify or split the plan instead of dropping constraints or silently truncating text.

## Budget one readable operation

### Separate the complete ledger from the current shot's prompt

Keep the complete object registry, product facts and state maps in the saved plan for continuity and acceptance. The provider-facing process description projects the objects visible at this boundary, objects changing in this operation, and their required supports. Unchanged hidden inventory stays in the ledger; it is not a list of components the model should introduce into this shot. A hold must preserve its current composition instead of beginning the next operation.

Author a shot-specific subject and readable states. Do not use the whole production's action summary as every shot's subject, and do not preview the next operation in the current ending. Inspect the compiled text as well as its structured direction: a full recipe, manufacturing sequence or list of future components can encourage the model to continue beyond the intended stopping point.

For a remake, `shot.productFactIndices` explicitly selects zero-based entries from `plan.remake.productFacts` for this shot's provider prompt. Omission retains all facts for compatibility; `[]` intentionally projects none of the global facts. Keep all facts in the canonical plan. Before using a subset or `[]`, map every applicable identity, color, marking, material or structural requirement into the current shot's state, or select its fact index. Video can additionally express facts through its requirement applications; first/last-frame image prompts need them in the corresponding state or selected facts. Never omit an actual user constraint merely to shorten a prompt. This selection does not alter source evidence, preparation binding, process validation or review obligations.

Give a shot one main visible change. List approach/preparation, contact or manipulation, completion and a settled result. Budget time for those stages and for the result to register. Camera motion and decoration must not obscure the contact point or substitute for the action. The number of adjectives or stages is not proof that a model can execute them in the available clip.

Opening a box, removing a device, connecting a cable and powering it on are several operations. Split them, omit a step through a declared time jump, or deliberately stage a readable montage with separately anchored states. Do not compress independent transformations into a short continuous take simply because the provider offers that duration. Also distinguish “the component approaches” from “it contacts and stays attached.”

Set dose, count, stopping condition and completion evidence where relevant: one component inserted once; a bounded quantity poured until a visible level; a tool switched off before withdrawal. Avoid vague “more dynamic” repairs that increase activity without correcting the failed transition.

## Give each reference one responsibility

A finished-product photograph establishes appearance. It does **not** establish the starting inventory of an assembly shot, supply an earlier manufacturing state, or prove what the previous clip ended with. If the final product contains parts not yet installed, say which appearance properties are borrowed and which depicted assembly state must not be copied.

For high-risk state transitions, prepare and inspect a dedicated starting image, or use a reviewed previous end frame when its crop, timing and state suit the next operation. A frame showing a hand mid-withdrawal is not automatically a settled anchor. Use actual owned images with explicit roles through supported model inputs; never refer to an “approved first frame” that does not exist. A last-frame image helps only if the start/end pair has consistent identities, counts, orientation and plausible change. Boundary images do not themselves prove the intervening motion.

## Design the soundtrack and edit together

Choose an audio strategy for the complete film: one continuous music bed, deliberately continuous native audio, an authored multi-part soundtrack, or intentional silence. Retain useful native ambience/effects and decide how each clip's native music/dialogue will mix. Independently generated music tracks usually need an explicit replacement or transition plan; preserving them all at full gain is not a coherent soundtrack decision. Do not discard useful speech or action sounds merely to obtain one music bed.

Bind timing decisions to the actual chosen audio and its source interval. Record how each beat, accent or phrase boundary was found: direct listening, a measured analysis with its method, or a supplied cue sheet. BPM is optional. An approximate BPM is not an exact beat grid; a waveform peak or RMS change is not automatically a musical beat. Without listening or suitable analysis, keep beat timing unknown and describe only an intended rhythm. Never report a proposed cue as an observed beat.

Place important action events, not just cuts, near suitable sound cues: a latch clicks shut, a bottle meets the table, a dancer lands, a brand resolves. Preserve approach, contact and settle when trimming or retiming. Not every event must hit a beat. Leave room for visual comprehension, speech and musical phrasing. Use the actual downloaded clip lengths; provider-requested duration and actual duration can differ.

When the user requests sound review, listen to the rendered mix across every cut and the ending. Check conflicting music, loudness jumps, clipped effects, speech masking, unwanted silence and a deliberate ending or fade. Sampling images, reading an analysis report or measuring audio energy cannot certify these listening judgments. If audio is unavailable to the reviewer, record that limitation and leave it unknown; this does not block delivery or authorize an extra paid review.

### Save audio and ending intent

Use `plan.editing.version=1` with `audio` and/or `ending`. `audio.mode` is `shared_track`, `native` or `silent`. A shared track binds `assetId` and `sourceSha256`, `gain`, `allowNativeAudio`, `ending` (`resolve`, `fade_out`, `intentional_cut`, `silent`) and `endingReason`. Its `beatPoints` contain source-relative `timeMs`, `kind` (`beat`, `accent`, `phrase`), `provenance` (`manual`, `measured`) and a real `evidence` explanation. `syncPoints` target a `shotId` plus shot-relative `offsetMs`, `beatId`, `toleranceMs` and `description`. These are authored cues; MCP does not detect BPM or hear the action.

The current shared-track renderer starts the audio at zero. To use a later excerpt, first prepare/import that excerpt as its own owned asset and bind its hash with cues measured from the new asset's zero. There is no `sourceStartMs` field in this contract. A changed track, excerpt, mix policy or timing requires an updated plan; optional previous review no longer describes that changed mix.

`ending` names the final ordered `shotIds`, `strategy` (`product_brand`, `brand_card`, `other`), `productVisible`, optional `brandText`/`cta`, `minHoldMs` and `reason`. `minHoldMs` is the chosen minimum readable product/brand hold, not the entire action duration. A graphic-only scene cannot satisfy promised product visibility.

For example, this is an **editing fragment** for a desk-lamp ad with an existing `reveal` shot starting at 3000 ms. Replace the illustrative asset/hash and cue evidence with actual records; the timings are example authoring, not measurements:

```json
{
  "editing": {
    "version": 1,
    "audio": {
      "mode": "shared_track",
      "assetId": "owned-score-excerpt",
      "sourceSha256": "<actual 64-character sha256>",
      "gain": 0.2,
      "allowNativeAudio": false,
      "ending": "resolve",
      "endingReason": "The final musical phrase resolves under the lit lamp",
      "beatPoints": [{"id": "reveal-accent", "timeMs": 3200, "kind": "accent", "provenance": "manual", "evidence": "Replace with the actual listening observation and source cue"}],
      "syncPoints": [{"shotId": "reveal", "offsetMs": 200, "beatId": "reveal-accent", "toleranceMs": 100, "description": "The light reaches its stable illuminated state"}]
    },
    "ending": {
      "shotIds": ["reveal"],
      "strategy": "product_brand",
      "productVisible": true,
      "brandText": "<user-supplied brand>",
      "minHoldMs": 1600,
      "reason": "Keep the illuminated product and readable brand together after the action"
    }
  }
}
```

After saving, use `production_editing_preview {planId,expectedVersion,revisionId?}` to read the planned timeline and cue deltas. With a revision it also checks the actual composition against declared track, timing and ending constraints. It does not edit the cut, locate an event inside generated pixels, detect beats or accept sound quality. Observe the generated event, apply the edits, inspect/listen to the exact rendered revision only if the user requested that review.

## Earn the advertising ending

Start with the ad's intended outcome: awareness, product understanding, desire, or a specific supported action. Preserve the product's appeal and recognition through the ending. Consider a completed-product hold with brand overlay, a result/demo payoff, a presenter close or a separate brand card; choose what serves the brief. A logo card is not wrong by definition, but an abrupt product disappearance plus unfinished music often weakens the connection.

Plan a visible payoff, the product/brand relationship, readable text, and soundtrack resolution. Reserve enough actual on-screen time to read the chosen content; do not impose a universal duration. Finish assembly or demonstration before the reveal unless the creative concept explicitly requires overlap. Keep tools, excess fluid and decorative effects from hiding the features the ad is meant to sell.

Add exact brand lettering in editing when reliable text matters. A CTA is optional and must use true, applicable facts; do not invent an offer, URL, price, availability or product claim. A host-suggested slogan or ending remains a creative choice unless the user supplied it. If reviewing on user request, consider crop, safe space, legibility and audio ending together.

## Optional review of failure-prone events (only on user request)

Make acceptance criteria falsifiable before generation. “Premium,” “cinematic,” or “mouthwatering” can guide art direction but cannot replace checks such as “one component is installed once, remains supported and is not removed at the next cut.”

Inspect every planned operation around its preparation, first contact, manipulation, completion and settled result. Add samples where objects become occluded, pass behind tools, enter/leave frame or where a count/state changes. Dense samples from the last shot cannot establish correctness of an earlier operation. Compare adjacent end/start states and intentional time jumps. Verify that a clip labelled as a hold really contains no new operation before treating action review as not applicable.

Use the visual-review contract for evidence coverage and action intervals. Record specific failures: a duplicated component, premature completion, a support disappearing, wrong scale, a reset, or the absence of the required result. A missing observation stays unknown. Passing a schema, generating inspection images or completing enough samples never automatically passes semantic criteria. Review first-frame anchors, individual clips and the final edit separately; altered crops, speed, sound, text and endings can fail after good source clips were accepted.

For the exact `media_review.production` binding and plan-derived `qualityChecks`, follow [visual review](visual-review.md#optional-review-on-request). Read the returned obligations instead of substituting one generic “looks good” check. Source-clip acceptance and rendered-revision acceptance each need evidence for their own obligations.

When diagnosing a failed generation, first inspect the exact submitted prompt, references and timeline. Separate an authored contradiction, insufficient state reference, overloaded action budget, model deviation and edit-induced damage. Repair the smallest failed part. If attributing persistent failure to a model, compare repeated samples under controlled conditions with the same model/specifications and simpler action or stronger state anchors. Do not assign a model blame percentage or announce a capability ceiling from one take. Comparisons must stay within the requested scope and any explicit spending limits; do not start unrequested experiments.
