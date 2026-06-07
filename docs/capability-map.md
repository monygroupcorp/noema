# Capability map — signatures, canon verbs, and the gen-flow backlog

The complete capability space and the canon verbs mapped onto it. See **ADR-0004** (verbs = signatures;
conditioning = flow; the `mesh` modality) and **ADR-0003** (the flow/preference layer that conditioning
variants live in). A verb is an *intent* on a signature — never a conditioning flavor.

## The signature matrix (5 modalities)

Modalities: **t**ext, **i**mage, **v**ideo, **a**udio (flavors: speech/sfx/music), **m**esh.
Legend: ✓ real/common · ◐ niche (parked) · ✗ not a thing.

| in ↓ \ out → | text | image | video | audio | mesh |
|---|---|---|---|---|---|
| **text**  | t2t ✓ | t2i ✓ | t2v ✓ | t2a ✓ *(speech/sfx/music)* | t2m ✓ |
| **image** | i2t ✓ | i2i ✓ | i2v ✓ | i2a ◐ | i2m ✓ |
| **video** | v2t ✓ | v2i ✓ | v2v ✓ | v2a ✓ | v2m ✓ |
| **audio** | a2t ✓ | a2i ◐ | a2v ✓ | a2a ✓ | a2m ✗ |
| **mesh**  | m2t ◐ | m2i ✓ | m2v ✓ | m2a ✗ | m2m ✓ |

## Canon verbs (one per signature)

`live` = flow exists today · `planned` = gated on its default Essentia + workflow template (one
gen-flow task each) · conditioning variants (ControlNet, inpaint, edit, reference) are **+flows**, not
verbs.

| Verb | Signature | Produces | Status |
|---|---|---|---|
| **make** | t2i | image from prompt | **live** (`flux-schnell`) |
| **effect** | i2i | image transform *(controlnet/inpaint/edit = +flow)* | planned |
| **animate** | i2v | video from a still | planned |
| **direct** | t2v | video from text | planned |
| **render** | m2i / m2v | render a 3D asset → image or video | planned |
| **chat** | t2t | conversational text | **live** (`modus.chatgpt`) |
| **describe** | i2t | caption / VQA / analyze | planned |
| **transcribe** | a2t | speech → text | planned |
| **speak** | t2a·speech | TTS / voice | planned |
| **compose** | t2a·music | music | planned |
| **foley** | t2a·sfx | sound effects | planned |
| **sculpt** | t2m | text → 3D | planned |
| **lift** | i2m | image → 3D | planned |
| **scan** | v2m | video → 3D (photogrammetry / NeRF / splat) | planned |

## Reachable via `/run` for now (promote to a verb later if traffic warrants)

`v2t` (recap) · `v2i` (frame grab) · `v2v` (rework) · `v2a` (score-a-video) · `a2a` (voice
convert / denoise / stems) · `a2v` (visualizer / lipsync) · `m2m` (retopo / remesh / rig).

## Parked

- **Niche (revisit):** `i2a` (image → music/ambience), `a2i` (audio → art), `m2t` (describe a 3D model).
- **Not a thing:** `a2m`, `m2a`.

## The attic

A canon verb with no good flow yet is **defined but dormant** — it lives in this map but is not wired
into `CANON_VERBS` until its flow ships (no dead command pointing at a missing modus). If a planned
verb never finds a good flow, it stays in the attic indefinitely. Today only `make` and `chat` are out
of the attic.
