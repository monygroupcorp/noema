# Guides

Reference copy of what `/blog` serves. The published text lives in
`src/platforms/web/app/src/content/blog/`, one markdown file per guide, and the index is built
from those files — a guide is added by adding a file, so there is no list here to fall behind one.

| Guide | `/blog/…` | Source |
|---|---|---|
| Train a model on your own work | `train-a-model` | `content/blog/train-a-model.md` |
| Compose a workflow on the canvas | `compose-a-workflow` | `content/blog/compose-a-workflow.md` |
| Run noema over the API | `run-noema-over-the-api` | `content/blog/run-noema-over-the-api.md` |

## What these are for

They are written from the shipped behaviour rather than from the pitch, which means they name the
limits next to the capabilities: the training monitor shows no loss curve because a run does not
report one, canvas ports bucket into text/number/media because image, video, audio and 3D are all
a URL on the wire, and the API guide says plainly that there is no self-serve key yet.

That register is the point. A guide that describes a product slightly better than the one the
reader is holding costs more trust than it wins, and the reader finds out either way.

## Editing one

Edit the markdown. The title and the index blurb are read out of the file itself — the first `#`
heading and the first paragraph under it — so there is no second place to update and nothing that
can disagree with the prose. `**Published:** YYYY-MM-DD` on its own line sets the date and the
sort order; a file without one sorts last.

Internal links are checked: `contentLinks.test.ts` walks every markdown file under `content/`,
this folder included, and fails on any link to a path no route serves.
