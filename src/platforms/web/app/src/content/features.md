# Features — Page Content Draft
*For web/marketing use. Internal working draft.*

---

## Hero

**Headline:** Every modality. Fully private.

**Subhead:** Text, image, video, audio — all through the same privacy-preserving infrastructure. No compromise between capability and confidentiality.

---

## Feature sections

### 1. Private Compute

**Headline:** The only AI compute you can verify.

**Body:** A private session tunnels directly from your browser to the GPU. Our servers never receive your prompts, your model choice, or your outputs. We see a session opened and a session ended. That's it — not because we promise not to look, but because the architecture doesn't give us a path to look.

When running on TEE hardware, you can cryptographically verify this claim. The pod generates a hardware-signed attestation report. Your browser checks it. If the hash matches the published image, you know the unmodified runner is what's executing — and that neither we nor the compute provider can inspect your session.

**CTA:** Learn how TEE works →

---

### 2. Text Generation

**Headline:** Every leading model. Zero logging.

**Body:** Access the best open-source and frontier language models — Llama, Qwen, Mistral, and more — through a private session or the standard API. Chat, reason, write, code. With a private session, we don't know what you asked or what the model said.

**Supported:** vLLM, llama.cpp runtimes. OpenAI-compatible API.

**CTA:** Start generating →

---

### 3. Image Generation

**Headline:** Generate without a record.

**Body:** FLUX Schnell and other leading image models, through the same privacy-preserving infrastructure. Your prompt, your output, your session — architecturally isolated from our servers in a private session.

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

**Headline:** One OpenAI-compatible API. Full privacy options.

**Body:** Every modality through a single API: text, image, video, audio, embeddings. Swap out your OpenAI base URL and your existing stack works. Add a `x-bursa-token` header for anonymous billing, or use a session key. TEE sessions available via `/v1/sessions/tee`.

**CTA:** API docs →

---

## Privacy tier comparison (inline table for features page)

| | Standard API | TEE Private Session | TEE + E2EE (coming) |
|---|---|---|---|
| Prompts reach our servers | Yes | No | No |
| We know which model you used | Yes | No | No |
| Content logged | No | N/A — never received | N/A |
| Credit trail anonymous | Optional (Bursa) | Optional (Bursa) | Optional (Bursa) |
| Hardware-verifiable | No | Yes | Yes |
| Client-side encryption | No | No | Yes |
| Web search, memory | Yes | Yes | No (plaintext req.) |
