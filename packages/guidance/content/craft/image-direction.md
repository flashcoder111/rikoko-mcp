# Image direction

## Compose a useful image

<!-- director:image -->
Before the first visual plan or image prompt, design the picture: choose its capture language, distinctive character or product details, camera encounter, setting, palette, materials and light. Make a few coordinated choices: for example, a cream-shirt presenter beside a walnut counter, dark green tiles and side window light, with face and cup as the two visual centers. Decide what references to make or reuse: an important undesigned prop can come before a character image; supplied portraits/products already carry facts; a shared scene view can support a counterpart camera view. Write Capture, Person/Product, Shot and Setting as one picture, using only actual inputs. Read `rikoko_guide {topic:"craft/image-creation"}` before authoring new visual material for concrete production routes and worked prompts. Put chosen appearance, camera, starting pose and reference roles into the existing plan and image direction. Use only the changes the brief permits; retain accepted decisions and source-preserved composition. Reuse useful images or direct video where appropriate; no mandatory intermediate image or extra generation.
<!-- /director -->

Start from shot purpose. A wide composition can explain two subjects' relationship; a detail can show a contact point; a product beauty frame can make shape legible. Select the scale that communicates the event. Do not demand every object be equally prominent. Check whether foreground/background, eye lines and lighting lead attention to the intended change.

## Use evidence and reference responsibilities

Read the real reference pixels. State what should transfer and what should not: a character image can define identity while the scene defines clothing; a product photo can define geometry while a composition reference only supplies placement. Never transfer another product's logo or an old actor's appearance accidentally. Put those responsibilities in the existing references and target direction, with a short reason if a reference is declined.

When a source state contains both appearance and screen direction, author a target relation rather than copying the entire description. For a replacement, "target subject faces screen left toward partner" preserves a relationship without reintroducing old identity. For an abstract poster there may be no gaze or contact to check; say not applicable. For a surreal image, impossible geometry may be intentional, but it must support the stated idea.

## Make the starting state usable

Show the state before the main action, with physical access to the contact point and adequate space for the action. A closed container cannot simultaneously reveal its contents without an opening or deliberate cut. A hand holding an already completed assembly cannot establish its earlier construction. For a dialogue two-shot, leave believable space and mutually intelligible gaze; for a moving camera, consider what must remain coherent outside the initial crop.

Choose an existing usable frame, generate a stage frame, or use direct video according to the chosen method and model. Do not generate a still for every shot. First and last frames need compatible identity, aspect, scene geometry and lighting unless the intended transition explains their difference. An end frame depicts the settled result, not another operation. Check critical first/last images using the existing review contract and reuse unchanged evidence.

## Optional reference preparation

The following methods are adaptations of the user-provided private notes “画面生成操作笔记（2025.9–2026.10）”, summarized from the private “总爆款库”. The notes omit the original prompts, example videos and some image-only instructions; the author and original source material have not been independently verified here. They are external practitioner experience, not rikoko-tested model behavior. They are options to consider when useful, not mandatory steps or a claim that a particular model or interface can perform them.

### Identity, props and groups

When a recurring character depends on a distinctive prop or costume, try designing that item as a separate reference, then combine it with the intended person/body type and an existing style or wardrobe reference to prepare a character image. Specify the role of each supplied image and inspect the resulting face, clothing, prop and style. Reuse a suitable reviewed character image across shots; create additional views only if needed and consistent with the identity. Image composition or editing requires an actually available, compatible tool; no particular image model is compulsory.

For background crowds whose individuals do not need separate identities, a group reference showing shared clothing/style with varied faces and body types can be an economical option. Keep a separately identifiable lead reference when needed. A group image does not guarantee consistent individual faces, counts or placement; inspect the result and use separate references when the brief requires distinct individuals.

### Scene framing and role-separated inputs

If people appear crowded or their positions are hard to read, inspect whether the stage reference leaves them too small or gives excessive space to an irrelevant part of the scene. Try a tighter view in which useful landmarks such as a table, door or chair and the performers' available space are visible. For stacked spaces, such as a bridge and its underside or a car interior and exterior, use a clear image or diagram to identify the relevant level and positions. A wide shot may still be the right creative choice; adapt framing to the shot.

For a recreation where the user wants a particular composition, an actual extracted source frame may supply camera angle and placement, while the character reference supplies identity and the text describes the target scene. Assign only the intended properties to each input and inspect for unwanted source appearance. Source-frame composition is opt-in and does not replace any source-video delivery required by the selected workflow.

### Line-art layout as a targeted repair

When a usable continuation image preserves position and pose but its face or clothing conflicts with the reviewed character reference, consider deriving a simple line drawing that keeps only the needed body outlines, pose, placement and relevant landmarks. If the chosen interface supports the required combination of real inputs, supply the drawing for layout, the character image for appearance and the scene image for setting; identify each role in the compiled binding. Inspect the drawing before use: simplifying it can also lose essential contact, depth or orientation. Compare the output against the intended arrangement and identity. This is a troubleshooting experiment, not a guaranteed separation of reference influence; a clean previous frame may already be sufficient. Neither line-art creation nor multi-image input is implied by this guidance.

## Prepare references for the actual shot

These are optional production methods, not guarantees. The workflows in [ComfyUI's ControlNet examples](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/controlnet/README.md), the [2D character pose workflow](https://github.com/mor-o/comfyui-2d-character-pipeline/blob/main/docs/workflow-1-pose-edit.md), and [Qwen FrameKit](https://github.com/uron83/ComfyUI-Qwen-FrameKit) inform the separation of image responsibilities below. Presenter starting states and two-view relationships also adapt the locally available historical Hypit image-direction and reference-relationships manuals; their model-specific claims were not independently reproduced. Their specific preprocessors, models and LoRAs are not assumed available in rikoko or validated on its models. Examples here are authored adaptations; no new generation trials were run.

### A presenter who can continue into video

1. Decide whom the person addresses: the viewer, a partner, or someone off camera. Choose a starting gaze, expression and hand position appropriate to that encounter.
2. Frame the face and any hand or product needed for the next action; leave space for the movement and planned captions without making the subject unreadably small.
3. For continuing speech, a relaxed expression or a gesture already in progress can be useful; keep a specific laugh or surprised expression when that instant is the requested shot. Do not force a neutral face.
4. Inspect the actual starting image for identity, gaze, posture, hands, product and available movement space. The still describes the starting state; video direction describes the subsequent change. A usable still does not prove the performance will succeed.

### Two views of the same conversation or location

1. Map people, table, door, window, lights and other relevant landmarks on a simple sketch or in words. Record who faces whom and where each camera is placed; this need not be a generated image.
2. Use the actual character references for identity and an appropriate scene reference for place. Prepare the first view with readable gaze and interaction; for the reverse view, change camera position while retaining the intended seating, eyelines, light and prop relationships.
3. Compare both views: left/right positions relative to each camera, eye contact, microphone or hand entry, wardrobe and recognizable landmarks. The second camera can see a different wall; identical background pixels are not required. An intentional axis change is valid when the shot plan calls for it.
4. If the other view changes the person's face, compare the exact supplied reference and its role before altering the scene. If a door or table jumps, correct the spatial layout or use a clearer scene reference. If identity or layout remains unknown, record it instead of declaring continuity.

### Change pose, camera or depth without changing everything

1. Say which property should change and which must remain: for example, the camera moves to a three-quarter view while the person's identity, pose and clothing remain. A person turning is a different action from a moving camera.
2. When available, use a reviewed character or product image for appearance and a separate layout or pose reference for position. A pose skeleton expresses joints; a depth map expresses relative depth; an edge or line drawing expresses outlines; a mask identifies an area. None by itself guarantees identity, contact or physical correctness.
3. Verify the chosen tool actually accepts the required input and combination; a normal photograph is not automatically converted to a pose, depth or edge map. If a control input is unsupported, use a compatible available reference or describe the arrangement and acknowledge less control. Do not invent provider parameters.
4. Prefer changing one major factor at a time when diagnosing a failure. Inspect face or product markings, clothes, landmarks, hand/foot support, occlusion and light after each change. A newly generated back or hidden side is inferred appearance, not evidence of an unseen real feature.

## Diagnose and repair a visual failure

First inspect the actual image or relevant video interval against the intended shot. Separate a known defect from an unobserved cause. Preserve usable images, clips and prior versions; a failure does not authorize a new paid request. Make only the user's requested repair or one covered by an explicit remaining repair allowance. After a repair, compare the changed area and intended unchanged facts; record pass, fail or unknown from the evidence actually seen.

| Observed problem | First checks and possible adjustment | Recheck |
| --- | --- | --- |
| Face or clothing changes between shots | Compare the exact identity image and reference roles with the new output. If the continuation frame conflicts with the identity image, try a cleaner frame or, where supported, a simplified layout reference; retain the reviewed identity reference. Do not claim a seed or reference guarantees identity. | Face, hair, clothing and distinctive details against the actual reference; layout against the intended shot. |
| Person is too small or cropped | Inspect original framing and final aspect/crop. Tighten the shot or adjust framing while keeping hands, action and text space needed for the work; an intentional wide shot may remain wide. A crop cannot recover missing pixels. | Face readability, edges, needed limbs and caption clearance in the final framing. |
| Pose or hand-to-object contact is wrong | Check whether the initial image shows reachable hands, object, support and space. Simplify or clarify the requested movement only if allowed by the brief; a supported pose/layout reference may help. | Joints, grip, contact point, object shape and support at initiation, contact and settled result. |
| Left/right, depth or room changes | Compare camera position, gaze and landmarks, not just matching background pixels. Revise the layout or use a clearer scene reference; consider a supported depth or layout input when the problem is front/back ordering. | Both shot views, screen direction, occlusion, relative scale and light; flag intentional axis changes. |
| Image looks static in video | Check that the first frame permits the desired movement and that the motion direction specifies a visible action, its endpoint and any relevant camera movement. Environmental response can help when appropriate; do not add unrequested action. | Observe the actual interval for initiation, motion and result; a single frame cannot establish continuous motion. |
| Only a hand, face or object edge is defective | If an actual compatible local or provider edit is available, select the defect and the contact/edge context that must change. Specify what to preserve; inspect the resulting seam and unchanged surroundings. Otherwise report the capability gap or use an available alternative. | Identity, shape, contact shadow, lighting and boundaries; for video also inspect motion and mask tracking over the affected interval. |

Cropping only removes pixels outside a rectangle; it is not segmentation, inpainting or background removal. Video masks, pose/depth extraction, local repainting and camera-angle controls are optional techniques, not claims that a currently selected rikoko profile exposes them. [SAM 2](https://github.com/facebookresearch/sam2) illustrates segmentation and [Wan 2.1 VACE](https://github.com/Wan-Video/Wan2.1#run-vace) illustrates a separate masked-video editing workflow; segmentation alone does not perform the edit.

## Typography and output checks

Separate later captions and graphics from words physically present in a scene. Reserve safe space for captions without shrinking the real subject to a decorative background. Use controlled editing for exact lettering where available. If scene text is generated, inspect its actual legibility and do not treat a successful prompt as proof of spelling.

Generate at the intended aspect. A crop changes what the viewer can understand; examine important edges, hands, count, support/contact and caption clearance in the final framing. Compare observed pixels to the intended use. Record defects or unknowns, keep usable media, and locate whether a local crop/edit can fix the issue. No automatic paid review or regeneration follows from a failed check.

Use generation_prompt_preview and production_shot_prompts for exact input and boundary drafts. These do not prove visual success or that a model natively controls every requested relation. Follow the actual installed model's supported inputs; do not invent parameters or promise unverified capabilities.
