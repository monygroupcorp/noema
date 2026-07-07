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

Server-Sent Events stream of run events (an initial snapshot, then progress/stage/complete/failed frames). Content-Type: text/event-stream; the stream ends on the terminal event.

- **Auth:** required

### GET /v1/openapi.json

The live OpenAPI 3.1 description of this surface (self-describing).

- **Auth:** public

### POST /v1/mcp

MCP (Model Context Protocol) JSON-RPC endpoint — agent tool-use over the same facade. Tools: run_flow / get_run / list_flows / describe_flow / collect / get_collection. Resources: crystal://flows and crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op.

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
          },
          "access": {
            "type": "string",
            "enum": [
              "public",
              "private"
            ],
            "description": "Resolvability of the caller's own model (GET /me/models only)."
          },
          "license": {
            "type": "string",
            "description": "License id, e.g. 'apache-2.0' (owner/admin views)."
          },
          "commercialUse": {
            "type": "string",
            "enum": [
              "yes",
              "no",
              "conditional",
              "unknown"
            ],
            "description": "Whether this model may be promoted to the public (commercial) catalog (owner/admin views)."
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

### GET /v1/deposit/config

Buy-credits/deposit UI config: deposit address, points/USD rate, default funding rate, supported chains.

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "description": "Static config for the buy-credits/deposit UI.",
  "properties": {
    "depositAddress": {
      "type": "string",
      "description": "CreditVault address to send deposits to (same on mainnet + Base)."
    },
    "pointsPerUsd": {
      "type": "number",
      "description": "Canonical impetus points per 1 USD (≈ 2967)."
    },
    "defaultFundingRatePct": {
      "type": "number",
      "description": "Default funding rate as a percent (70 = 70% of USD value converts to points)."
    },
    "chains": {
      "type": "array",
      "description": "Supported chains.",
      "items": {
        "type": "object",
        "properties": {
          "chainId": {
            "type": "number"
          },
          "name": {
            "type": "string"
          }
        }
      }
    }
  },
  "required": [
    "depositAddress",
    "pointsPerUsd",
    "defaultFundingRatePct",
    "chains"
  ]
}
```

### POST /v1/deposit/quote

Quote how many impetus points a deposit of a given asset+amount would buy (informational; equals the on-chain credit).

- **Auth:** public

**Request body:**

```json
{
  "type": "object",
  "description": "Quote how many impetus points a deposit would buy, right now (informational; the on-chain credit is authoritative and equal).",
  "properties": {
    "chainId": {
      "type": "string",
      "description": "Chain id ('1' mainnet, '8453' Base)."
    },
    "token": {
      "type": "string",
      "description": "Token address; 0x000…000 for native ETH."
    },
    "amount": {
      "type": "string",
      "description": "Deposit amount in RAW base units (wei for ETH, token-decimals for ERC-20), as a string."
    }
  },
  "required": [
    "chainId",
    "token",
    "amount"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "The points a deposit would be credited (== what the webhook credits for the same input). Gas is NOT deducted.",
  "properties": {
    "chainId": {
      "type": "string"
    },
    "token": {
      "type": "string"
    },
    "amountRaw": {
      "type": "string",
      "description": "Echoed raw base units quoted."
    },
    "grossUsd": {
      "type": "string",
      "description": "Gross USD FMV, formatted (e.g. \"3.000000\")."
    },
    "grossUsdMicro": {
      "type": "string",
      "description": "Exact gross USD FMV in micro-USD."
    },
    "fundingRatePct": {
      "type": "number",
      "description": "Per-asset funding rate applied (e.g. 70)."
    },
    "pointsQuoted": {
      "type": "string",
      "description": "Impetus points the deposit would be credited."
    },
    "depositAddress": {
      "type": "string"
    }
  },
  "required": [
    "pointsQuoted",
    "grossUsd",
    "fundingRatePct",
    "depositAddress"
  ]
}
```

### POST /v1/models/import

Import a model/LoRA by URL (Civitai/HuggingFace/direct) as a private, owner-scoped model — usable in your flows immediately; promoting it to the public catalogue is a separate publish.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Import a model/LoRA by URL as a private, owner-scoped model — usable in your flows at once; never on the public catalogue until a separate publish promotion passes moderation.",
  "properties": {
    "url": {
      "type": "string",
      "description": "A Civitai page (or ?modelVersionId), a HuggingFace repo, or a direct .safetensors/.ckpt link."
    },
    "genus": {
      "type": "string",
      "enum": [
        "lora",
        "model"
      ],
      "description": "For a direct-file URL where the origin can't be scraped to infer it. Default lora."
    }
  },
  "required": [
    "url"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "model": {
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
        },
        "access": {
          "type": "string",
          "enum": [
            "public",
            "private"
          ],
          "description": "Resolvability of the caller's own model (GET /me/models only)."
        },
        "license": {
          "type": "string",
          "description": "License id, e.g. 'apache-2.0' (owner/admin views)."
        },
        "commercialUse": {
          "type": "string",
          "enum": [
            "yes",
            "no",
            "conditional",
            "unknown"
          ],
          "description": "Whether this model may be promoted to the public (commercial) catalog (owner/admin views)."
        }
      },
      "required": [
        "intellaId",
        "nomen",
        "genus"
      ]
    }
  },
  "required": [
    "model"
  ]
}
```

### GET /v1/me/models

List the caller's own privately-held models (imports + trained LoRAs), newest first — the public /v1/models catalog is canonical-only.

- **Auth:** required

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
          },
          "access": {
            "type": "string",
            "enum": [
              "public",
              "private"
            ],
            "description": "Resolvability of the caller's own model (GET /me/models only)."
          },
          "license": {
            "type": "string",
            "description": "License id, e.g. 'apache-2.0' (owner/admin views)."
          },
          "commercialUse": {
            "type": "string",
            "enum": [
              "yes",
              "no",
              "conditional",
              "unknown"
            ],
            "description": "Whether this model may be promoted to the public (commercial) catalog (owner/admin views)."
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

### PUT /v1/models/:id/license

Admin: clear or backfill a model's license so the public-catalog gate treats it correctly (explicit license/commercialUse, or reclassify from the base). Platform-admin only.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Admin: set a model's license clearance so the public-catalog gate treats it correctly. Provide an explicit license/commercialUse, or reclassify:true to re-derive from the base string.",
  "properties": {
    "license": {
      "type": "string",
      "description": "License id to record, e.g. 'apache-2.0', 'stability-community'."
    },
    "commercialUse": {
      "type": "string",
      "enum": [
        "yes",
        "no",
        "conditional",
        "unknown"
      ],
      "description": "The commercial-catalog verdict (the operator's clearance decision)."
    },
    "reclassify": {
      "type": "boolean",
      "description": "Re-derive license + verdict from the model's recorded base string (bulk-fix legacy imports)."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "model": {
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
        },
        "access": {
          "type": "string",
          "enum": [
            "public",
            "private"
          ],
          "description": "Resolvability of the caller's own model (GET /me/models only)."
        },
        "license": {
          "type": "string",
          "description": "License id, e.g. 'apache-2.0' (owner/admin views)."
        },
        "commercialUse": {
          "type": "string",
          "enum": [
            "yes",
            "no",
            "conditional",
            "unknown"
          ],
          "description": "Whether this model may be promoted to the public (commercial) catalog (owner/admin views)."
        }
      },
      "required": [
        "intellaId",
        "nomen",
        "genus"
      ]
    }
  },
  "required": [
    "model"
  ]
}
```

### GET /v1/admin/revenue

Admin: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire). Platform-admin only.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "Admin revenue report: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire, ADR-0012/0013 §5).",
  "properties": {
    "asOf": {
      "type": "string",
      "description": "ISO timestamp the trailing window was computed against."
    },
    "trailingUsdRevenueMicro": {
      "type": "string",
      "description": "Trailing-12mo USD revenue in micro-USD (exact)."
    },
    "trailingUsdRevenue": {
      "type": "string",
      "description": "Trailing-12mo USD revenue, formatted."
    },
    "band": {
      "type": "string",
      "enum": [
        "clear",
        "watch",
        "warn",
        "breach"
      ],
      "description": "Live band of revenue against the binding cap."
    },
    "bindingCapUsd": {
      "type": "number",
      "nullable": true,
      "description": "Tightest active conditional cap (whole USD), or null when dormant."
    },
    "activeConditionalLicenses": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Conditional license ids currently reachable in the public catalog."
    },
    "lastAlertedBand": {
      "type": "string",
      "enum": [
        "clear",
        "watch",
        "warn",
        "breach"
      ],
      "nullable": true,
      "description": "The last band the scheduled evaluator alerted/persisted."
    }
  },
  "required": [
    "asOf",
    "trailingUsdRevenue",
    "band",
    "activeConditionalLicenses"
  ]
}
```

### GET /v1/admin/cogs

Admin: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report. Platform-admin only.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "Admin COGS report: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report.",
  "properties": {
    "asOf": {
      "type": "string",
      "description": "ISO timestamp the trailing window was computed against."
    },
    "sinceIso": {
      "type": "string",
      "description": "ISO timestamp of the trailing window's cutoff (same window the revenue report uses)."
    },
    "costUsd": {
      "type": "number",
      "description": "Trailing-window COGS, whole USD (pod compute spend, per-job costUsd summed)."
    },
    "count": {
      "type": "number",
      "description": "Job count in the trailing window (includes jobs with no cost telemetry, counted at 0)."
    }
  },
  "required": [
    "asOf",
    "sinceIso",
    "costUsd",
    "count"
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

### GET /v1/me

The caller's owner-keyed account settings — presentation skin (Profile), cross-cutting generation defaults (Preferences), and verb→flow bindings. Anon-capable (keyed by AuctorKey).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The caller's owner-keyed account settings — appearance + generation defaults + verb bindings.",
  "properties": {
    "appearance": {
      "type": "object",
      "description": "The owner's presentation skin — all fields optional.",
      "properties": {
        "avatarUrl": {
          "type": "string",
          "description": "PFP / avatar image URL."
        },
        "bannerUrl": {
          "type": "string",
          "description": "Banner image URL."
        },
        "backgroundUrl": {
          "type": "string",
          "description": "Background image URL."
        },
        "accent": {
          "type": "string",
          "description": "One signal color (hex)."
        },
        "look": {
          "type": "string",
          "description": "Signature look tag (e.g. 'clean' | 'n64' | 'vapor' | 'editorial')."
        }
      }
    },
    "generatio": {
      "type": "object",
      "description": "The owner's cross-cutting generation defaults, applied at cast time — all optional.",
      "properties": {
        "style": {
          "type": "string",
          "description": "Prepended to the prompt when the flow has a prompt input."
        },
        "negativePrompt": {
          "type": "string",
          "description": "Fills a flow's negative-prompt input when the caller didn't provide one."
        },
        "outputFormat": {
          "type": "string",
          "description": "Preferred output encoding (stored; runner-applied where supported)."
        },
        "telegramDeliverAs": {
          "type": "string",
          "enum": [
            "album",
            "individual"
          ],
          "description": "Telegram delivery shape (consumed by the Telegram adapter)."
        },
        "autoApplyModels": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Models (intellaId) to auto-apply as pinnedModels. Stored; cast-time application pending model resolution."
        },
        "defaultProjectId": {
          "type": "string",
          "description": "Default project (Provincia id) new work files into. Stored; cast-time auto-filing pending."
        }
      }
    },
    "bindings": {
      "type": "array",
      "items": {
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
      },
      "description": "The verb→flow overrides the owner has set."
    },
    "secrets": {
      "type": "object",
      "description": "BYO gated-origin credential connect state, per provider.",
      "properties": {
        "civitai": {
          "type": "string",
          "enum": [
            "connected",
            "absent"
          ],
          "description": "Civitai token connect state."
        },
        "huggingface": {
          "type": "string",
          "enum": [
            "connected",
            "absent"
          ],
          "description": "HuggingFace token connect state."
        }
      },
      "required": [
        "civitai",
        "huggingface"
      ]
    },
    "secretsAvailable": {
      "type": "boolean",
      "description": "Whether this deployment can store BYO secrets (a secret store is wired). false → connecting is unavailable here; hide/disable the panel."
    },
    "admin": {
      "type": "boolean",
      "description": "Whether this caller is the platform administrator (the moderation reviewer). Gates the feed-review surface + approve/reject/confirm-csam controls. true only on the platform session."
    }
  },
  "required": [
    "bindings",
    "secrets",
    "secretsAvailable",
    "admin"
  ]
}
```

### PUT /v1/me/appearance

Replace the caller's presentation skin (avatar/banner/background/accent/look).

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "The owner's presentation skin — all fields optional.",
  "properties": {
    "avatarUrl": {
      "type": "string",
      "description": "PFP / avatar image URL."
    },
    "bannerUrl": {
      "type": "string",
      "description": "Banner image URL."
    },
    "backgroundUrl": {
      "type": "string",
      "description": "Background image URL."
    },
    "accent": {
      "type": "string",
      "description": "One signal color (hex)."
    },
    "look": {
      "type": "string",
      "description": "Signature look tag (e.g. 'clean' | 'n64' | 'vapor' | 'editorial')."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "appearance": {
      "type": "object",
      "description": "The owner's presentation skin — all fields optional.",
      "properties": {
        "avatarUrl": {
          "type": "string",
          "description": "PFP / avatar image URL."
        },
        "bannerUrl": {
          "type": "string",
          "description": "Banner image URL."
        },
        "backgroundUrl": {
          "type": "string",
          "description": "Background image URL."
        },
        "accent": {
          "type": "string",
          "description": "One signal color (hex)."
        },
        "look": {
          "type": "string",
          "description": "Signature look tag (e.g. 'clean' | 'n64' | 'vapor' | 'editorial')."
        }
      }
    }
  },
  "required": [
    "appearance"
  ]
}
```

### PUT /v1/me/generatio

Replace the caller's cross-cutting generation defaults (style, negative prompt, output format, telegram delivery, auto-apply models). Applied at cast time under the affines precedence chain.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "The owner's cross-cutting generation defaults, applied at cast time — all optional.",
  "properties": {
    "style": {
      "type": "string",
      "description": "Prepended to the prompt when the flow has a prompt input."
    },
    "negativePrompt": {
      "type": "string",
      "description": "Fills a flow's negative-prompt input when the caller didn't provide one."
    },
    "outputFormat": {
      "type": "string",
      "description": "Preferred output encoding (stored; runner-applied where supported)."
    },
    "telegramDeliverAs": {
      "type": "string",
      "enum": [
        "album",
        "individual"
      ],
      "description": "Telegram delivery shape (consumed by the Telegram adapter)."
    },
    "autoApplyModels": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Models (intellaId) to auto-apply as pinnedModels. Stored; cast-time application pending model resolution."
    },
    "defaultProjectId": {
      "type": "string",
      "description": "Default project (Provincia id) new work files into. Stored; cast-time auto-filing pending."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "generatio": {
      "type": "object",
      "description": "The owner's cross-cutting generation defaults, applied at cast time — all optional.",
      "properties": {
        "style": {
          "type": "string",
          "description": "Prepended to the prompt when the flow has a prompt input."
        },
        "negativePrompt": {
          "type": "string",
          "description": "Fills a flow's negative-prompt input when the caller didn't provide one."
        },
        "outputFormat": {
          "type": "string",
          "description": "Preferred output encoding (stored; runner-applied where supported)."
        },
        "telegramDeliverAs": {
          "type": "string",
          "enum": [
            "album",
            "individual"
          ],
          "description": "Telegram delivery shape (consumed by the Telegram adapter)."
        },
        "autoApplyModels": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Models (intellaId) to auto-apply as pinnedModels. Stored; cast-time application pending model resolution."
        },
        "defaultProjectId": {
          "type": "string",
          "description": "Default project (Provincia id) new work files into. Stored; cast-time auto-filing pending."
        }
      }
    }
  },
  "required": [
    "generatio"
  ]
}
```

### PUT /v1/me/secrets/:provider

Connect a BYO gated-origin credential (civitai|huggingface) so gated model imports can download their weights. The token is sealed at rest at once and never echoed back. Anon-capable (a Bursa purse is a valid owner); anonymous callers receive a deanonymization warning.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Connect a BYO gated-origin credential. The token is sealed at rest at once and never echoed back.",
  "properties": {
    "token": {
      "type": "string",
      "description": "The provider API token/key (Civitai key or HuggingFace token)."
    },
    "idleDays": {
      "type": "number",
      "description": "Idle-expiry window in days (default 90). The secret is forgotten after this long without a real use."
    }
  },
  "required": [
    "token"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "Connect/disconnect result. Never includes the token.",
  "properties": {
    "provider": {
      "type": "string",
      "enum": [
        "civitai",
        "huggingface"
      ],
      "description": "The provider affected."
    },
    "status": {
      "type": "string",
      "enum": [
        "connected",
        "absent"
      ],
      "description": "The resulting connect state."
    },
    "expiresAt": {
      "type": "string",
      "description": "Idle-expiry deadline (ISO) — present when connected."
    },
    "warning": {
      "type": "string",
      "description": "Deanonymization caution — present for anonymous (purse) callers."
    }
  },
  "required": [
    "provider",
    "status"
  ]
}
```

### DELETE /v1/me/secrets/:provider

Disconnect the caller's BYO credential for a provider (civitai|huggingface). Idempotent.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "Connect/disconnect result. Never includes the token.",
  "properties": {
    "provider": {
      "type": "string",
      "enum": [
        "civitai",
        "huggingface"
      ],
      "description": "The provider affected."
    },
    "status": {
      "type": "string",
      "enum": [
        "connected",
        "absent"
      ],
      "description": "The resulting connect state."
    },
    "expiresAt": {
      "type": "string",
      "description": "Idle-expiry deadline (ISO) — present when connected."
    },
    "warning": {
      "type": "string",
      "description": "Deanonymization caution — present for anonymous (purse) callers."
    }
  },
  "required": [
    "provider",
    "status"
  ]
}
```

### GET /v1/me/affines/:modusId

The caller's per-flow input defaults for one flow (`{ inputKey: value }`).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "Per-flow input defaults (`{ inputKey: value }`) applied under the cast-time aditus.",
  "properties": {
    "affines": {
      "type": "object",
      "additionalProperties": true,
      "description": "Input-key → default value map."
    }
  },
  "required": [
    "affines"
  ]
}
```

### PUT /v1/me/affines/:modusId

Replace the caller's per-flow input defaults for one flow. Applied under the cast-time aditus (cast-time > affines > generatio > modus defaults).

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Per-flow input defaults (`{ inputKey: value }`) applied under the cast-time aditus.",
  "properties": {
    "affines": {
      "type": "object",
      "additionalProperties": true,
      "description": "Input-key → default value map."
    }
  },
  "required": [
    "affines"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "Per-flow input defaults (`{ inputKey: value }`) applied under the cast-time aditus.",
  "properties": {
    "affines": {
      "type": "object",
      "additionalProperties": true,
      "description": "Input-key → default value map."
    }
  },
  "required": [
    "affines"
  ]
}
```

### POST /v1/studios

Lease a hosted warm studio (a persistent GPU session) for fast repeated runs. Returns a provisioning handle immediately; poll GET /v1/studios/:id (or set options.webhookUrl). maxImpetus is the session budget — the studio drain-terminates at the cap.

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
    },
    "options": {
      "type": "object",
      "description": "Optional per-provision settings.",
      "properties": {
        "webhookUrl": {
          "type": "string",
          "description": "Fire-and-forget POST when the studio is ready (or failed) — sugar over polling GET /v1/studios/:id."
        }
      }
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

### GET /v1/studios/:id

Fetch one of the caller's studios by id (owner-scoped) — poll its status (provisioning → idle) after provisioning.

- **Auth:** required

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

### POST /v1/collectiones

Start a Collection — expand one flow over a Tractus[] parameter grid into `total` pieces (general batch / NFT-collection generation). With `draft:true` it is created but NOT fired (author tractus, then POST /:id/fire). Returns a Collection handle (poll GET /v1/collectiones/:id).

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Start a Collection — expand one flow over a Tractus[] parameter grid into `total` pieces. The base modus may be atomic or a compositus pipeline.",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "The flow expanded across the grid."
    },
    "total": {
      "type": "number",
      "description": "Target number of pieces to generate."
    },
    "tractus": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "One axis of variation — the aditus port to vary and its options.",
        "properties": {
          "porta": {
            "type": "string",
            "description": "The aditus port key this axis varies (e.g. background, outfit)."
          },
          "label": {
            "type": "string",
            "description": "Human-facing category label (falls back to porta)."
          },
          "valores": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "One option within a trait axis.",
              "properties": {
                "value": {
                  "description": "The aditus value injected when this option is selected."
                },
                "label": {
                  "type": "string",
                  "description": "Human-facing display name (falls back to String(value))."
                },
                "rarity": {
                  "type": "number",
                  "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                },
                "promptFragment": {
                  "type": "string",
                  "description": "Text woven into the assembled prompt when this option wins."
                },
                "excludes": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Labels in OTHER axes this option blocks."
                },
                "tags": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Theme tags for group-level mutual exclusion."
                }
              },
              "required": [
                "value"
              ]
            },
            "description": "The options for this axis."
          }
        },
        "required": [
          "porta",
          "valores"
        ]
      },
      "description": "The axes of variation (the parameter grid)."
    },
    "aditusBase": {
      "type": "object",
      "additionalProperties": true,
      "description": "Base aditus applied to every piece (e.g. `_basePrompt` with `{{porta}}` tokens)."
    },
    "concurrentia": {
      "type": "number",
      "description": "Max concurrent pieces in flight (default 3)."
    },
    "nomen": {
      "type": "string",
      "description": "Optional human name for the collection."
    },
    "dna": {
      "type": "boolean",
      "description": "Opt-in DNA uniqueness — no two pieces share a trait combination (across non-bypassDNA axes). Default false."
    },
    "reviewEnabled": {
      "type": "boolean",
      "description": "Hold every completed piece for review before it counts toward the drop (approve/reject in curation). Omit → the platform default applies."
    },
    "draft": {
      "type": "boolean",
      "description": "Create as a DRAFT — author tractus (garden/rules) without firing. Start it later with POST /:id/fire. Omit/false → create + fire in one shot."
    },
    "teamId": {
      "type": "string",
      "description": "Own this collection by a team (Sodalitas) the caller is a member of — snapshots an equal-weight owners split."
    }
  },
  "required": [
    "modusId",
    "total",
    "tractus"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### PATCH /v1/collectiones/:id/tractus

Edit a DRAFT Collection’s trait axes/values/rules (the garden + rules authoring write). Re-derives the provenance hash; rejected (input.malformed) once the collection is fired. Owner-scoped.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Replace a draft Collection’s trait axes/values/rules. Re-derives the provenance hash; rejected once the collection is fired.",
  "properties": {
    "tractus": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "One axis of variation — the aditus port to vary and its options.",
        "properties": {
          "porta": {
            "type": "string",
            "description": "The aditus port key this axis varies (e.g. background, outfit)."
          },
          "label": {
            "type": "string",
            "description": "Human-facing category label (falls back to porta)."
          },
          "valores": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "One option within a trait axis.",
              "properties": {
                "value": {
                  "description": "The aditus value injected when this option is selected."
                },
                "label": {
                  "type": "string",
                  "description": "Human-facing display name (falls back to String(value))."
                },
                "rarity": {
                  "type": "number",
                  "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                },
                "promptFragment": {
                  "type": "string",
                  "description": "Text woven into the assembled prompt when this option wins."
                },
                "excludes": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Labels in OTHER axes this option blocks."
                },
                "tags": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Theme tags for group-level mutual exclusion."
                }
              },
              "required": [
                "value"
              ]
            },
            "description": "The options for this axis."
          }
        },
        "required": [
          "porta",
          "valores"
        ]
      },
      "description": "The full new set of axes of variation (replaces the existing grid)."
    }
  },
  "required": [
    "tractus"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### POST /v1/collectiones/:id/fire

Freeze a DRAFT Collection’s tractus and start the run — pins provenance to the flow version at fire time, then dispatches. Funder-only; rejected unless the collection is a draft.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### GET /v1/collectiones

List the authenticated caller's Collections (owner-scoped).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collections": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
        "properties": {
          "id": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "The collection display name."
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "pending",
              "running",
              "complete",
              "cancelled"
            ],
            "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
          },
          "modusId": {
            "type": "string",
            "description": "The flow (modus) expanded across the grid."
          },
          "total": {
            "type": "number",
            "description": "Target piece count (the size of the run)."
          },
          "provenanceHash": {
            "type": "string",
            "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
          },
          "tractus": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "One axis of variation — the aditus port to vary and its options.",
              "properties": {
                "porta": {
                  "type": "string",
                  "description": "The aditus port key this axis varies (e.g. background, outfit)."
                },
                "label": {
                  "type": "string",
                  "description": "Human-facing category label (falls back to porta)."
                },
                "valores": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "One option within a trait axis.",
                    "properties": {
                      "value": {
                        "description": "The aditus value injected when this option is selected."
                      },
                      "label": {
                        "type": "string",
                        "description": "Human-facing display name (falls back to String(value))."
                      },
                      "rarity": {
                        "type": "number",
                        "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                      },
                      "promptFragment": {
                        "type": "string",
                        "description": "Text woven into the assembled prompt when this option wins."
                      },
                      "excludes": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        },
                        "description": "Labels in OTHER axes this option blocks."
                      },
                      "tags": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        },
                        "description": "Theme tags for group-level mutual exclusion."
                      }
                    },
                    "required": [
                      "value"
                    ]
                  },
                  "description": "The options for this axis."
                }
              },
              "required": [
                "porta",
                "valores"
              ]
            },
            "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
          },
          "reviewEnabled": {
            "type": "boolean",
            "description": "Whether each piece is held for review before it counts."
          },
          "owners": {
            "type": "array",
            "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
            "items": {
              "type": "object",
              "properties": {
                "animaId": {
                  "type": "string"
                },
                "weight": {
                  "type": "number"
                }
              },
              "required": [
                "animaId",
                "weight"
              ]
            }
          },
          "completed": {
            "type": "number",
            "description": "Pieces completed so far (approved, when review is on)."
          },
          "failed": {
            "type": "number",
            "description": "Pieces that failed to generate so far."
          },
          "rejected": {
            "type": "number",
            "description": "Pieces a reviewer rejected so far (distinct from failed)."
          },
          "cost": {
            "type": "string",
            "description": "Total impetus across completed pieces, serialised as a string."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "When the collection started."
          },
          "completedAt": {
            "type": "string",
            "format": "date-time",
            "description": "When it finished (or was cancelled)."
          }
        },
        "required": [
          "id",
          "status",
          "modusId",
          "total",
          "provenanceHash",
          "completed",
          "failed",
          "rejected"
        ]
      }
    }
  },
  "required": [
    "collections"
  ]
}
```

### GET /v1/collectiones/:id

Fetch one Collection by id — progress (completed/failed/total), status, cost. Owner-scoped (404 if not yours).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### GET /v1/collectiones/:id/rarity

Imagined-vs-realized rarity table for a Collection — target shares (from trait weights) vs actual shares (from produced pieces). Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "rarity": {
      "type": "object",
      "description": "Imagined (target) vs realized rarity per trait axis — drift is expected at low N.",
      "properties": {
        "totalPieces": {
          "type": "number",
          "description": "Produced pieces the realized figures are computed over."
        },
        "axes": {
          "type": "array",
          "description": "One entry per trait axis.",
          "items": {
            "type": "object",
            "properties": {
              "trait_type": {
                "type": "string",
                "description": "The axis label (matches the NFT trait_type)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "value": {
                      "type": "string",
                      "description": "The attribute value as stamped on pieces."
                    },
                    "targetRarity": {
                      "type": "number",
                      "description": "Target share: the weight normalised within its axis [0,1]."
                    },
                    "realizedCount": {
                      "type": "number",
                      "description": "Produced pieces that got this value."
                    },
                    "realizedRarity": {
                      "type": "number",
                      "description": "realizedCount / totalPieces [0,1]."
                    }
                  },
                  "required": [
                    "value",
                    "targetRarity",
                    "realizedCount",
                    "realizedRarity"
                  ]
                }
              }
            },
            "required": [
              "trait_type",
              "valores"
            ]
          }
        }
      },
      "required": [
        "totalPieces",
        "axes"
      ]
    }
  },
  "required": [
    "rarity"
  ]
}
```

### GET /v1/collectiones/:id/pieces

The curation queue — a Collection's generated pieces (media + stamped attributes + review state), filtered by ?review=pending|approved|rejected|all (default pending). Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "pieces": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A generated collection piece — the Actum's output media + stamped attributes + review state.",
        "properties": {
          "actumId": {
            "type": "string",
            "description": "The piece Actum id (pass to approve/reject)."
          },
          "review": {
            "type": "string",
            "enum": [
              "pending",
              "approved",
              "rejected",
              "none"
            ],
            "description": "Review state (none = review not enabled)."
          },
          "output": {
            "type": "object",
            "additionalProperties": true,
            "description": "The Actum's exitus (media URL under its declared Porta key)."
          },
          "attributes": {
            "type": "array",
            "description": "The trait attributes stamped on this piece.",
            "items": {
              "type": "object",
              "properties": {
                "trait_type": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              },
              "required": [
                "trait_type",
                "value"
              ]
            }
          }
        },
        "required": [
          "actumId",
          "review"
        ]
      }
    }
  },
  "required": [
    "pieces"
  ]
}
```

### POST /v1/collectiones/:id/extend

Extend a Collection — raise the target by `count` and dispatch the new pieces (incremental batches: fire a batch, review, fire more). Re-opens a completed Collection. Owner-scoped.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "How many more pieces to add to the target and fire.",
  "properties": {
    "count": {
      "type": "number",
      "description": "Pieces to add (must be > 0)."
    }
  },
  "required": [
    "count"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### POST /v1/collectiones/:id/pause

Pause a Collection — stop dispatching new pieces; in-flight pieces finish. Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### POST /v1/collectiones/:id/resume

Resume a paused Collection — continue dispatching toward the target. Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### POST /v1/collectiones/:id/cancel

Cancel a Collection — stop dispatching and mark it cancelled. Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "collection": {
      "type": "object",
      "description": "The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The collection display name."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "pending",
            "running",
            "complete",
            "cancelled"
          ],
          "description": "The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable)."
        },
        "modusId": {
          "type": "string",
          "description": "The flow (modus) expanded across the grid."
        },
        "total": {
          "type": "number",
          "description": "Target piece count (the size of the run)."
        },
        "provenanceHash": {
          "type": "string",
          "description": "Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash."
        },
        "tractus": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "One axis of variation — the aditus port to vary and its options.",
            "properties": {
              "porta": {
                "type": "string",
                "description": "The aditus port key this axis varies (e.g. background, outfit)."
              },
              "label": {
                "type": "string",
                "description": "Human-facing category label (falls back to porta)."
              },
              "valores": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One option within a trait axis.",
                  "properties": {
                    "value": {
                      "description": "The aditus value injected when this option is selected."
                    },
                    "label": {
                      "type": "string",
                      "description": "Human-facing display name (falls back to String(value))."
                    },
                    "rarity": {
                      "type": "number",
                      "description": "Probability weight for weighted-random selection (default 0.5; higher = more common)."
                    },
                    "promptFragment": {
                      "type": "string",
                      "description": "Text woven into the assembled prompt when this option wins."
                    },
                    "excludes": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Labels in OTHER axes this option blocks."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "description": "Theme tags for group-level mutual exclusion."
                    }
                  },
                  "required": [
                    "value"
                  ]
                },
                "description": "The options for this axis."
              }
            },
            "required": [
              "porta",
              "valores"
            ]
          },
          "description": "The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired."
        },
        "reviewEnabled": {
          "type": "boolean",
          "description": "Whether each piece is held for review before it counts."
        },
        "owners": {
          "type": "array",
          "description": "Per-artifact ownership split (team-owned collections only) — weights sum to 1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "completed": {
          "type": "number",
          "description": "Pieces completed so far (approved, when review is on)."
        },
        "failed": {
          "type": "number",
          "description": "Pieces that failed to generate so far."
        },
        "rejected": {
          "type": "number",
          "description": "Pieces a reviewer rejected so far (distinct from failed)."
        },
        "cost": {
          "type": "string",
          "description": "Total impetus across completed pieces, serialised as a string."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the collection started."
        },
        "completedAt": {
          "type": "string",
          "format": "date-time",
          "description": "When it finished (or was cancelled)."
        }
      },
      "required": [
        "id",
        "status",
        "modusId",
        "total",
        "provenanceHash",
        "completed",
        "failed",
        "rejected"
      ]
    }
  },
  "required": [
    "collection"
  ]
}
```

### POST /v1/collectiones/:id/pieces/:actumId/approve

Approve a pending-review piece — it counts toward the collection. Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### POST /v1/collectiones/:id/pieces/:actumId/reject

Reject a piece and reroll — re-fire it with a fresh trait selection. Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### POST /v1/editiones

Publish an artifact (an Actum for #1) to a destination under a visibility/custody policy. Public surfaces (feed/marketplace) return a `pending` Edition and settle asynchronously through the moderation gate — never a synchronous publish to public. Unspecified fields default from the caller's publishing prefs.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Publish an artifact (an Actum for build-order #1) to a destination under a visibility/custody policy. Public surfaces (feed/marketplace) return a `pending` Edition and settle asynchronously through the moderation gate. Unspecified fields default from the caller's Anima publishing prefs.",
  "properties": {
    "artifact": {
      "type": "object",
      "description": "The canonical artifact being published (referenced, never copied).",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "actum",
            "intella",
            "collectio"
          ],
          "description": "Which artifact kind."
        },
        "id": {
          "type": "string",
          "description": "The artifact's id."
        }
      },
      "required": [
        "kind",
        "id"
      ]
    },
    "destination": {
      "type": "string",
      "description": "Adapter key (e.g. 'feed'). Defaults from prefs, then 'feed'."
    },
    "visibility": {
      "type": "string",
      "enum": [
        "private",
        "unlisted",
        "feed",
        "marketplace"
      ],
      "description": "Public-exposure surface."
    },
    "custody": {
      "type": "string",
      "enum": [
        "ours",
        "theirs",
        "both"
      ],
      "description": "Who holds the bytes/metadata."
    },
    "license": {
      "type": "string",
      "description": "License tag — 'catalog' (our liability) | a BYO license id. Defaults from prefs, then 'catalog' for platform-canonical artifacts."
    },
    "teamId": {
      "type": "string",
      "description": "Snapshot an equal-weight rights split from a team (Sodalitas) the caller is a member of. Mutually exclusive with owners."
    },
    "owners": {
      "type": "array",
      "description": "Explicit rights split — animaId → weight, weights must sum to 1. Mutually exclusive with teamId. Snapshotted on the Editio as the canonical who-earns record (drives the model-royalty split).",
      "items": {
        "type": "object",
        "properties": {
          "animaId": {
            "type": "string"
          },
          "weight": {
            "type": "number"
          }
        },
        "required": [
          "animaId",
          "weight"
        ]
      }
    }
  },
  "required": [
    "artifact"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "edition": {
      "type": "object",
      "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
      "properties": {
        "id": {
          "type": "string"
        },
        "artifact": {
          "type": "object",
          "description": "The canonical artifact being published (referenced, never copied).",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "actum",
                "intella",
                "collectio"
              ],
              "description": "Which artifact kind."
            },
            "id": {
              "type": "string",
              "description": "The artifact's id."
            }
          },
          "required": [
            "kind",
            "id"
          ]
        },
        "destination": {
          "type": "string",
          "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "private",
            "unlisted",
            "feed",
            "marketplace"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "ours",
            "theirs",
            "both"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "published",
            "rejected",
            "failed",
            "retracted"
          ],
          "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
        },
        "reviewOutcome": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ],
          "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
        },
        "externalRef": {
          "type": "string",
          "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
        },
        "owners": {
          "type": "array",
          "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "license": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "artifact",
        "destination",
        "visibility",
        "custody",
        "status",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "edition"
  ]
}
```

### GET /v1/editiones/review

The human-review queue: publications the moderation gate HELD for review (spec §4). An author sees their own held items; the platform administrator sees all of them.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "editions": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
        "properties": {
          "id": {
            "type": "string"
          },
          "artifact": {
            "type": "object",
            "description": "The canonical artifact being published (referenced, never copied).",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "actum",
                  "intella",
                  "collectio"
                ],
                "description": "Which artifact kind."
              },
              "id": {
                "type": "string",
                "description": "The artifact's id."
              }
            },
            "required": [
              "kind",
              "id"
            ]
          },
          "destination": {
            "type": "string",
            "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
          },
          "visibility": {
            "type": "string",
            "enum": [
              "private",
              "unlisted",
              "feed",
              "marketplace"
            ]
          },
          "custody": {
            "type": "string",
            "enum": [
              "ours",
              "theirs",
              "both"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "published",
              "rejected",
              "failed",
              "retracted"
            ],
            "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
          },
          "reviewOutcome": {
            "type": "string",
            "enum": [
              "pending",
              "approved",
              "rejected"
            ],
            "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
          },
          "externalRef": {
            "type": "string",
            "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
          },
          "owners": {
            "type": "array",
            "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
            "items": {
              "type": "object",
              "properties": {
                "animaId": {
                  "type": "string"
                },
                "weight": {
                  "type": "number"
                }
              },
              "required": [
                "animaId",
                "weight"
              ]
            }
          },
          "license": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "artifact",
          "destination",
          "visibility",
          "custody",
          "status",
          "createdAt",
          "updatedAt"
        ]
      }
    }
  },
  "required": [
    "editions"
  ]
}
```

### GET /v1/editiones/:id

Fetch one publication (author-scoped). Poll it to watch a `pending` settle land — an async archive ZIP build finishing (`externalRef` = the download url), or a public surface being gated.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "edition": {
      "type": "object",
      "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
      "properties": {
        "id": {
          "type": "string"
        },
        "artifact": {
          "type": "object",
          "description": "The canonical artifact being published (referenced, never copied).",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "actum",
                "intella",
                "collectio"
              ],
              "description": "Which artifact kind."
            },
            "id": {
              "type": "string",
              "description": "The artifact's id."
            }
          },
          "required": [
            "kind",
            "id"
          ]
        },
        "destination": {
          "type": "string",
          "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "private",
            "unlisted",
            "feed",
            "marketplace"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "ours",
            "theirs",
            "both"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "published",
            "rejected",
            "failed",
            "retracted"
          ],
          "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
        },
        "reviewOutcome": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ],
          "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
        },
        "externalRef": {
          "type": "string",
          "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
        },
        "owners": {
          "type": "array",
          "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "license": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "artifact",
        "destination",
        "visibility",
        "custody",
        "status",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "edition"
  ]
}
```

### POST /v1/editiones/:id/retract

Retract a publication where the destination allows it (feed/bucket = revocable; mint = permanent → 403). Author-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "edition": {
      "type": "object",
      "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
      "properties": {
        "id": {
          "type": "string"
        },
        "artifact": {
          "type": "object",
          "description": "The canonical artifact being published (referenced, never copied).",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "actum",
                "intella",
                "collectio"
              ],
              "description": "Which artifact kind."
            },
            "id": {
              "type": "string",
              "description": "The artifact's id."
            }
          },
          "required": [
            "kind",
            "id"
          ]
        },
        "destination": {
          "type": "string",
          "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "private",
            "unlisted",
            "feed",
            "marketplace"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "ours",
            "theirs",
            "both"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "published",
            "rejected",
            "failed",
            "retracted"
          ],
          "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
        },
        "reviewOutcome": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ],
          "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
        },
        "externalRef": {
          "type": "string",
          "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
        },
        "owners": {
          "type": "array",
          "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "license": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "artifact",
        "destination",
        "visibility",
        "custody",
        "status",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "edition"
  ]
}
```

### POST /v1/editiones/:id/approve

Clear a moderation HOLD so the held publication re-settles and publishes (spec §4). Restricted to the platform administrator — an author cannot clear their own held content.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "edition": {
      "type": "object",
      "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
      "properties": {
        "id": {
          "type": "string"
        },
        "artifact": {
          "type": "object",
          "description": "The canonical artifact being published (referenced, never copied).",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "actum",
                "intella",
                "collectio"
              ],
              "description": "Which artifact kind."
            },
            "id": {
              "type": "string",
              "description": "The artifact's id."
            }
          },
          "required": [
            "kind",
            "id"
          ]
        },
        "destination": {
          "type": "string",
          "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "private",
            "unlisted",
            "feed",
            "marketplace"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "ours",
            "theirs",
            "both"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "published",
            "rejected",
            "failed",
            "retracted"
          ],
          "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
        },
        "reviewOutcome": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ],
          "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
        },
        "externalRef": {
          "type": "string",
          "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
        },
        "owners": {
          "type": "array",
          "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "license": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "artifact",
        "destination",
        "visibility",
        "custody",
        "status",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "edition"
  ]
}
```

### POST /v1/editiones/:id/reject

Decline a held publication → terminal `rejected` (spec §4). Restricted to the platform administrator. Filing a CSAM report is a separate, explicit human action — never automatic.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "edition": {
      "type": "object",
      "description": "The public projection of an Editio — a publication record referencing a canonical artifact.",
      "properties": {
        "id": {
          "type": "string"
        },
        "artifact": {
          "type": "object",
          "description": "The canonical artifact being published (referenced, never copied).",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "actum",
                "intella",
                "collectio"
              ],
              "description": "Which artifact kind."
            },
            "id": {
              "type": "string",
              "description": "The artifact's id."
            }
          },
          "required": [
            "kind",
            "id"
          ]
        },
        "destination": {
          "type": "string",
          "description": "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …"
        },
        "visibility": {
          "type": "string",
          "enum": [
            "private",
            "unlisted",
            "feed",
            "marketplace"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "ours",
            "theirs",
            "both"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "published",
            "rejected",
            "failed",
            "retracted"
          ],
          "description": "Lifecycle: pending → published | rejected | failed; retracted on unpublish."
        },
        "reviewOutcome": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ],
          "description": "Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path."
        },
        "externalRef": {
          "type": "string",
          "description": "The destination's handle — feed post id / HF repo / token id / R2 url."
        },
        "owners": {
          "type": "array",
          "description": "Rights split snapshot (team-owned only) — weights sum to ~1.",
          "items": {
            "type": "object",
            "properties": {
              "animaId": {
                "type": "string"
              },
              "weight": {
                "type": "number"
              }
            },
            "required": [
              "animaId",
              "weight"
            ]
          }
        },
        "license": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "artifact",
        "destination",
        "visibility",
        "custody",
        "status",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "edition"
  ]
}
```

### GET /v1/feed

The public feed — published, public-surface editions newest first (NOT auth-scoped). Each item carries the referenced artifact's produced output. Query: visibility, destination, limit.

- **Auth:** public

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "feed": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A published feed entry — the Editio plus the referenced artifact's produced output.",
        "properties": {
          "editionId": {
            "type": "string",
            "description": "The Editio id (the feed entry id)."
          },
          "artifact": {
            "type": "object",
            "description": "The canonical artifact being published (referenced, never copied).",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "actum",
                  "intella",
                  "collectio"
                ],
                "description": "Which artifact kind."
              },
              "id": {
                "type": "string",
                "description": "The artifact's id."
              }
            },
            "required": [
              "kind",
              "id"
            ]
          },
          "output": {
            "type": "object",
            "additionalProperties": true,
            "description": "The artifact's produced output (an Actum's exitus media), when resolvable."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "editionId",
          "artifact",
          "createdAt"
        ]
      }
    }
  },
  "required": [
    "feed"
  ]
}
```

### POST /v1/teams

Create a team (Sodalitas) — a fellowship of Animae that co-owns work. The caller becomes the founder and first member.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Create a team. The caller becomes the founder and first member.",
  "properties": {
    "nomen": {
      "type": "string",
      "description": "The team display name."
    },
    "members": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Additional member Anima ids to seed."
    }
  },
  "required": [
    "nomen"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "team": {
      "type": "object",
      "description": "A team (Sodalitas) — a fellowship of Animae that co-owns work.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The team display name."
        },
        "members": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Member Anima ids (includes the founder)."
        },
        "founder": {
          "type": "string",
          "description": "The founder's Anima id."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "members",
        "founder",
        "createdAt"
      ]
    }
  },
  "required": [
    "team"
  ]
}
```

### GET /v1/teams

List the caller's teams (every team they are a member of).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "teams": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A team (Sodalitas) — a fellowship of Animae that co-owns work.",
        "properties": {
          "id": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "The team display name."
          },
          "members": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Member Anima ids (includes the founder)."
          },
          "founder": {
            "type": "string",
            "description": "The founder's Anima id."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "nomen",
          "members",
          "founder",
          "createdAt"
        ]
      }
    }
  },
  "required": [
    "teams"
  ]
}
```

### GET /v1/teams/:id

Fetch one team by id. Member-scoped (404 if not a member).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "team": {
      "type": "object",
      "description": "A team (Sodalitas) — a fellowship of Animae that co-owns work.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The team display name."
        },
        "members": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Member Anima ids (includes the founder)."
        },
        "founder": {
          "type": "string",
          "description": "The founder's Anima id."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "members",
        "founder",
        "createdAt"
      ]
    }
  },
  "required": [
    "team"
  ]
}
```

### POST /v1/teams/:id/members

Add a member to a team. Member-scoped; idempotent.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Add a member to a team.",
  "properties": {
    "animaId": {
      "type": "string",
      "description": "The Anima id to add."
    }
  },
  "required": [
    "animaId"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "team": {
      "type": "object",
      "description": "A team (Sodalitas) — a fellowship of Animae that co-owns work.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The team display name."
        },
        "members": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Member Anima ids (includes the founder)."
        },
        "founder": {
          "type": "string",
          "description": "The founder's Anima id."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "members",
        "founder",
        "createdAt"
      ]
    }
  },
  "required": [
    "team"
  ]
}
```

### DELETE /v1/teams/:id/members/:animaId

Remove a member from a team (the founder cannot be removed). Member-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "team": {
      "type": "object",
      "description": "A team (Sodalitas) — a fellowship of Animae that co-owns work.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The team display name."
        },
        "members": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Member Anima ids (includes the founder)."
        },
        "founder": {
          "type": "string",
          "description": "The founder's Anima id."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "members",
        "founder",
        "createdAt"
      ]
    }
  },
  "required": [
    "team"
  ]
}
```

### GET /v1/me/projects

List the caller's projects (Provincia) — account-owned workspace lenses. Identified callers only.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "projects": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
        "properties": {
          "id": {
            "type": "string"
          },
          "owner": {
            "type": "string",
            "description": "The owning Anima id (the project's hard ownership boundary)."
          },
          "name": {
            "type": "string",
            "description": "The project display name."
          },
          "desc": {
            "type": "string",
            "description": "Optional description."
          },
          "glyph": {
            "type": "string",
            "description": "Presentation glyph."
          },
          "color": {
            "type": "string",
            "description": "Presentation color."
          },
          "datasetIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Filed dataset ids."
          },
          "modelIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Filed model (Intella) ids."
          },
          "collectionIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Filed collection ids."
          },
          "teamId": {
            "type": "string",
            "description": "Optional referenced Team (Sodalitas) id — the shared member set."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "owner",
          "name",
          "datasetIds",
          "modelIds",
          "collectionIds",
          "createdAt",
          "updatedAt"
        ]
      }
    }
  },
  "required": [
    "projects"
  ]
}
```

### POST /v1/me/projects

Create a project owned by the caller. Holdings start empty; assets are filed in by reference.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Create a project owned by the caller.",
  "properties": {
    "name": {
      "type": "string",
      "description": "The project display name."
    },
    "desc": {
      "type": "string",
      "description": "Optional description."
    },
    "glyph": {
      "type": "string",
      "description": "Presentation glyph."
    },
    "color": {
      "type": "string",
      "description": "Presentation color."
    },
    "teamId": {
      "type": "string",
      "description": "Optional Team (Sodalitas) to reference for the shared member set."
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
  "properties": {
    "project": {
      "type": "object",
      "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "The owning Anima id (the project's hard ownership boundary)."
        },
        "name": {
          "type": "string",
          "description": "The project display name."
        },
        "desc": {
          "type": "string",
          "description": "Optional description."
        },
        "glyph": {
          "type": "string",
          "description": "Presentation glyph."
        },
        "color": {
          "type": "string",
          "description": "Presentation color."
        },
        "datasetIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed dataset ids."
        },
        "modelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed model (Intella) ids."
        },
        "collectionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed collection ids."
        },
        "teamId": {
          "type": "string",
          "description": "Optional referenced Team (Sodalitas) id — the shared member set."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "datasetIds",
        "modelIds",
        "collectionIds",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### GET /v1/me/projects/:id

Fetch one owned project by id (404 if not the owner).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "The owning Anima id (the project's hard ownership boundary)."
        },
        "name": {
          "type": "string",
          "description": "The project display name."
        },
        "desc": {
          "type": "string",
          "description": "Optional description."
        },
        "glyph": {
          "type": "string",
          "description": "Presentation glyph."
        },
        "color": {
          "type": "string",
          "description": "Presentation color."
        },
        "datasetIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed dataset ids."
        },
        "modelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed model (Intella) ids."
        },
        "collectionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed collection ids."
        },
        "teamId": {
          "type": "string",
          "description": "Optional referenced Team (Sodalitas) id — the shared member set."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "datasetIds",
        "modelIds",
        "collectionIds",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### PATCH /v1/me/projects/:id

Patch project metadata (name/desc/glyph/color/teamId). Owner-only.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Patch project metadata. Omitted fields are left unchanged; teamId null clears the reference.",
  "properties": {
    "name": {
      "type": "string"
    },
    "desc": {
      "type": "string"
    },
    "glyph": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "teamId": {
      "type": "string",
      "description": "Set/clear the referenced Team (Sodalitas)."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "The owning Anima id (the project's hard ownership boundary)."
        },
        "name": {
          "type": "string",
          "description": "The project display name."
        },
        "desc": {
          "type": "string",
          "description": "Optional description."
        },
        "glyph": {
          "type": "string",
          "description": "Presentation glyph."
        },
        "color": {
          "type": "string",
          "description": "Presentation color."
        },
        "datasetIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed dataset ids."
        },
        "modelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed model (Intella) ids."
        },
        "collectionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed collection ids."
        },
        "teamId": {
          "type": "string",
          "description": "Optional referenced Team (Sodalitas) id — the shared member set."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "datasetIds",
        "modelIds",
        "collectionIds",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### DELETE /v1/me/projects/:id

Delete a project. Owner-only. Filed assets are untouched (holdings are references).

- **Auth:** required

### POST /v1/me/projects/:id/holdings

File an asset reference (dataset|model|collection) into the project. Owner-only; idempotent.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "File an asset reference into the project (idempotent).",
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "dataset",
        "model",
        "collection"
      ],
      "description": "Which holding list."
    },
    "assetId": {
      "type": "string",
      "description": "The asset's id."
    }
  },
  "required": [
    "kind",
    "assetId"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "The owning Anima id (the project's hard ownership boundary)."
        },
        "name": {
          "type": "string",
          "description": "The project display name."
        },
        "desc": {
          "type": "string",
          "description": "Optional description."
        },
        "glyph": {
          "type": "string",
          "description": "Presentation glyph."
        },
        "color": {
          "type": "string",
          "description": "Presentation color."
        },
        "datasetIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed dataset ids."
        },
        "modelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed model (Intella) ids."
        },
        "collectionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed collection ids."
        },
        "teamId": {
          "type": "string",
          "description": "Optional referenced Team (Sodalitas) id — the shared member set."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "datasetIds",
        "modelIds",
        "collectionIds",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### DELETE /v1/me/projects/:id/holdings/:kind/:assetId

Unfile an asset reference from the project. Owner-only; idempotent.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "description": "A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "The owning Anima id (the project's hard ownership boundary)."
        },
        "name": {
          "type": "string",
          "description": "The project display name."
        },
        "desc": {
          "type": "string",
          "description": "Optional description."
        },
        "glyph": {
          "type": "string",
          "description": "Presentation glyph."
        },
        "color": {
          "type": "string",
          "description": "Presentation color."
        },
        "datasetIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed dataset ids."
        },
        "modelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed model (Intella) ids."
        },
        "collectionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Filed collection ids."
        },
        "teamId": {
          "type": "string",
          "description": "Optional referenced Team (Sodalitas) id — the shared member set."
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "datasetIds",
        "modelIds",
        "collectionIds",
        "createdAt",
        "updatedAt"
      ]
    }
  },
  "required": [
    "project"
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
| `not_found.collection` | 404 | no |
| `not_found.team` | 404 | no |
| `not_found.project` | 404 | no |
| `not_found.edition` | 404 | no |
| `not_found.model` | 404 | no |
| `not_found.adapter` | 404 | no |
| `not_found.run` | 404 | no |
| `economy.insufficient_signa` | 402 | no |
| `economy.cap_too_low` | 422 | no |
| `conflict.slug_taken` | 409 | no |
| `capacity.no_pods` | 503 | yes |
| `internal.unavailable` | 503 | yes |
| `internal.error` | 500 | yes |
