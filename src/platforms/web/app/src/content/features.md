# Every modality. One studio.

Text, image, video, audio and 3D — through one API and one concierge. Curated open- and
closed-source models, in a workspace built to compose them. What is actually running is on the
[catalogue](/catalog), which reads from the same source the product does; this page describes the
shape of it and does not keep a second list.

## Text generation

**Chat and reasoning, alongside everything else.**

Chat and reasoning route out to external language-model providers — OpenRouter and Venice — so
their frontier and open-weight models are reachable from the same API and the same canvas as the
image and video work. Vision-language models run on our own compute instead: image, video or audio
in, text out. We never train on your prompts or outputs. Run records are kept until you erase your
account, and the privacy policy says exactly what is kept and why.

**Runs on:** external LLM providers for chat; our own GPU pods for the vision-language models.

[Start generating →](/catalog)


## Image generation

**The best open image models, composed.**

FLUX Schnell and other leading image models. We never train on your prompts or outputs. Run records are kept until you erase your account, and the privacy policy says exactly what is kept and why.

**Runs on:** FLUX.1 Schnell, SDXL, and others via ComfyUI workflows.

[Create images →](/catalog)


## Video generation

**Frame by frame, in one flow.**

Text-to-video and image-to-video generation through the same composable workflow system. Chain image generation into video as a single composed flow — or run video standalone. We never train on your prompts or outputs. Run records are kept until you erase your account, and the privacy policy says exactly what is kept and why.

[Generate video →](/catalog)


## Audio and music

**Say what it should sound like.**

Text-to-music generation, and audio understanding that turns a track back into a description you
can work with. Describe what you want; get a finished output. We never train on your productions.
Run records are kept until you erase your account, and the privacy policy says exactly what is kept
and why.

[Make audio →](/catalog)


## The canvas workspace

**A composable workspace for multi-step AI flows.**

Most AI interfaces give you one model at a time. Noema's canvas lets you compose: connect an image generator to a video model, pipe a text output into an audio generator, chain reasoning steps into production workflows. Typed connections — text, image, video, audio — make mismatches visible before you run.

This isn't a chatbot wrapper. It's a production workspace for people who build with AI.

[Explore the canvas →](/canvas)


## Anonymous credits — coming soon

**Pay without an identity.**

Signing up asks for no email address: an account is a username and a password. Funding from a
shielded or fresh on-chain wallet puts no identity behind the address — that is the strongest
funding path available today, and it is not invisibility: the depositing address reaches us through
our deposit provider and we keep it for sanctions screening. The
[privacy policy](/legal/privacy) states exactly what is retained and why.

On top of that, an unlinkable ZK bearer purse is coming soon: purse credits will be spent via
Groth16 zero-knowledge proofs — you prove you have credits, we verify the math and dispatch your
compute, and we cannot link the spend to your account, your prior sessions, or any identity. That
rail is switched off until the trusted-setup [ceremony](/ceremony) concludes, because until then
the key it verifies against is not yet one nobody controls. Today, every credit is an ordinary
account-tied credit.

[How purse works →](/funding)


## API

**One API, and it describes itself.**

Every modality through a single API: text, image, video, audio and 3D. Discover the flows that
exist, run one, and watch the run — `GET /v1/flows`, `POST /v1/runs`, and an MCP endpoint at
`/v1/mcp` for agents. There is no roster to keep in sync here because the contract is served live
and the catalogue is discovered, never baked in. Authenticate with a session key, or with a purse
token in an `x-bursa-token` header; bearer-token billing from a purse tied to no account is coming
soon, after the trusted-setup ceremony.

[The live contract →](/v1/openapi.json)
