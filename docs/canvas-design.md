# Canvas Design
## The Reference Implementation of the Interaction System

**Date:** 2026-05-11
**Status:** Workshop draft — not yet implementation-ready. Resolve open questions before touching frontend code.
**Parent doc:** `docs/allocutio-interaction-design.md`
**Vision ceiling:** `docs/plans/2026-05-06-stationthis-launchpad-vision.md`

---

## What This Document Is

The canvas is the most capable surface — it surfaces every capability the system has. Getting the canvas right means getting the vocabulary right. Every decision made here propagates to Telegram, Discord, REST, and every other surface. Design the canvas first; the other surfaces follow.

The canvas is not a new concept. It builds directly on canvas v2 (`src/platforms/web/frontend/src/sandbox/canvas2/`), which achieved something genuinely useful. This document describes the refinements and rethinking needed to reach the clean-room design, not a ground-up rewrite.

---

## Visual Reference: ComfyUI

The canvas takes ComfyUI as its visual inspiration. Our execution model maps directly to ComfyUI workflows — our Nodes wrap ComfyUI graphs internally. Power users already speak the visual language. We refine it rather than invent a new one.

**What we take from ComfyUI:**
- Dark canvas background
- Rectangular nodes with rounded corners
- Input ports on the left edge, output ports on the right edge
- Bezier curve wires colored by data type
- Flow reads left → right: sources on the left, terminal Node on the right
- Dense, readable node cards with inline parameter fields

**What we improve:**
- User-facing names on Nodes, not internal ComfyUI node names
- Surface navigation — ComfyUI is one infinite flat canvas
- Group regions — connected-component bounding boxes with type coloring
- Superposition anchors — pop-out inline Value behavior
- Beckoning entry point — canonical surfaces that look like tools, not editors
- Mobile support — touch gestures, swipe, hold-tap

---

## Outer Shell

### Desktop nav (top bar)
```
[Wordmark]   [Workspace]   [Models]   [Flows]   [Account ▾]
```

### Mobile nav (bottom bar — primary design target)
```
[ Chat ]  [ Workspace ]  [ Gallery ]  [ Flows ]  [ Account ]
```

**Design is mobile-first.** Desktop is the worked-backwards form. Every component must work on a phone screen before it works on a large canvas.

---

**Chat** — the user's persistent relationship with their personal agent (concierge). Belongs to the **Anima**, not to a Workspace. It knows all workspaces, all history, all Vestigia. Continuous across sessions and across workspaces. On mobile this is the **default landing screen** — the agent greets the user, already knows their last session and saved flows. Executions triggered from chat appear as rich result cards inline in the thread. New users are guided toward their first generation through conversation, not through learning the canvas.

**Workspace** — the current canvas with its surfaces. The surface tab strip, nodes, and all visual building lives here. Workspace switching happens from within this tab.

**Gallery** — global output history across all workspaces, all surfaces, all time. Grid of all Acta ever created — chat executions, canvas executions, agent-triggered executions. Filterable by workspace, surface, flow type, date. Tap into detail: save, share, mint, remix, version history via swipe. The bottom nav Gallery is global. A local shortcut (the `[🖼]` anchor on the surface tab strip) shows outputs for the current workspace only.

**Models** — asset library (desktop nav only at first): LoRAs, checkpoints, embeddings.

**Flows** — executable catalog: canonical platform flows, personal minted, community published.

**Account ▾** / **Account** — settings, wallet, identity, sign out.

The distinction Chat / Workspace is the core UX duality: Chat is the conversational entry point (familiar, guided, agent-assisted), Workspace is the power mode (visual, spatial, full control). They are genuinely parallel — neither contains the other. A user can use the product entirely through Chat and never open the canvas.

---

## Workspace & Surface Model

```
Workspace  →  one or more named Surfaces
Surface    →  a named group of Nodes and their connections
Node       →  atomic execution unit — an instance of a Flow on a Surface
```

### Surfaces

A Surface is a named working area within a Workspace. The user cycles between Surfaces via a horizontal tab strip anchored to the top of the canvas area.

```
[make] [effect] [edit] [direct] [animate] [caption] [compose] [utilities]  [+]
```

- Scrollable/swipeable horizontally if surfaces overflow
- Current surface is visually highlighted
- `+` at the end: on HOME workspace, creates a new Workspace (with confirmation warning); on personal workspaces, adds a new blank Surface

**Navigation tiers:**
1. **Workspace view** — overview of all surfaces (future: surface thumbnails)
2. **Surface view** — the canvas for one surface, nodes and connections
3. **Node view** — focused single node: parameter panel, execution, result, mint

### The HOME Workspace

Every new account receives a HOME Workspace on first visit, pre-populated with canonical Surfaces — one per transformation type. HOME is the user's preference configuration surface: the canonical Node on each Surface is the platform default, the user configures it to their preference.

The canonical Node on each HOME surface is **anchored** — it can be configured, wired, and minted from, but not deleted. Supporting nodes (Value, Media, Transform, Context) can be freely added around it. Personal Workspaces are fully open.

Hitting `+` from HOME mints a new personal Workspace, drops the user into its first Surface, and shows a confirmation before transitioning.

---

## HOME Canonical Surfaces

Each surface name is the name of the canonical Modus loaded on it. The surface slot is stable; the user's preferred Modus fills it.

```
SURFACE     TRANSFORMATION    DEFAULT MODUS EXAMPLE
────────────────────────────────────────────────────────────────
make        txt → image       flux-schnell-txt2img (multi-LoRA)
effect      image → image     flux-fill-img2img
edit        image → image     masked inpainting Modus
            (with mask)
direct      txt → video       txt2vid Modus (+ audio treated same)
animate     image → video     img2vid Modus
caption     image → text      interrogation / captioning Modus
compose     txt → sound       TTS / music / audio Modus
utilities   image → image     upscale, bg-remove, and similar
            (utility flows)   — multiple independent flow groups
```

Eight surfaces. Covers the full transformation matrix. `img2img` always includes a prompt element.

---

## Node Types

There are exactly five node types. No more.

```
NODE TYPE   WHAT IT IS
────────────────────────────────────────────────────────────────────────────
Node        The execution unit. Opaque — internally it may be a single Modus,
            a sequence of Moduses, an NFT engine, anything minted. The canvas
            sees a named box with typed input ports and typed output ports.
            Named by whoever authored it.

Media       Supplies a file, URL, or camera input to downstream nodes.
            Output type: image, video, or audio depending on content.

Value       Supplies a typed literal — text, number, or a maintained list of
            states the user cycles through. One active state flows downstream.
            Multiple states = manual batch (fan-out on execute).

Transform   Reshapes or combines connected inputs. Preset faces first
            (see below); expression language underneath. Outputs can be
            scalar or array — array output fans out the downstream Node
            into batch automatically.

Context     Injects identity and memory into the graph. Most common form:
            trigger word list appended to prompt (LoRA activation). Also:
            RAG pull from Vestigium, Anima soul fields, NFT metadata ports.
```

**What is not a node type:** effect, spell, cook, collection test, expression (as a user-facing name). These are patterns or implementation details:
- Effect = Media → Node (a pattern)
- Spell = a minted Node with exposed slots (a kind of Node)
- Cook = a Value node with multiple states + batch cascade (emergent from Value)
- Expression = the engine inside Transform (not visible to users)

---

## Data Types & Visual Language

Every port (input and output) has an explicit declared type. Wires are colored by their type. Group region backgrounds inherit the dominant type color of their wires.

```
TYPE        COLOR (TBD exact palette)   NOTES
────────────────────────────────────────────────────────────
image       purple / blue               still image
video       teal / green                video stream  
audio       orange / amber              audio stream
text        white / light grey          string, prompt
number      yellow                      int or float
mask        red / coral                 binary mask (edit surface)
```

Type compatibility determines which ports can connect. Incompatible connections show the mismatch visually rather than failing silently. Type colors on wires and group regions make data flow readable at a glance without reading labels.

**LoRA trigger words are `text` type** — they flow as text appended to the prompt. The LoRA weight loading is handled inside the Modus's ComfyUI workflow; the canvas doesn't need a `lora` type.

---

## Execution Model

**Execute button lives on the terminal Node** — the downstream-most Node in a connected graph (one with no downstream connections). Not on the surface. Not a global run-all.

**Flow resolves distal to proximal.** Hitting execute on a terminal Node triggers upstream resolution recursively: each connected input runs its upstream Node, which runs its upstream, until source nodes (Value, Media, Context) are reached — they are always ready. The user doesn't configure execution order; it's implicit in the connection graph.

**Connected nodes form a group.** All nodes reachable from each other through connections are one group. Groups get a **bounding region** — a faint auto-sized background that visually contains all nodes in the group. The region color reflects the dominant data type flowing through the group.

A surface with multiple disconnected flows shows multiple bounding regions with multiple execute buttons:

```
┌──────────────────────────┐     ┌───────────────────────┐
│  [Value: prompt]         │     │  [Media: image]        │
│         ↓                │     │         ↓              │
│  [flux-schnell-txt2img ▶]│     │  [upscale ▶]           │
└──────────────────────────┘     └───────────────────────┘
```

Two groups. Two execute buttons. No ambiguity.

**Group region affordances:**
- Tap the region background (not a node) = select the group
- Selected group: Mint as Flow, duplicate, move together
- Execution status of the group shown at the region boundary
- Cost-so-far shown at the region boundary

---

## The Beckoning Prompt

When the user lands on a canonical HOME surface, they see the minimum viable state for that transformation — not a complex node editor.

```
make        prompt field (Value node, pre-connected) + execute
effect      image drop zone (Media node) + prompt field + execute
edit        image drop zone + mask affordance + prompt field + execute
direct      prompt field + execute
animate     image drop zone + execute  (prompt optional)
caption     image drop zone + execute  (output IS the text)
compose     prompt field + execute
utilities   varies by utility — multiple small groups visible
```

The canonical Node is there — flux-schnell-txt2img, fully configured — but the user sees a text field and a button. The node's complexity reveals through exploration. Anchor port indicators are visible on the node edges as small dots — discoverable, not demanding.

---

## Superposition Anchors

**Current behavior (canvas v2):** Anchors and the parameter panel are separate — drag anchors to connect nodes, enter NodeMode to edit values. Two gestures for the same decision about the same parameter.

**New behavior:** Click any input anchor → it pops out showing the current static value as an inline editable field with a wire handle alongside.

- **Edit the inline value** → stays static. Locked into the Node on mint. The parameter is internal configuration.
- **Grab the wire handle and connect** → becomes live. Exposed on mint. The parameter is a named input.

The parameter's minting status (locked vs exposed) is determined by which gesture you take — directly at the anchor, without entering NodeMode. NodeMode still exists for reviewing all parameters at once, but simple edits and exposures don't require it.

**At a glance:** port indicators on the node face show which anchors are wired (connected = exposed) vs closed (static = locked). The Node's public API is readable from surface view without entering NodeMode.

---

## Transform Node — Slot System

The Transform node is a **template editor**, not a code editor. The user writes in a single text area; structure emerges from their writing.

**Slot creation:** When a portion of text should become a variable input, the user selects it and triggers the "make slot" action from the selection context menu (mobile: hold-tap on selection → popover → bracket icon; desktop: selection floating toolbar → bracket icon). The selected text becomes a named slot with the original text as its default value.

Power users may also type slots directly using a bracket notation — the exact syntax is TBD, but the system responds by creating the slot as they type.

Each slot:
- Appears as a named anchor on the Transform node
- Shows the current value inline beneath the template text
- Has a wire handle for connecting an upstream Value or Context node
- Static value = locked on mint; connected = exposed on mint

**Preset faces (built before expression language):**
- **Prompt** — template with pre/body/suffix implied by natural slot creation
- **Join** — combine multiple text inputs with a configurable separator
- **Pick** — select one of N connected inputs (index-controlled)
- **Range** — output a number series (start, end, step)
- **Repeat** — replicate an input N times (batch output)

Advanced mode: full expression language for anything the presets don't cover.

**The NFT collection connection:** slots with list values in a Value node ARE trait definitions. A canvas with multiple `[Value: list] → [Transform] → [Node]` patterns is a collection generator. The system can surface this — "you've defined 3 traits, want to mint as a collection?"

---

## Value Node — List of States

The Value node holds a typed literal. Upgrade from canvas v2: it can hold a **maintained list of states**, not just a single value.

```
outfit
● sun dress          ← active, flows downstream now
  jeans
  leather jacket
  cocktail dress
+ add
```

- One item = Value. Flows as a scalar.
- Multiple items = curated Vary. Active item flows downstream on normal execute.
- "Run all" fans out — runs the downstream Node once per list item (batch).
- The list is user-maintained: add, remove, reorder, rename items.

This is also how LoRA trigger words work in a Context node — a maintained list of trigger word strings, all active simultaneously, concatenated and appended to the prompt.

---

## Minting

**What minting captures:**
- The connected graph (Node + all its upstream supporting nodes)
- Locked params: values set via inline anchor edit or NodeMode — baked into the new Flow
- Exposed params: anchors connected to upstream nodes — become named inputs of the new Flow
- Name (required), description (optional), publish decision

**Entry points:**
1. **From a Node** (NodeMode): Mint button in the result/action area — mints that Node alone
2. **From a group** (surface view): tap the bounding region → "Mint as Flow" — mints the entire connected graph as a composed Flow

**After minting:**
- Appears in the user's Flows catalog under "Mine"
- Accessible by name on any surface
- Optionally published to the community Flows catalog
- Published Flows earn royalties on every execution by others

**What spell and cook were:**
- Spell = a minted Node with locked config and exposed slots — just a Flow
- Cook = a Value node with multiple states + batch cascade — just a Value node doing its job
- Neither word appears in the minting UI

---

## Component Inventory (Minimum Viable)

The clean-room frontend needs exactly these components — nothing inherited that doesn't earn its place.

```
COMPONENT           WHAT IT RENDERS
────────────────────────────────────────────────────────────────────────
SurfaceTabStrip     horizontal surface tabs + scroll + add (+)
SurfaceCanvas       the canvas area — viewport, pan, zoom, physics layout
GroupRegion         auto-sized bounding box for a connected node cluster
ConnectionLine      SVG bezier wire between ports, colored by type

NodeCard            any node in surface view — name, status, port dots,
                    output thumbnail, execute button (terminal nodes only)
NodeView            focused overlay — full parameter panel + result display
ParamSlot           one input port: inline value OR wire state OR slot list
ResultDisplay       output preview + version strip + action bar (mint, rate, share)

MediaNode           upload drop zone + URL input
ValueNode           text/number field OR scrollable list of states
TransformNode       template editor — text area + slot anchors + preset picker
ContextNode         trigger word list + RAG config + identity port declarations

AddFlowModal        add-to-surface picker — replaces ActionModal
                    shows create/effect split → category → Flow list
MintFlow            name + description + publish toggle — one screen
SurfaceNav          workspace-level navigation (future: surface overview)
```

Fifteen components. Canvas v2 had closer to forty. The reduction comes from collapsing the per-feature node renderers (ToolWindowBody, SpellWindowBody, CollectionTestWindowBody, etc.) into five typed node renderers that handle all cases.

---

## Open Questions

**OQ-C1: Slot syntax.** The bracket notation for creating slots in the Transform node is the power-user path. The exact syntax (single bracket `[name]`, double `{{name}}`, something else) needs to be decided before the Transform node is built. Preference: something visually distinct from surrounding text, easy to type on mobile.

**OQ-C2: NodeMode transition.** When does a node go into NodeView (the focused overlay)? Currently: tap the node. Should entering NodeView be explicit (button) or implicit (tap the node body)? On mobile, accidental NodeView entry is a usability issue.

**OQ-C3: Workspace overview.** The workspace view (showing all surfaces as navigable regions) is referenced but not designed. Needed once a user has more than a few surfaces. Could be a dedicated overview screen or a zoom-out gesture from the surface canvas.

**OQ-C4: Canonical Node protection on HOME.** The anchored canonical Node on each HOME surface can be configured but not deleted. What happens if the user tries to delete it? Silent prevention, informational toast, or a "detach from HOME slot" action that turns it into a regular Node?

**OQ-C5: Multi-surface execution.** Is there ever a legitimate "run all surfaces" action? Probably not in v1 — each surface is a separate working context. Worth confirming before building any surface-level execution affordance.

**OQ-C6: Transform preset discovery.** How does a new user learn that the Transform node has preset faces (Prompt, Join, Pick, etc.)? The blank text area doesn't communicate this. A preset picker in the node toolbar, or a "start with a preset" empty state.

---

*This document is the design spec for the canvas. Do not start frontend implementation*
*until open questions are resolved and this document is marked implementation-ready.*
