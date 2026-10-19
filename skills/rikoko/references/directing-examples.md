# Directing examples for target shots

Use these examples to author the saved plan's action, states, camera and acceptance criteria. They are prose patterns, not extra API fields or replacements for the compiled prompt. Adapt them to observed evidence and user facts. For a remake, revise the plan and recompile instead of pasting an alternate prompt into a prepared operation.

## Make the operation visible

“Premium product, cinematic, dynamic, realistic” describes an appearance but gives no action to reproduce. A useful shot describes a visible change:

> In one fixed close view, the right hand approaches the closed box, grips the lid, lifts it clear of the base and places it beside the box. The base remains on the table. End with the opening unobstructed and the lid resting separately. Keep both the grip and the opening inside the frame; hold the completed state briefly.

In the plan, initial states are object maps such as `{"box":"closed on the table","lid":"attached to box"}`. Action stages contain approach, grip, lift and placement in order. End states identify the same objects. Acceptance asks whether the lid actually detached and rested beside the base; a hand waving above a still-closed box fails. This example is appropriate only when the actual product opens this way.

Describe one main operation per shot. Split opening, pouring and serving when they cannot remain readable in one supported clip. Carry the previous shot's settled state into the next, or explicitly explain an intentional cut/time jump. A request for a 15-second edited film does not require three identical five-second generations.

## Preserve inventory and support

> One glass rests on the counter, already holding ice. A single pitcher approaches from the right, pours a small measured amount until the liquid reaches the marked level, stops, and withdraws. The glass and ice remain in place. End with the same glass filled to that level; no second glass or additional ice appears.

The state ledger distinguishes the glass, existing ice, pitcher and liquid. The operation adds liquid once; it does not repeat the earlier ice placement. Budget approach, stream/contact, stop and settle. If the next shot shows a garnish already present, declare an intentional time jump for garnishing and establish that state in its first frame. Do not call ice hidden by the drink absent.

> The cabinet door remains open. One brass hinge is already fixed to the frame. The worker inserts a single pin through the aligned hinge, seats it once, then removes the tool. The door remains supported throughout; the fitted hinge does not detach or multiply.

This shot requires the actual product to use that mechanism. A finished cabinet photograph can guide finish and hardware appearance, but it does not prove that an unfinished hinge should already be complete. Use a checked intermediate-state image if the operation depends on a precise arrangement. Acceptance checks insertion, support and the persistent final state, not just a moving tool.

## Separate action timing from clip length

For a dancer's landing or a machine latch closing, choose a cue in the actual soundtrack and aim the completion event at it. The lead-in still needs time to make the action readable, and the end still needs the intended settle. Write planned timing as a target; measure the generated event before selecting trims or speed. A four-second request may return a longer file. Do not concatenate full output durations and then claim their cuts match a reference beat grid.

If the cue came from listening, record it as a manual cue with its source track and time. If a detector supplied it, retain its method and uncertainty. Audio-energy peaks do not establish musical beats; do not fabricate BPM to justify a cut. Review the final mix by listening.

## Give an advertisement a visible payoff

For a repair-service ad, the ending might show the demonstrated working result with the service name and a supported booking address. For a fragrance ad, it might hold the bottle and packaging with a restrained brand overlay, then resolve the music. A separate wordmark card may work when deliberately connected to the product reveal. None of these choices follows automatically from “show the brand at the end.”

State the chosen product/brand relationship, readable hold and sound ending in the target plan. Keep a suggested slogan or shot count identified as a host decision. Do not invent discounts, claims or contact details. Accurate lettering usually belongs in the edit rather than the generated product scene. See [production quality](production-quality.md) for the full process and ending checklist.

## Choose the generation mode by input responsibility

| Mode | Prose pattern to express in the plan/direction |
| --- | --- |
| First frame | Start from this visible state. The subject performs the ordered action. Keep identity, geometry and light stable; end on the completed result. Do not restate a beauty shot as an action. |
| First + last frame | Begin at the supplied starting state and reach the supplied ending state through a plausible continuous operation. Check the two images agree on identity, object count, orientation and space before paying for motion. |
| Appearance references | Preserve the named product/character facts from their assigned images. Stage the target action in the requested scene. A style image supplies only its declared lighting/color properties. |
| Action transfer | Transfer this specific motion sequence and rhythm to the target subject; explicitly exclude the source identity, background and incompatible object behavior. The reference must contain the same kind of operation. |
| Camera transfer | Move the camera along the assigned path while the target performs its separately authored action. Exclude the source subject's motion and appearance. |
| Existing-video edit | Change the named visual property in the actual source video while preserving specified actions, timing and unaffected subjects. Use only the selected profile's supported controls. |

Let `production_shot_prompts` / `generation_prompt_preview` supply model-specific reference syntax. MiniMax uses descriptive first/last-frame language; Kling uses numbered tokens in the returned binding order. A prose motion instruction does not create a motion-reference input or expand a model's supported modes.

## Give image and video stages different jobs

The first image establishes the **pre-action** arrangement: a closed box and an approaching hand, with room for the opening. The last image, when needed, depicts the settled result. The video describes the transition. Asking the first-frame image to show “opening and fully opened” produces contradictory states.

Frame for the operation: allow room above the lid, keep contact points legible, and reserve caption space outside the important action. Use the target product's supported facts. Do not copy a source logo, hidden mechanism or detachable component onto a different product without evidence.

## Repair from the observed failure

| Observation | Next useful change |
| --- | --- |
| Product shape changes during contact | Inspect boundary images and contact samples; correct identity/geometry facts or simplify that operation in the plan. |
| A completed step is repeated or a component appears early | Check the submitted start/end ledger and reference roles; remove contradictory finished-state conditioning, or supply a checked intermediate-state anchor. |
| An object floats, changes scale or loses support | Identify the missing support/contact constraint and inspect the transition; reject impossible motion rather than accepting a plausible last frame. |
| Hand moves but the lid never opens | Clarify contact, detachment and settled end state; check reference compatibility. Reject that take rather than call it completed. |
| Action completes outside the final crop | Adjust framing or a supported aspect/crop policy; inspect the rendered crop again. |
| Cut removes the completed result | Keep the accepted action and hold, extend the edit or moderately retime the complete take; no generation is needed if the existing clip contains the result. |
| Source sequence contains an unseen transition | Keep it unknown, inspect the source further, or choose an explicitly justified target adaptation. Never invent evidence to fill the gap. |
| Captions or voice changed after acceptance | Reuse the visuals, render the affected edit and inspect the new revision. Prior revision acceptance does not transfer. |
| Sound jumps or the brand ending feels disconnected | Inspect the source/mix choices and listen to the rendered cuts; revise the common music bed, cue timing or ending hold without regenerating accepted visuals unnecessarily. |

Paid quality retries require explicit user instruction or an explicit remaining repair allowance; a general production request is not such an allowance. Before an authorized paid retry, identify the failed criterion and the smallest change expected to fix it. Prepare changed inputs again and submit only the smallest repair within the requested scope and spending limits; do not add a separate price-confirmation step. Preserve accepted shots. If the same failure persists, stop dependent generation and report the unresolved limitation rather than purchasing repeated identical attempts.

Failure diagnosis below is for user-requested review/repair, not an automatic post-generation audit. Deliver technically valid output directly; check only critical images once by default.
