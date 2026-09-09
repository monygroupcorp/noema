# Features

Reference copy of what `/features` serves. The published text lives in
`src/platforms/web/app/src/content/features.md` and is rendered by `<Doc/>`; there is no second
copy here to fall behind it.

## Why this file holds no copy

It used to. It was the pre-launch draft, and it went stale in the way a feature list always goes
stale — by naming things. It advertised Llama, Qwen and Mistral, vLLM and llama.cpp runtimes, an
embeddings modality, and an OpenAI-compatible API you could reach by swapping your base URL. None
of those are in `GET /v1/models`, `GET /v1/flows` or `GET /v1/openapi.json`, and several never
were.

The shipped page is written the other way round: it describes the shape of the catalogue and links
to `/catalog` for what is actually running, because the catalogue is discovered live and a page
that repeats it is a roster somebody has to keep. `npm run guard:site-truth` holds that line — it
reads the published copy and fails on a modality, an endpoint or an auth header the running system
does not have.
