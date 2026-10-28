# Design and make the first picture

Use this before authoring the first images or visual plan for new material. Make concrete decisions about the picture's character, capture language, composition, palette, light and useful starting pose. Then choose the smallest useful set of references and make the pictures the production needs. An existing image or direct video may already serve the work.

Read `craft/image-direction` for reference responsibilities and boundary states, and the actual model's writing guide for supported inputs. Apply creative choices within the user's brief: a faithful source edit inherits preserved framing, action and styling. This guide adds no approval step, mandatory intermediate image, review loop or generation authorization.

## Decide what makes this picture particular

Choose a few visible anchors that work together. For a person these might be a distinctive haircut, a garment, their relaxed relationship to a table and a deliberate palette. For a product they might be its defining silhouette, material and the way a person uses it. Preserve supplied identities, product facts and brand choices; author only what the brief leaves open.

| Decision | Turn it into something visible |
| --- | --- |
| Attention | Decide whether the face, a gesture, an object or the whole environment should be noticed first. Let scale, placement, contrast and light support that choice. |
| Capture language | Choose phone-recorded everyday footage, studio product photography, a film scene, illustration or another coherent direction. Specify the relevant surface texture, depth and light rather than piling on quality adjectives. |
| Person | Choose an appearance and presence appropriate to this work: age, hair, wardrobe, silhouette and one or two distinctive features. A supplied portrait can already establish these. Appeal can come from charm, character, confidence, humor or unusual styling; no universal beauty template. |
| Camera encounter | Decide shot size, camera height, face/body angle, whom the person addresses and which hands or objects must be visible. Offset framing can relate a face to a table, partner, doorway or product. |
| Place | Name a recognizable location and a few objects that explain why the person belongs there. A nearby object, subject and distant opening can establish depth. |
| Palette and material | Give architecture, clothes and props different color roles. Choose actual materials and how light reveals them. Keep factual product colors intact. |
| Continuing state | Give the next video moment somewhere to start: an available hand, readable gaze, room to raise a cup, or a deliberate reaction already underway. |

For example, "a premium cafe with cinematic atmosphere" leaves most choices to the model. "A coffee maker in a cream shirt at a walnut counter, dark green tiles behind her, soft window light reaching the ceramic cup" supplies coordinated visible decisions. Both deep-focus phone footage and a shallow-focus portrait can be appropriate; choose for the intended picture.

## Write one picture in four parts

For a person in a place, organize the direction around **Capture, Person, Shot and Setting**. These are responsibilities, not four required paragraphs or an attribute form.

- **Capture:** the kind of photograph or rendering, the surface texture and lighting character that matter.
- **Person or product:** the identity, appearance and defining details, using actual references for facts already available.
- **Shot:** the camera encounter, placement, gaze, present pose and physical relationships. Describe the still's current state; leave the ensuing action for video direction.
- **Setting:** the place, meaningful objects, depth, palette and any visible light source essential to the scene.

Write references into that picture by responsibility: an identity portrait supplies the person; a room view supplies the location; the new direction supplies the chosen camera and action. Use only connected images and the actual model's reference syntax. Set aspect ratio and resolution through supported parameters. Translate deliberate choices into the existing plan's `creativeChoices`, shot `camera`, `initialState`, reference instructions and image direction; they are director decisions, not invented user requirements. For video, `sceneDirection` describes the subsequent visible passage.

## Produce the references the shot needs

| Material | When to make it | What to show | What can use it next |
| --- | --- | --- | --- |
| Character image | A recurring character needs a stable visible design and suitable source images are absent | Readable face, hair, wardrobe, body silhouette and defining accessories | A new view, location or video that needs those identity facts |
| Prop or costume design | The object's design is important and has not been supplied | Form, material, color, meaningful details and how it is held or worn | A character image combining the person and the object |
| Group reference | Supporting characters share a world but do not need separately fixed identities | Shared costume/style with varied faces, silhouettes and clothing details | Crowd styling; an individually identifiable lead may use a separate image |
| Scene reference | A location or spatial arrangement matters across views | Useful landmarks, surfaces, palette, light and actual space for the performers | Multiple camera views of the same place |
| Shot image | The selected video route benefits from a specific starting pose and composition | The people and objects arranged for this shot, with the intended camera and starting interaction | A supported image-to-video or reference workflow |

### Route A: design a character around a prop

1. Choose the visual world and the character's defining object: for example, a silver half-mask in a grounded fantasy setting. If the user already supplied its design, use it.
2. When design is needed, make the object image first. Show the silhouette, finish, attachment or grip and the details important to its use.
3. Combine the actual object reference with the intended person and any wardrobe/style reference in a compatible image tool. Direct how the mask fits the face or how the hand holds the object. This character image carries the assembled appearance into later views.
4. Make a separate location image only when the environment needs its own design. Compose the shot from the relevant character and location facts; do not generate a full asset library for a single simple picture.

### Route B: place a supplied person or product

Use the supplied identity or product image as the factual anchor. Decide the new camera, pose and setting within the requested changes. An existing room photo can supply architecture and palette; text may suffice for a new generic setting. A product-in-hand picture should show the actual holding relationship. An exact title or movable graphic can be composed separately with available editing tools; a phone or sign inside the scene has a different physical role.

### Route C: derive the other view of a conversation

First make a useful person-in-place view, or use an existing one. Establish the table, seats, gaze relationship and microphone direction. For the counterpart, carry that location's materials, palette and spatial relationship while directing the other person's identity and camera view. The new camera can see another wall or sector of the restaurant; it does not need a mirrored background.

A later product-holding variant should derive from that same speaker's camera view plus the actual product reference. A new location can branch from the identity image when the earlier room contributes nothing. Reference relationships follow what each image knows; they need not form a chain of every previous output or follow editing order.

### Route D: use an existing reference composition or performance

An actual source frame can supply the desired camera and placement, while a separate portrait supplies the new identity. Declare only the intended transferred properties. When an exact movement, contact sequence, performance rhythm or camera path matters, the relevant footage carries temporal information a still cannot. Use the runtime's source-video contract and a compatible model; do not simplify preserved actions to make a still easier to draw.

## Worked example: coffee presenter

**Purpose and design.** A warm, everyday introduction to a cup of coffee. The face is the first visual focus, the cup the second. Choose a vertical medium-close view with the presenter on the right, walnut counter and cup at lower left, dark green tiles behind, and cream clothing against the darker environment. Soft side window light reveals the cup surface. One hand rests near the cup and the other is free to gesture.

**Inputs and order.** Use an actual portrait if identity is supplied, and a cafe photo only if this must be a particular cafe. A text-only original can establish person and place together. No separate character or location generation is necessary just to satisfy this example.

**Authored still direction, not a tested prompt:**

> A vertical frame with the natural texture of a phone-recorded cafe visit. Use the supplied portrait for the presenter's identity and the supplied cafe view for its architecture. She wears a cream shirt and dark apron, standing on the right in a medium-close view, looking toward the lens with relaxed interest. Her face, shoulders and hands are visible. One hand rests beside a ceramic coffee cup on the walnut counter at lower left; the other is relaxed with room to gesture. Dark green tiles, a wooden shelf and a window establish the cafe behind her. Soft light enters from the left and catches the cup's rim.

Omit references that do not exist and supply authorized fictional descriptions instead. **Into video:** she addresses the viewer and gently indicates the cup when the adopted dialogue mentions it. The cup remains on the counter. Author the words, duration and vocal intention for the actual request, rather than inventing claims about the coffee.

## Worked example: two restaurant speakers

**Purpose and design.** An informal conversation in a restaurant with dark wood, warm architectural accents and plants. A sits on the right of her view and looks left toward B; B sits on the left of his view and looks right toward A. A table between them and microphones entering from the partner's side support the encounter.

**Inputs and order.** If real people are specified, use their respective portraits. Produce A's view with the restaurant and table; use it as the shared-place reference for B's view while B's portrait supplies his identity. If both useful views already exist, reuse them.

**Authored counterpart direction, not a tested prompt:**

> Use A's restaurant view for the shared space, wood surfaces, warm accents and natural light. Use B's portrait for B's identity and wardrobe. Make B's complementary medium-close camera view: he sits on the left, turned toward the right and looking at his partner outside the frame, with his face clearly visible. The microphone enters from the right and the table lies between the two seats. This camera looks toward another part of the same restaurant, showing the furniture and background available from B's camera position.

**Optional product view.** Derive B holding a phone from B's image plus the actual product graphic. Describe which hand on the viewer's left or right holds the phone and where it is directed. Use compatible tools for the actual inputs. **Into video:** direct each speaker's response and listener relationship; the images establish the world, not a mandatory shot count or sequence.

## Worked example: a masked character enters a hall

**Purpose and design.** A grounded fantasy character with a silver half-mask, short hair and a dark coat enters a stone hall. Gray stone and warm wall lamps establish the environment; the silver mask gives the character a distinct accent. The shot can favor the character or the hall according to the brief.

**Inputs and order.** When no designs exist, make the half-mask first, then a character image showing the mask fitted to the face and its relation to the collar. Make a hall image with a usable doorway and walking space if that environment needs repeated views. Compose the starting shot using character and hall references in a compatible tool.

**Authored starting direction, not a tested prompt:**

> Carry the character's face, silver half-mask and dark coat from the character reference. Use the hall reference for gray stone, warm wall lamps and high narrow windows. From just inside the doorway, at a slightly low camera position, show the character at the entrance facing into the hall. Let the doorway frame the figure, with visible floor space in the direction of travel and a distant arch giving depth. The silver mask catches the side light while the dark coat remains distinct from the stone.

**Into video:** describe the walk into the room and whether the camera stays or follows. Keep any user-required continuous action intact; select the supported input route and duration accordingly.

## Provenance and scope

This guide adapts the local historical Hypit manuals `references/playbooks/craft/image-direction.md`, `generated-dependencies.md` and their `examples/image-direction.md` and `examples/conversation-images.md`, plus the user-provided secondary notes “画面生成操作笔记（2025.9–2026.10）” from the private “总爆款库”. The latter omit original prompts, example videos and some image-only steps. The local synthesis is titled “AI 导演画面创作手册：从视觉构思到可用首图” (2026-10-28). No private access links or source-image copies are included.

The four-part picture method and branching conversation views adapt the historical manuals; prop-to-character, group and separate scene preparation also draw on the secondary notes. All worked examples and prompt prose above are newly authored applications, not copied source prompts or generated results. The historical manuals' model-specific capture kits and the notes' model preferences are not universal settings. Use their creative methods without claiming measured success, supported tools or newly tested model behavior. This guide does not change the configured default model, existing preservation rules, budget or frozen requests.
