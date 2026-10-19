# Directing examples for target shots

Use these examples to author the saved plan's action, states, camera and acceptance criteria. They are prose patterns, not extra API fields or replacements for the compiled prompt. Adapt them to observed evidence and user facts. For a remake, revise the plan and recompile instead of pasting an alternate prompt into a prepared operation.

## Make the operation visible

“Premium product, cinematic, dynamic, realistic” describes an appearance but gives no action to reproduce. A useful shot describes a visible change:

> In one fixed close view, the right hand approaches the closed box, grips the lid, lifts it clear of the base and places it beside the box. The base remains on the table. End with the opening unobstructed and the lid resting separately. Keep both the grip and the opening inside the frame; hold the completed state briefly.

In the plan, initial states are object maps such as `{"box":"closed on the table","lid":"attached to box"}`. Action stages contain approach, grip, lift and placement in order. End states identify the same objects. Acceptance asks whether the lid actually detached and rested beside the base; a hand waving above a still-closed box fails. This example is appropriate only when the actual product opens this way.

Describe one main operation per shot. Split opening, pouring and serving when they cannot remain readable in one supported clip. Carry the previous shot's settled state into the next, or explicitly explain an intentional cut/time jump. A request for a 15-second edited film does not require three identical five-second generations.

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
| Hand moves but the lid never opens | Clarify contact, detachment and settled end state; check reference compatibility. Reject that take rather than call it completed. |
| Action completes outside the final crop | Adjust framing or a supported aspect/crop policy; inspect the rendered crop again. |
| Cut removes the completed result | Keep the accepted action and hold, extend the edit or moderately retime the complete take; no generation is needed if the existing clip contains the result. |
| Source sequence contains an unseen transition | Keep it unknown, inspect the source further, or choose an explicitly justified target adaptation. Never invent evidence to fill the gap. |
| Captions or voice changed after acceptance | Reuse the visuals, render the affected edit and inspect the new revision. Prior revision acceptance does not transfer. |

Before any paid retry, identify the failed criterion and the smallest change expected to fix it. Obtain a fresh quote/agreement for changed generation inputs. Preserve accepted shots. If the same failure persists, stop dependent generation and report the unresolved limitation rather than purchasing repeated identical attempts.
