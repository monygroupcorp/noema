# Compose a workflow on the canvas

**Published:** 2026-09-05

How to wire several models into one flow you can run, publish, and call like any other.

Most AI interfaces give you one model at a time. The [canvas](/canvas) gives you the catalogue as
parts: put down the flows you want, wire the output of one into the input of the next, and publish
the result as a single flow with its own name and id.

Published, it is not a saved diagram. It is a flow — it runs from the app and over the API exactly
like the ones that shipped with the platform.

You do not need an account to do any of this. Authoring and publishing both work from an anonymous
session.

## The palette is the real catalogue

The node palette is built from two live lists: every flow the platform carries, and every flow you
own. There is no separate menu of canvas-only blocks to fall out of date — if it runs on noema, it
is in the palette, and a flow published last week is there this week.

That includes flows you published from the canvas yourself. Composing a composed flow is not a
special case.

## Ports come from the flow, not from a drawing

Drop a node and its ports appear: one per field in that flow's own input schema, labelled the way
the flow labels them. Nothing about a node is hand-drawn, which is why the palette can carry flows
nobody anticipated.

Ports come in three kinds, and it is worth knowing why three:

- **text** — prompts, names, anything written.
- **number** — counts, dimensions, seeds, strengths.
- **media** — an image, a video, an audio file, a 3D asset.

Image, video, audio and 3D all share one kind because, on the wire, they are the same thing: a URL.
There is no signal left to tell them apart, so the canvas does not invent one. Colouring an image
port differently from a video port would be a promise the connection cannot keep — it would let you
wire an image into a video-only input and call it type-checked.

So: a media port accepts media. Whether *this* video model accepts *that* image is a question the
flow answers when it runs, and the canvas does not pretend otherwise.

## Wiring and parameters

Drag from an output handle to an input handle. Click a node to open its parameter panel, which is
built from the same schema as the ports — every field the flow declares, with its own title and
description.

A field can be filled in two ways: typed into the panel, or fed by a wire from upstream. Typed
values are for the constants of your flow; wires are for what changes per run.

## Publish

**Publish** compiles the graph into one flow and gives you its id. That flow is then runnable
anywhere a flow is runnable, including a single `POST /v1/runs` — the whole graph behind one call.

Publishing is also where the graph gets checked. A graph with a cycle, or a wire between ports whose
kinds do not match, is refused, and the offending wire is marked on the canvas so you are looking at
the problem rather than reading about it. This is deliberately at publish rather than at
wiring time: mid-build, a graph is allowed to be temporarily wrong.

An empty canvas cannot be published — there is nothing to compile.

## Where to go next

A composed flow is a good thing to call from a script, because all the composition is on our side of
the call: see [running noema over the API](/blog/run-noema-over-the-api). And a flow is more useful
when one of its nodes is a model you trained — see
[training a model on your own work](/blog/train-a-model).
