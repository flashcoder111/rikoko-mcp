# Seedance 2.0 Mini: write for the actual input mode

This entry covers the registered `seedance-mini-*` profiles and platform `web-seeapi-seedance-mini-*` profiles listed in catalog scope. SeeAPI calls the model `seedance-2-mini`. Its API documents text, first/optional-last frame and reference generation. Provider schemas and the selected rikoko profile decide input support; this guide does not expand it. [SeeAPI text](https://www.seeapi.com/docs/seedance-2-mini/text-to-video/), [frames](https://www.seeapi.com/docs/seedance-2-mini/image-to-video/), [references](https://www.seeapi.com/docs/seedance-2-mini/reference-to-video/).

Use only after the current model policy resolves the task. Faces or unknown face status remain ineligible for Seedance in rikoko. Use a compatible selected MiniMax/Kling profile for visible presenters; a public model example containing a person does not override that policy.

## What the online examples teach

ByteDance's Seedance 2.0 guide separates extracting reference qualities, editing source content and extending footage. Its camera-product example uses several product views and a controlled reveal; its reference assignments distinguish subject, setting and motion. Adopt that separation, naming exactly what each asset contributes. The guide is family-level evidence, not a Mini-specific success measurement. [Official 2.0 guide, updated September 22, 2026](https://docs.volcengine.com/docs/ark/seedance-2-0-prompt-guide?lang=zh).

The launch showcase also demonstrates giving a storyboard, subject, location and props different responsibilities. That is useful for planning a product ad without making every image compete to define the entire scene. Its published results belong to Seedance 2.0; they do not establish Mini parity. [ByteDance launch examples](https://seed.bytedance.com/en/blog/seedance-2-0-official-launch).

## Mode-specific writing

| Actual mode | What to write | What must already be bound |
| --- | --- | --- |
| `text_to_video` | Subject, opening arrangement, one intelligible action, camera behavior, material/light, ending state | No imaginary image references |
| `image_to_video` | How the visible starting state changes; keep geometry and motion compatible | The reviewed first-frame asset |
| `first_last_frame` | A plausible operation connecting the two states, including the intermediate contact and settling | Both actual frames; prose does not supply a missing endpoint |
| `reference_to_video` | Per-asset role, retained properties, changed properties, target action and rhythm | Actual image/video bindings in their delivered order |

rikoko's Seedance reference compiler emits `@Image1`, `@Video1`, with separate numbering per modality. The fal Mini reference schema documents these tokens. Use the compiled binding order and `referenceDelivery`; do not copy Chinese UI labels or guessed numbers into a different adapter. [fal Mini reference schema](https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video/api). SeeAPI exposes more reference types than the current platform profile binds: its public audio-reference field is not evidence that rikoko transmits an audio asset.

## Authored example A: one first-frame operation

Input: a reviewed, face-free frame of a closed desk stand with its hinge visible. Requested duration must fit the action; six seconds below is a planning example, not a timestamp guarantee.

> The folded stand rests flat on the desk. A hand enters from the right, holds the base, and raises the support arm until it reaches its stop. The hand releases the arm and leaves the frame. The stand remains open. Keep the camera fixed at the starting three-quarter view, with the hinge visible throughout. Soft daylight reveals the matte surface. Leave the final open state still and readable.

Write the actual sound intention separately if enabled. A native sound option does not ensure the desired click, and silent footage is appropriate when narration will be edited over it.

## Authored example B: product and motion references

Assume `@Image1` is a solid soap bar and `@Video1` is a face-free bottle ad with a slow push and a liquid splash. The new direction borrows the reveal rhythm, not the liquid behavior:

> @Image1 defines the bar's rectangular shape, embossed mark and pale green material. Use @Video1 for the slow push-in and the pause before the final reveal. Stage the bar dry on a stone tray. A broad side light gradually reveals its embossed surface as the camera advances a short distance, then holds. The bar remains solid and stationary throughout. Keep the tray's contact shadow attached to its base.

These examples are original applications of the sourced methods, not copied prompts or verified Mini generations. Their reference names require real matching assets. Keep exact campaign graphics outside generation; if source captions conflict with the new work, decide on source cleanup or reframing before compilation. No negative phrase guarantees text removal.

## Apply in rikoko

Record the target state/action/camera and references in the saved plan, then compile with the actual model and input mode. Preview before preparation; do not bypass the compiler with a pasted sample. Reference generation, strict source editing and extension are different intentions, and a general reference endpoint is not a guarantee of pixel-preserving edits or native extension.

Inspect material shape and branding in frames; observe the operation and settling in motion; listen only when sound is available. Never treat a family-level showcase, a prompt read, or a prepared payload as proof of the resulting behavior.

Sources reviewed 2026-10-27. Evidence: official provider contracts, Seedance 2.0 family guidance and original adaptations. No new rikoko trials; no Seedance 2.5-only features or syntax are assumed.
