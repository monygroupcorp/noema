# Features — Page Content Draft
*For web/marketing use. Internal working draft.*

---

## Hero

**Headline:** Every modality. One studio.

**Subhead:** Text, image, video, audio — through one API and one concierge. Curated open- and closed-source models, in a workspace built to compose them.

---

## Feature sections

### 1. Private Compute (in development)

**Headline:** Private compute — in development.

**Body:** A private session tunnels directly from your browser to a single-tenant GPU pod, over WireGuard keys generated on your device. Today this is network isolation, not hardware-sealed private compute: the compute provider hosting the pod is inside the trust boundary and can technically access session content. We do not claim otherwise.

A hardware-sealed tier is in development: confidential-compute GPUs whose attestation your browser verifies — a hardware-signed report proving the published, unmodified runner is what's executing, with the tunnel key bound to the enclave — so that neither we nor the compute provider could inspect your session. **It is not yet available.** Until it ships, treat every session as visible to the compute provider.

**CTA:** See the private-session roadmap →

---

### 2. Text Generation

**Headline:** Every leading model. Zero logging.

**Body:** Access the best open-source and frontier language models — Llama, Qwen, Mistral, and more — through the standard API or your own endpoint. Chat, reason, write, code. We do not retain your prompts or outputs after the request, and we never train on them.

**Supported:** vLLM, llama.cpp runtimes. OpenAI-compatible API.

**CTA:** Start generating →

---

### 3. Image Generation

**Headline:** Generate without a record.

**Body:** FLUX Schnell and other leading image models. We don't retain your prompt or output after the request completes, and we never train on them.

**Supported:** FLUX.1 Schnell, SDXL, and others via ComfyUI workflows.

**CTA:** Create images →

---

### 4. Video Generation

**Headline:** Frame by frame. Private.

**Body:** Text-to-video and image-to-video generation through the same composable workflow system. Chain image generation into video as a single composed flow — or run video standalone.

**CTA:** Generate video →

---

### 5. Audio and Music

**Headline:** Sound, privately produced.

**Body:** Music generation, text-to-speech, and audio processing. Describe what you want; get a private output. No audio retention, no training on your productions.

**CTA:** Make audio →

---

### 6. The Canvas Workspace

**Headline:** A composable workspace for multi-step AI flows.

**Body:** Most AI interfaces give you one model at a time. Noema's canvas lets you compose: connect an image generator to a video model, pipe a text output into an audio generator, chain reasoning steps into production workflows. Typed connections — text, image, video, audio — make mismatches visible before you run.

This isn't a chatbot wrapper. It's a production workspace for people who build with AI.

**CTA:** Explore the canvas →

---

### 7. Anonymous Credits (Bursa)

**Headline:** Pay without an identity.

**Body:** Bursa credits are spent via Groth16 zero-knowledge proofs. You prove you have credits; we verify the math and dispatch your compute. We cannot link your spend to your account, your prior sessions, or any identity. The platform receives: a valid proof, a credit amount. Nothing else.

No other AI platform has this. Venice's "crypto = private" angle does the opposite — a wallet address is a permanent, publicly traceable identity on-chain.

**CTA:** How Bursa works →

---

### 8. API

**Headline:** One OpenAI-compatible API.

**Body:** Every modality through a single API: text, image, video, audio, embeddings. Swap out your OpenAI base URL and your existing stack works. Add a `x-bursa-token` header for anonymous billing, or use a session key. A private-session endpoint (`/v1/sessions/tee`) is in development.

**CTA:** API docs →

---

## Compute tier comparison (inline table for features page)

*The private tiers below are in development and not yet available; "planned" marks the target behavior once they ship.*

| | Standard API | Private session (in development) | Hardware-sealed (in development) |
|---|---|---|---|
| Prompt/output content retained | No | No | No |
| We train on your content | No | No | No |
| Compute provider can access content | Yes | Yes | Planned: no |
| Content routed through our servers | Yes | Planned: no | Planned: no |
| Hardware-verifiable in browser | No | No | Planned: attestation |
| Credit trail anonymous | Optional (Bursa) | Optional (Bursa) | Optional (Bursa) |
| Web search, memory | Yes | Yes | Yes |
