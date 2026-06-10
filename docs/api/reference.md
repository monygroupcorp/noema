# Noema Crystal API — v1 reference

> Generated from the in-code API contract (`src/allocutio/api/apiContract.ts`). Do not edit by hand — run `npm run gen:api-docs`.

The live, self-describing source of truth is `GET /v1/openapi.json` plus the discovery endpoints (`GET /v1/flows`, `GET /v1/flows/:id`). The dynamic catalog (which flows exist) is discovered live, never baked here.

## Operations

### POST /v1/runs

Invoke a flow and return its run handle.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Invoke a flow. Provide a target (one of modusId or verb) and the inputs (aditus). Anonymous callers may carry a `commitment`; web3 callers a `web3` bundle.",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "Explicit flow id to run (wins over verb)."
    },
    "verb": {
      "type": "string",
      "description": "A canon verb to resolve to a flow."
    },
    "aditus": {
      "type": "object",
      "additionalProperties": true,
      "description": "The flow's inputs, keyed per its input JSON-Schema (see GET /v1/flows/:id)."
    },
    "pinnedModels": {
      "type": "array",
      "description": "Optional per-run model pins.",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "computeStrategy": {
      "type": "string",
      "description": "Optional compute-strategy override."
    },
    "gpuClass": {
      "type": "string",
      "description": "Optional GPU-class override."
    },
    "maxImpetus": {
      "type": "string",
      "description": "Hard spend cap — admission refuses if the estimated reservation exceeds this value."
    },
    "studioId": {
      "type": "string",
      "description": "Target an existing warm studio (a Modo session) instead of cold-provisioning a pod."
    },
    "options": {
      "type": "object",
      "description": "Per-run observation options.",
      "properties": {
        "webhookUrl": {
          "type": "string",
          "format": "uri",
          "description": "Fire-and-forget completion POST target — receives the terminal run event."
        }
      }
    },
    "commitment": {
      "type": "string",
      "description": "Anonymous arcanum spend commitment (auth)."
    },
    "web3": {
      "type": "object",
      "description": "A web3 signature bundle (auth).",
      "properties": {
        "address": {
          "type": "string"
        },
        "signature": {
          "type": "string"
        },
        "nonce": {
          "type": "string"
        }
      },
      "required": [
        "address",
        "signature",
        "nonce"
      ]
    }
  },
  "required": [
    "aditus"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "run": {
      "type": "object",
      "description": "The public projection of a run (Actum). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string",
          "description": "The run identifier."
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "running",
            "complete",
            "failed"
          ],
          "description": "The run lifecycle status."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) this run executes."
        },
        "exitus": {
          "type": "object",
          "additionalProperties": true,
          "description": "The outputs produced by the run — present only when available."
        },
        "failure": {
          "type": "object",
          "description": "Populated only when the run failed.",
          "properties": {
            "code": {
              "type": "string"
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "code",
            "message"
          ]
        },
        "cost": {
          "type": "string",
          "description": "Impetus cost, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the run started, as an ISO-8601 string."
        }
      },
      "required": [
        "id",
        "status",
        "modusId"
      ]
    }
  },
  "required": [
    "run"
  ]
}
```

### GET /v1/runs/:id

Fetch a run by id (poll for completion).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "run": {
      "type": "object",
      "description": "The public projection of a run (Actum). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string",
          "description": "The run identifier."
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "running",
            "complete",
            "failed"
          ],
          "description": "The run lifecycle status."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) this run executes."
        },
        "exitus": {
          "type": "object",
          "additionalProperties": true,
          "description": "The outputs produced by the run — present only when available."
        },
        "failure": {
          "type": "object",
          "description": "Populated only when the run failed.",
          "properties": {
            "code": {
              "type": "string"
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "code",
            "message"
          ]
        },
        "cost": {
          "type": "string",
          "description": "Impetus cost, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the run started, as an ISO-8601 string."
        }
      },
      "required": [
        "id",
        "status",
        "modusId"
      ]
    }
  },
  "required": [
    "run"
  ]
}
```

### GET /v1/runs/:id/stream

Server-Sent Events stream of run events (an initial snapshot, then stage/complete/failed frames). Content-Type: text/event-stream; the stream ends on the terminal event.

- **Auth:** required

### GET /v1/openapi.json

The live OpenAPI 3.1 description of this surface (self-describing).

- **Auth:** public

### POST /v1/mcp

MCP (Model Context Protocol) JSON-RPC endpoint — agent tool-use over the same facade. Tools: run_flow / get_run / list_flows / describe_flow. Resources: crystal://flows and crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op.

- **Auth:** required

### GET /v1/flows

List the runnable flows (discovery).

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "flows": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "The flow display name."
          },
          "versio": {
            "type": "string",
            "description": "The flow version."
          },
          "categoria": {
            "description": "An optional catalog tag."
          }
        },
        "required": [
          "id",
          "nomen",
          "versio"
        ]
      }
    }
  },
  "required": [
    "flows"
  ]
}
```

### GET /v1/flows/:id

Describe one flow's input/output JSON-Schema (discovery).

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "description": "A flow's JSON-Schema description — read this before invoking; never guess inputs.",
  "properties": {
    "id": {
      "type": "string"
    },
    "nomen": {
      "type": "string"
    },
    "versio": {
      "type": "string"
    },
    "input": {
      "type": "object",
      "description": "The flow's input JSON-Schema (the shape of `aditus`).",
      "additionalProperties": true
    },
    "output": {
      "type": "object",
      "description": "The flow's output JSON-Schema — present when the flow declares one.",
      "additionalProperties": true
    },
    "categoria": {
      "description": "An optional catalog tag."
    },
    "fundamentumId": {
      "description": "An optional substrate reference."
    }
  },
  "required": [
    "id",
    "nomen",
    "versio",
    "input"
  ]
}
```

### POST /v1/runs/quote

Estimate a run cost (impetus) without dispatching — call before invoke to budget.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Estimate a run cost without dispatching. Provide a target (modusId or verb) and inputs.",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "Explicit flow id to quote (wins over verb)."
    },
    "verb": {
      "type": "string",
      "description": "A canon verb to resolve to a flow."
    },
    "aditus": {
      "type": "object",
      "additionalProperties": true,
      "description": "The flow's inputs — same shape as POST /runs aditus."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "The estimated impetus cost for the run.",
  "properties": {
    "impetus": {
      "type": "string",
      "description": "Upper-bound reservation cost, serialised as a string."
    }
  },
  "required": [
    "impetus"
  ]
}
```

### GET /v1/fundamenta

List the canonical compute substrates (fundamenta) available for flows.

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "fundamenta": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "Display label."
          },
          "versio": {
            "type": "string",
            "description": "Semantic version."
          },
          "runtime": {
            "type": "string",
            "description": "On-pod runtime (e.g. ComfyUI)."
          },
          "imageId": {
            "type": "string",
            "description": "Docker image id."
          },
          "imageVersion": {
            "type": "string",
            "description": "Docker image version."
          },
          "vramGb": {
            "type": "number",
            "description": "Minimum VRAM in GB."
          }
        },
        "required": [
          "id",
          "versio",
          "imageId",
          "imageVersion"
        ]
      }
    }
  },
  "required": [
    "fundamenta"
  ]
}
```

### GET /v1/models

Browse the model weight catalog, optionally filtered by genus, basis, fundamentumId, trigger, or free-text query.

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "intellaId": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "Display name."
          },
          "genus": {
            "type": "string",
            "description": "Weight class (lora, checkpoint, vae, …)."
          },
          "basis": {
            "type": "string",
            "description": "Base model family this weight is compatible with."
          },
          "trigger": {
            "type": "string",
            "description": "Trigger words (LoRA only)."
          },
          "description": {
            "type": "string",
            "description": "Human-readable description."
          }
        },
        "required": [
          "intellaId",
          "nomen",
          "genus"
        ]
      }
    }
  },
  "required": [
    "models"
  ]
}
```

### POST /v1/flows

Save a reusable owner-keyed flow derived from an owned run (fromRun) or a base flow (modusId).

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Save a reusable owner-keyed flow derived from an owned run or a base flow.",
  "properties": {
    "fromRun": {
      "type": "string",
      "description": "Derive from an owned run (copies its modusId + aditus)."
    },
    "modusId": {
      "type": "string",
      "description": "Derive from an explicit base flow id."
    },
    "name": {
      "type": "string",
      "description": "Human-readable name; yields a global-unique slug."
    },
    "aditus": {
      "type": "object",
      "additionalProperties": true,
      "description": "Input defaults to bake into the saved flow."
    },
    "promptMode": {
      "type": "string",
      "enum": [
        "open",
        "pinned"
      ],
      "description": "Whether the prompt field is open or pinned."
    },
    "affix": {
      "type": "object",
      "description": "Prompt prefix/suffix to fold into every run of this flow.",
      "properties": {
        "prefix": {
          "type": "string"
        },
        "suffix": {
          "type": "string"
        }
      }
    },
    "pinnedModels": {
      "type": "array",
      "description": "Model pins baked into the saved flow.",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  "required": [
    "name"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "The id of the newly created flow.",
  "properties": {
    "id": {
      "type": "string",
      "description": "The slug id of the saved flow."
    }
  },
  "required": [
    "id"
  ]
}
```

### PUT /v1/me/bindings/:verb

Rebind a canon verb (make, chat) to a specific flow for the authenticated caller.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Rebind a canon verb to a specific flow.",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "The flow id to bind this verb to."
    }
  },
  "required": [
    "modusId"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "The resulting verb → flow binding.",
  "properties": {
    "verb": {
      "type": "string",
      "description": "The verb that was rebound."
    },
    "modusId": {
      "type": "string",
      "description": "The flow it now resolves to."
    }
  },
  "required": [
    "verb",
    "modusId"
  ]
}
```

### GET /v1/me/status

Return the authenticated caller's account snapshot — balance, in-flight gens, and studios.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The caller's account snapshot — balance, in-flight gens, studios.",
  "properties": {
    "balanceImpetus": {
      "type": "string",
      "description": "Spendable impetus balance, serialised as a string."
    },
    "balanceUsd": {
      "type": "number",
      "description": "USD-equivalent balance (informational)."
    },
    "gens": {
      "type": "array",
      "description": "In-flight generation entries.",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "studios": {
      "type": "array",
      "description": "Active studio entries.",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "joinable": {
      "type": "array",
      "description": "Joinable studio invites.",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "takenAt": {
      "type": "string",
      "format": "date-time",
      "description": "When the snapshot was taken."
    }
  },
  "required": [
    "balanceImpetus",
    "balanceUsd",
    "gens",
    "studios",
    "joinable",
    "takenAt"
  ]
}
```

### POST /v1/studios

Lease a hosted warm studio (a persistent GPU session) for fast repeated runs. maxImpetus is the session budget — the studio drain-terminates at the cap.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Lease a hosted warm studio. Everything is optional — the simplest call leases a default studio capped at the balance. Discover fundamentumId via GET /v1/fundamenta and models via GET /v1/models (no opaque ids).",
  "properties": {
    "fundamentumId": {
      "type": "string",
      "description": "Compute substrate to arm on (its runtime is inherited). Enumerate via GET /v1/fundamenta."
    },
    "models": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Model ids (intellaId) to install live onto the studio. Enumerate via GET /v1/models."
    },
    "warmMs": {
      "type": "number",
      "description": "How long to hold the studio warm (ms)."
    },
    "maxImpetus": {
      "type": "string",
      "description": "Hard spend cap = the session budget (impetus). The studio drain-terminates at the cap. Omitted → the full balance."
    },
    "runtime": {
      "type": "string",
      "description": "Override the on-pod runtime explicitly (else inherited from the fundamentum)."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "A newly leased studio.",
  "properties": {
    "studio": {
      "type": "object",
      "description": "A hosted studio. `studioId` is what POST /v1/runs { studioId } targets.",
      "properties": {
        "studioId": {
          "type": "string",
          "description": "The studio id (a Modo session) — pass as run.studioId."
        },
        "podId": {
          "type": "string",
          "description": "The underlying pod id."
        },
        "status": {
          "type": "string",
          "description": "Pod-derived liveness: idle | running | provisioning | draining | terminated."
        },
        "gpu": {
          "type": "string",
          "description": "GPU model the studio runs on."
        },
        "runtime": {
          "type": "string",
          "description": "On-pod runtime (ComfyUI / llama.cpp / …)."
        },
        "imageRef": {
          "type": "string",
          "description": "The pod image reference."
        },
        "warmUntil": {
          "type": "string",
          "format": "date-time",
          "description": "When the warm window expires."
        },
        "budgetImpetus": {
          "type": "string",
          "description": "The authorized session budget (the maxImpetus cap), as a string."
        },
        "costPerHr": {
          "type": "number",
          "description": "The pod's real hourly USD cost — the source of truth for warm-time billing."
        },
        "impetusPerSecond": {
          "type": "string",
          "description": "Coarse burn-rate hint (impetus/sec); billing is per-window from costPerHr. Prefer costPerHr for an accurate rate."
        }
      },
      "required": [
        "studioId",
        "status",
        "budgetImpetus"
      ]
    }
  },
  "required": [
    "studio"
  ]
}
```

### GET /v1/studios

List the authenticated caller's live hosted studios.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The caller's live studios.",
  "properties": {
    "studios": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A hosted studio. `studioId` is what POST /v1/runs { studioId } targets.",
        "properties": {
          "studioId": {
            "type": "string",
            "description": "The studio id (a Modo session) — pass as run.studioId."
          },
          "podId": {
            "type": "string",
            "description": "The underlying pod id."
          },
          "status": {
            "type": "string",
            "description": "Pod-derived liveness: idle | running | provisioning | draining | terminated."
          },
          "gpu": {
            "type": "string",
            "description": "GPU model the studio runs on."
          },
          "runtime": {
            "type": "string",
            "description": "On-pod runtime (ComfyUI / llama.cpp / …)."
          },
          "imageRef": {
            "type": "string",
            "description": "The pod image reference."
          },
          "warmUntil": {
            "type": "string",
            "format": "date-time",
            "description": "When the warm window expires."
          },
          "budgetImpetus": {
            "type": "string",
            "description": "The authorized session budget (the maxImpetus cap), as a string."
          },
          "costPerHr": {
            "type": "number",
            "description": "The pod's real hourly USD cost — the source of truth for warm-time billing."
          },
          "impetusPerSecond": {
            "type": "string",
            "description": "Coarse burn-rate hint (impetus/sec); billing is per-window from costPerHr. Prefer costPerHr for an accurate rate."
          }
        },
        "required": [
          "studioId",
          "status",
          "budgetImpetus"
        ]
      }
    }
  },
  "required": [
    "studios"
  ]
}
```

## Error codes

Every failed request returns the uniform envelope `{ error: { code, message, retryable?, retryAfter?, details? } }`. Branch on the stable `code`.

| Code | HTTP status | Retryable |
| --- | --- | --- |
| `auth.missing` | 401 | no |
| `auth.invalid` | 401 | no |
| `auth.forbidden` | 403 | no |
| `input.malformed` | 400 | no |
| `input.invalid_aditus` | 422 | no |
| `not_found.flow` | 404 | no |
| `not_found.fundamentum` | 404 | no |
| `not_found.studio` | 404 | no |
| `not_found.run` | 404 | no |
| `economy.insufficient_signa` | 402 | no |
| `economy.cap_too_low` | 422 | no |
| `conflict.slug_taken` | 409 | no |
| `capacity.no_pods` | 503 | yes |
| `internal.unavailable` | 503 | yes |
| `internal.error` | 500 | yes |
