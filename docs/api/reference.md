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
        },
        "aditus": {
          "type": "object",
          "additionalProperties": true,
          "description": "OWNER-SCOPED: the stored effective input the run was cast with, echoed verbatim (including an unresolved \"shuffle\" seed sentinel if that's what was stored). Present only when populated."
        },
        "pinnedModels": {
          "type": "array",
          "description": "OWNER-SCOPED: the models pinned at cast time. Present only when populated.",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "modusVersion": {
          "type": "string",
          "description": "OWNER-SCOPED: the cast-time modus version. Present only when populated."
        },
        "order": {
          "type": "object",
          "additionalProperties": true,
          "description": "The standing order this run belongs to, when it has one (training runs). See GET /v1/runs/:id/order."
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
        },
        "aditus": {
          "type": "object",
          "additionalProperties": true,
          "description": "OWNER-SCOPED: the stored effective input the run was cast with, echoed verbatim (including an unresolved \"shuffle\" seed sentinel if that's what was stored). Present only when populated."
        },
        "pinnedModels": {
          "type": "array",
          "description": "OWNER-SCOPED: the models pinned at cast time. Present only when populated.",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "modusVersion": {
          "type": "string",
          "description": "OWNER-SCOPED: the cast-time modus version. Present only when populated."
        },
        "order": {
          "type": "object",
          "additionalProperties": true,
          "description": "The standing order this run belongs to, when it has one (training runs). See GET /v1/runs/:id/order."
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

### POST /v1/runs/:id/cancel

Stop an in-flight run and settle it (owner-scoped, idempotent): the pod is terminated and the locked credits are released — the run is not charged. Returns the terminal run view, the same projection GET /v1/runs/:id returns; a cancelled run reads status "failed". Cancelling a run that has already settled returns that run unchanged, 200; a stranger gets not_found.run.

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
        },
        "aditus": {
          "type": "object",
          "additionalProperties": true,
          "description": "OWNER-SCOPED: the stored effective input the run was cast with, echoed verbatim (including an unresolved \"shuffle\" seed sentinel if that's what was stored). Present only when populated."
        },
        "pinnedModels": {
          "type": "array",
          "description": "OWNER-SCOPED: the models pinned at cast time. Present only when populated.",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "modusVersion": {
          "type": "string",
          "description": "OWNER-SCOPED: the cast-time modus version. Present only when populated."
        },
        "order": {
          "type": "object",
          "additionalProperties": true,
          "description": "The standing order this run belongs to, when it has one (training runs). See GET /v1/runs/:id/order."
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

### GET /v1/runs/:id/order

The standing order behind a run — the request, not the attempt. A training run that fails on infrastructure stays scheduled: the order attempts again hourly until it lands or its window closes. Returns { order: null } for a run that has none.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "order": {
      "type": "object",
      "description": "A standing order behind a run — the request, not the attempt.",
      "properties": {
        "id": {
          "type": "string",
          "description": "The order identifier."
        },
        "state": {
          "type": "string",
          "enum": [
            "attempting",
            "scheduled",
            "fulfilled",
            "stopped",
            "cancelled"
          ],
          "description": "Where the request stands: an attempt running now (attempting), another one queued (scheduled), succeeded (fulfilled), ended without succeeding (stopped), or cancelled by the holder."
        },
        "reason": {
          "type": "string",
          "enum": [
            "fulfilled",
            "failed",
            "exhausted",
            "cancelled"
          ],
          "description": "Why a terminal order ended. Absent while it is still live."
        },
        "attempts": {
          "type": "number",
          "description": "Attempts made so far, the first one included."
        },
        "attemptsRemaining": {
          "type": "number",
          "description": "Attempts the order may still make."
        },
        "nextAttemptAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the next attempt is due, ISO-8601."
        },
        "until": {
          "type": "string",
          "format": "date-time",
          "description": "When the order stops trying regardless, ISO-8601."
        },
        "latestRunId": {
          "type": "string",
          "description": "The most recent attempt — the run to watch now."
        }
      },
      "required": [
        "id",
        "state",
        "attempts",
        "attemptsRemaining"
      ]
    }
  },
  "required": [
    "order"
  ]
}
```

### POST /v1/runs/:id/order/revoke

Cancel the standing order behind a run — no further attempts will be made. Idempotent; the attempt already in flight is unaffected.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "order": {
      "type": "object",
      "description": "A standing order behind a run — the request, not the attempt.",
      "properties": {
        "id": {
          "type": "string",
          "description": "The order identifier."
        },
        "state": {
          "type": "string",
          "enum": [
            "attempting",
            "scheduled",
            "fulfilled",
            "stopped",
            "cancelled"
          ],
          "description": "Where the request stands: an attempt running now (attempting), another one queued (scheduled), succeeded (fulfilled), ended without succeeding (stopped), or cancelled by the holder."
        },
        "reason": {
          "type": "string",
          "enum": [
            "fulfilled",
            "failed",
            "exhausted",
            "cancelled"
          ],
          "description": "Why a terminal order ended. Absent while it is still live."
        },
        "attempts": {
          "type": "number",
          "description": "Attempts made so far, the first one included."
        },
        "attemptsRemaining": {
          "type": "number",
          "description": "Attempts the order may still make."
        },
        "nextAttemptAt": {
          "type": "string",
          "format": "date-time",
          "description": "When the next attempt is due, ISO-8601."
        },
        "until": {
          "type": "string",
          "format": "date-time",
          "description": "When the order stops trying regardless, ISO-8601."
        },
        "latestRunId": {
          "type": "string",
          "description": "The most recent attempt — the run to watch now."
        }
      },
      "required": [
        "id",
        "state",
        "attempts",
        "attemptsRemaining"
      ]
    }
  },
  "required": [
    "order"
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

MCP (Model Context Protocol) JSON-RPC endpoint — agent tool-use over the same facade. Tools: run_flow / get_run / list_flows / describe_flow / collect / get_collection. Resources: crystal://flows and crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op. The transport itself accepts unauthenticated requests (a client must be able to connect and enumerate tools before it has a credential); identity is enforced per-tool — tools that touch owner-scoped data reject without a credential inside their handler.

- **Auth:** public

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
          "descriptio": {
            "type": "string",
            "description": "A flow-level routing line — what this flow is for and when to pick it over its siblings."
          },
          "categoria": {
            "description": "An optional catalog tag."
          },
          "modusGenus": {
            "type": "string",
            "description": "The flow's canon verb, derived at query time from its aditus/exitus ports (see `resolveCanonVerb`, noema-054).",
            "enum": [
              "make",
              "effect",
              "animate",
              "direct",
              "render",
              "chat",
              "describe",
              "transcribe",
              "speak",
              "compose",
              "foley",
              "sculpt",
              "lift",
              "scan",
              "enhance"
            ]
          }
        },
        "required": [
          "id",
          "nomen",
          "versio",
          "modusGenus"
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
    "descriptio": {
      "type": "string",
      "description": "A flow-level routing line — what this flow is for and when to pick it over its siblings."
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

Browse the model weight catalog.

- **Auth:** public

**Query parameters:**

- `genus` (string) — Filter by model genus.
- `basis` (string) — Filter by model basis.
- `fundamentumId` (string) — Filter by compute substrate id.
- `trigger` (string) — Filter by trigger word.
- `q` (string) — Free-text search query.
- `limit` (integer) — Maximum number of results to return.
- `sort` (string) — Sort order for results: `newest | name | genus`. Applied server-side before the `limit` slice.

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
          },
          "slug": {
            "type": "string",
            "description": "ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only)."
          },
          "defaultWeight": {
            "type": "number",
            "description": "Recommended application weight when the caller does not specify one (LoRA only)."
          },
          "samples": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "url": {
                  "type": "string"
                },
                "prompt": {
                  "type": "string"
                }
              },
              "required": [
                "url"
              ]
            },
            "description": "Preview samples: image URL + the prompt it was rendered from."
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "tag": {
                  "type": "string"
                },
                "source": {
                  "type": "string"
                }
              },
              "required": [
                "tag"
              ]
            },
            "description": "Discovery/classification tags."
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

### GET /v1/deposit/mine

The authenticated caller's own deposits, scoped to their linked wallets — real depositum status (confirmatum/processatum) for the settle-watch UI.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The authenticated caller's own on-chain deposits, scoped to their linked wallets — real depositum status for the settle-watch UI.",
  "properties": {
    "deposits": {
      "type": "array",
      "description": "Newest-first.",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "chainId": {
            "type": "string"
          },
          "txHash": {
            "type": "string",
            "description": "On-chain transaction hash."
          },
          "valor": {
            "type": "string",
            "description": "Amount in base units (wei / token-decimals), as a string."
          },
          "status": {
            "type": "string",
            "enum": [
              "detectum",
              "confirmatum",
              "processatum",
              "praesolutum",
              "fractum"
            ],
            "description": "detectum (seen) · confirmatum (confirmed, awaiting/parked credit) · processatum (credited) · praesolutum (settled on the pre-cutover plane — recorded here, never credited here) · fractum (failed)."
          },
          "natum": {
            "type": "string",
            "format": "date-time",
            "description": "When the deposit was first detected."
          }
        },
        "required": [
          "id",
          "chainId",
          "txHash",
          "valor",
          "status",
          "natum"
        ]
      }
    }
  },
  "required": [
    "deposits"
  ]
}
```

### POST /v1/payments/checkout

Buy a fixed credit pack with fiat: create a Stripe Checkout session for the chosen pack and return the hosted-checkout URL. Requires an identified account; the impetus credited is the server-side pack constant, applied later by the signature-verified webhook on payment completion.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Buy a fixed credit pack with fiat via Stripe Checkout. The pack is server-authoritative: the impetus credited is the pack constant, never a client-supplied figure. Requires an identified account (a card de-anonymizes; an anon purse is rejected).",
  "properties": {
    "packId": {
      "type": "string",
      "enum": [
        "starter_10",
        "standard_25",
        "plus_50",
        "studio_100"
      ],
      "description": "The credit pack SKU to purchase. Fixed USD price → fixed impetus (starter_10 $10→30,000; standard_25 $25→82,500; plus_50 $50→180,000; studio_100 $100→390,000). No funding haircut."
    },
    "successUrl": {
      "type": "string",
      "description": "Optional redirect URL on completed payment; falls back to the server default."
    },
    "cancelUrl": {
      "type": "string",
      "description": "Optional redirect URL on abandoned checkout; falls back to the server default."
    }
  },
  "required": [
    "packId"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "description": "The hosted Stripe Checkout session to redirect the caller to. Credit is applied only later, by the signature-verified webhook, when the payment completes.",
  "properties": {
    "url": {
      "type": "string",
      "description": "The Stripe-hosted checkout URL to redirect the caller to."
    },
    "sessionId": {
      "type": "string",
      "description": "The Stripe Checkout Session id."
    }
  },
  "required": [
    "url",
    "sessionId"
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
        },
        "slug": {
          "type": "string",
          "description": "ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only)."
        },
        "defaultWeight": {
          "type": "number",
          "description": "Recommended application weight when the caller does not specify one (LoRA only)."
        },
        "samples": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "url": {
                "type": "string"
              },
              "prompt": {
                "type": "string"
              }
            },
            "required": [
              "url"
            ]
          },
          "description": "Preview samples: image URL + the prompt it was rendered from."
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tag": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "tag"
            ]
          },
          "description": "Discovery/classification tags."
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
          },
          "slug": {
            "type": "string",
            "description": "ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only)."
          },
          "defaultWeight": {
            "type": "number",
            "description": "Recommended application weight when the caller does not specify one (LoRA only)."
          },
          "samples": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "url": {
                  "type": "string"
                },
                "prompt": {
                  "type": "string"
                }
              },
              "required": [
                "url"
              ]
            },
            "description": "Preview samples: image URL + the prompt it was rendered from."
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "tag": {
                  "type": "string"
                },
                "source": {
                  "type": "string"
                }
              },
              "required": [
                "tag"
              ]
            },
            "description": "Discovery/classification tags."
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
        },
        "slug": {
          "type": "string",
          "description": "ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only)."
        },
        "defaultWeight": {
          "type": "number",
          "description": "Recommended application weight when the caller does not specify one (LoRA only)."
        },
        "samples": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "url": {
                "type": "string"
              },
              "prompt": {
                "type": "string"
              }
            },
            "required": [
              "url"
            ]
          },
          "description": "Preview samples: image URL + the prompt it was rendered from."
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tag": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "tag"
            ]
          },
          "description": "Discovery/classification tags."
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

### GET /v1/me/runs

The caller's SETTLED spend history — per-run impetus cost (+ derived USD), settledAt, and a lifetime running total. Owner-scoped (identified or anon-commitment), cursor-paginated, newest first. Only completus runs (a refunded failed run is not spend).

- **Auth:** required

**Query parameters:**

- `cursor` (string) — Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.
- `limit` (integer) — Page size. Clamped to 1..100; defaults to 20.

**Response (200):**

```json
{
  "type": "object",
  "description": "A page of settled spend history plus the owner's lifetime running total.",
  "properties": {
    "runs": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A settled run in the owner's spend history. JSON-safe.",
        "properties": {
          "id": {
            "type": "string",
            "description": "The run (Actum) identifier."
          },
          "modusId": {
            "type": "string",
            "description": "The flow (modus) this run executed."
          },
          "modusLabel": {
            "type": "string",
            "description": "Human label of the modus at settle (falls back to modusId)."
          },
          "status": {
            "type": "string",
            "enum": [
              "settled"
            ],
            "description": "Always \"settled\" — completus runs only."
          },
          "cost": {
            "type": "string",
            "description": "Impetus cost, serialised as a string."
          },
          "costUsd": {
            "type": "number",
            "description": "USD cost DERIVED on read (cost × IMPETUS_USD_RATE) — never a persisted FMV."
          },
          "settledAt": {
            "type": "string",
            "format": "date-time",
            "description": "When the run settled, ISO-8601."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "When the run started, ISO-8601."
          }
        },
        "required": [
          "id",
          "modusId",
          "modusLabel",
          "status",
          "cost",
          "costUsd"
        ]
      },
      "description": "Settled runs, newest first."
    },
    "nextCursor": {
      "type": "string",
      "description": "Opaque cursor for the next page; absent on the last page."
    },
    "runningTotal": {
      "type": "object",
      "description": "Lifetime spend across ALL settled runs (not just this page).",
      "properties": {
        "impetus": {
          "type": "string",
          "description": "Total impetus spent, serialised as a string."
        },
        "usd": {
          "type": "number",
          "description": "Total USD, derived at the platform reference rate."
        }
      },
      "required": [
        "impetus",
        "usd"
      ]
    }
  },
  "required": [
    "runs",
    "runningTotal"
  ]
}
```

### GET /v1/me/activity

The caller's activity — in-flight and settled runs in ONE newest-first projection, each row carrying its kind and a door to the artifact it produced. Owner-scoped (identified or anon-commitment), cursor-paginated. In-flight rows ride the first page; the cursor pages settled history.

- **Auth:** required

**Query parameters:**

- `cursor` (string) — Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page of settled rows.
- `limit` (integer) — Page size. Clamped to 1..100; defaults to 20.

**Response (200):**

```json
{
  "type": "object",
  "description": "A page of the owner's activity: in-flight and settled runs merged newest-first.",
  "properties": {
    "activity": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "One run in the owner's activity — in-flight or settled — with a door to its artifact.",
        "properties": {
          "actumId": {
            "type": "string",
            "description": "The run (Actum) identifier."
          },
          "kind": {
            "type": "string",
            "enum": [
              "training",
              "caption",
              "decompose",
              "generation"
            ],
            "description": "What the run produced. Resolved from a modusId table; \"generation\" is the catch-all."
          },
          "modusId": {
            "type": "string",
            "description": "The flow (modus) the run executed."
          },
          "modusLabel": {
            "type": "string",
            "description": "Human label of the modus, when the index row carries one."
          },
          "status": {
            "type": "string",
            "enum": [
              "running",
              "settled"
            ],
            "description": "In-flight, or settled successfully."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "When the run started, ISO-8601."
          },
          "settledAt": {
            "type": "string",
            "format": "date-time",
            "description": "When the run settled, ISO-8601. Absent while in flight."
          },
          "door": {
            "type": "object",
            "description": "The way back to a run's artifact. Every field is optional; a field the run did not produce is absent.",
            "properties": {
              "modelId": {
                "type": "string",
                "description": "The registered model (Intella) id a training run produced."
              },
              "datasetId": {
                "type": "string",
                "description": "The dataset the run trained on, captioned, or decomposed."
              },
              "captionsetId": {
                "type": "string",
                "description": "The captionset the run produced or decomposed."
              },
              "mediaUrl": {
                "type": "string",
                "description": "First media URL among the run's outputs, when one is trivially present."
              }
            }
          }
        },
        "required": [
          "actumId",
          "kind",
          "modusId",
          "status"
        ]
      },
      "description": "Activity rows, newest first."
    },
    "nextCursor": {
      "type": "string",
      "description": "Opaque cursor for the next page of settled rows; absent on the last page."
    }
  },
  "required": [
    "activity"
  ]
}
```

### GET /v1/data/datasets

The caller's datasets as the thin summary projection (the training-run picker's contract) — the datasets they own plus the datasets shared with a Team (Sodalitas) they are a member of. Newest first.

- **Auth:** required

**Query parameters:**

- `cursor` (string) — Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.
- `limit` (integer) — Page size. Clamped to 1..100; defaults to 20.

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "datasets": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "images": {
            "type": "number"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "name"
        ]
      }
    },
    "nextCursor": {
      "type": "string",
      "description": "Opaque cursor for the next page; absent on the last page."
    }
  },
  "required": [
    "datasets"
  ]
}
```

### GET /v1/data/datasets/full

The caller's datasets as the full rich shape (custody, modality, captionsets, versions) — Datasets.tsx's live listing. The datasets they own plus the datasets shared with a Team (Sodalitas) they are a member of. Newest first, paginated identically to the summary route.

- **Auth:** required

**Query parameters:**

- `cursor` (string) — Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.
- `limit` (integer) — Page size. Clamped to 1..100; defaults to 20.

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "datasets": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
        "properties": {
          "id": {
            "type": "string"
          },
          "owner": {
            "type": "string",
            "description": "FK -> Anima, the owning identity."
          },
          "sodalitasId": {
            "type": "string",
            "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
          },
          "name": {
            "type": "string"
          },
          "modality": {
            "type": "string",
            "enum": [
              "image",
              "video",
              "audio",
              "3d"
            ]
          },
          "custody": {
            "type": "string",
            "enum": [
              "sealed",
              "local",
              "remote"
            ]
          },
          "media": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "url": {
                  "type": "string"
                },
                "source": {
                  "type": "string",
                  "enum": [
                    "upload",
                    "generation"
                  ]
                },
                "actumId": {
                  "type": "string",
                  "description": "FK -> Actum. Present iff source === 'generation'."
                },
                "addedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "addedBy": {
                  "type": "string",
                  "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
                }
              },
              "required": [
                "id",
                "url",
                "source",
                "addedAt"
              ]
            }
          },
          "captionsets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "method": {
                  "type": "string",
                  "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
                },
                "coverage": {
                  "type": "string",
                  "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
                },
                "captions": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  },
                  "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
                }
              },
              "required": [
                "id",
                "name",
                "method",
                "coverage"
              ]
            }
          },
          "versions": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "v": {
                  "type": "string"
                },
                "count": {
                  "type": "number"
                },
                "when": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "v",
                "count",
                "when"
              ]
            }
          },
          "natum": {
            "type": "string",
            "format": "date-time"
          },
          "mutatum": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "owner",
          "name",
          "modality",
          "custody",
          "media",
          "captionsets",
          "versions",
          "natum",
          "mutatum"
        ]
      }
    },
    "nextCursor": {
      "type": "string",
      "description": "Opaque cursor for the next page; absent on the last page."
    }
  },
  "required": [
    "datasets"
  ]
}
```

### POST /v1/data/datasets

Create a Dataset from either v1 ingestion path: 'upload' (media already dropped via POST /storage/uploads/sign) or 'generation' (media seeded from the caller's own completed Acta). Rejects a body matching neither shape with 400. An optional teamId shares the dataset with a Team (Sodalitas) the caller is a member of; a team they do not belong to is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Create a Dataset. `source: 'upload'` ingests media already dropped via `POST /storage/uploads/sign` (mediaUrls); `source: 'generation'` seeds media from the caller's own completed Acta (actumIds). Exactly one shape; the discriminant is required. An optional `teamId` shares the dataset with a Team (Sodalitas) the caller belongs to.",
  "properties": {
    "source": {
      "type": "string",
      "enum": [
        "upload",
        "generation"
      ]
    },
    "name": {
      "type": "string"
    },
    "modality": {
      "type": "string",
      "enum": [
        "image",
        "video",
        "audio",
        "3d"
      ]
    },
    "custody": {
      "type": "string",
      "enum": [
        "sealed",
        "local",
        "remote"
      ],
      "description": "Defaults to local."
    },
    "teamId": {
      "type": "string",
      "description": "Share the dataset with a Team (Sodalitas) the caller is a member of — every member may then read it and contribute to it. Stored on the dataset as sodalitasId. A team the caller does not belong to is reported as not found."
    },
    "mediaUrls": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Required when source === 'upload'."
    },
    "actumIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Required when source === 'generation'."
    }
  },
  "required": [
    "source",
    "name",
    "modality"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/media

Contribute media to a dataset the caller owns OR is a team member of, via either ingestion path — 'upload' (media already dropped via POST /storage/uploads/sign) or 'generation' (media resolved from the caller's own completed Acta). A member contributes their own generations: every named Actum must still be the caller's own and completed, which team sharing does not change. Each item records addedBy, the contributor's Anima id. Append-only: nothing is replaced, reordered or removed. The response carries the dataset with its new media, a new version entry whose count is the media count after the append, and every captionset's coverage recomputed against the new media count. A body matching neither ingestion shape is rejected with 400. A dataset the caller neither owns nor shares is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Append media to an existing dataset. Same two ingestion paths as creation: `source: 'upload'` takes media already dropped via `POST /storage/uploads/sign` (mediaUrls), `source: 'generation'` resolves media from the caller's own completed Acta (actumIds). Append-only — the supplied items are added after the media already present, and nothing existing is replaced, reordered or removed.",
  "properties": {
    "source": {
      "type": "string",
      "enum": [
        "upload",
        "generation"
      ]
    },
    "mediaUrls": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Required when source === 'upload'."
    },
    "actumIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Required when source === 'generation'."
    }
  },
  "required": [
    "source"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/captionsets

Attach a caption pass (caption text keyed by media id) to a dataset the caller owns or is a team member of; a captionset already carrying the same id is replaced. Coverage is derived server-side. A dataset the caller neither owns nor shares is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Attach a caption pass to a dataset. A captionset already carrying this id is replaced rather than duplicated, so re-running a caption pass converges instead of accumulating. `coverage` is derived server-side and is not read from this body.",
  "properties": {
    "id": {
      "type": "string",
      "description": "Caption-pass id. Re-using an existing id replaces that captionset."
    },
    "name": {
      "type": "string"
    },
    "method": {
      "type": "string",
      "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
    },
    "captions": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      },
      "description": "Caption text keyed by media id. Every key must be a media item on this dataset; every value must be non-empty."
    }
  },
  "required": [
    "id",
    "name",
    "method"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### PATCH /v1/data/datasets/:id/captionsets/:captionsetId/captions/:mediaId

Edit one caption within one caption pass on a dataset the caller owns or is a team member of — captionsets are editable after generation. The media id must be a media item on the dataset; the captionset's coverage is recomputed from the captions present. A dataset the caller neither owns nor shares is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Replace the caption text for one media item within one caption pass.",
  "properties": {
    "caption": {
      "type": "string",
      "description": "The new caption text. Non-empty."
    }
  },
  "required": [
    "caption"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/archive

Archive a dataset the caller owns. Owner-only: a team member reads and contributes, but retiring the set stays with its owner. It leaves both dataset list routes and every picker built on them. It is not erased: references into it keep resolving, so a Muse session naming it as a mother dataset and a past run naming its media both continue to work. Reversible via POST /v1/data/datasets/:id/restore. Idempotent. A dataset the caller does not own is reported as not found.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/restore

Restore an archived dataset the caller owns — it returns to both dataset list routes. Owner-only, like the archive it undoes. Idempotent on a dataset that is already live. A dataset the caller does not own is reported as not found.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/media/:mediaId/archive

Archive one media item on a dataset the caller owns. Owner-only: a team member contributes to the set rather than deciding what leaves it. The item leaves the dataset's working set — the media a caption pass or a decompose reads, the summary count, and the fragments a Muse session is spawned from — and every captionset's coverage is recomputed against the media that is left. The item itself stays on the record, so captions and fragments keyed on its id are preserved for a restore. Reversible via POST /v1/data/datasets/:id/media/:mediaId/restore. Idempotent. A media id that names no item on the dataset is rejected with 400; a dataset the caller does not own is reported as not found.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/datasets/:id/media/:mediaId/restore

Restore one archived media item on a dataset the caller owns (owner-only, like the archive it undoes) — it rejoins the dataset's working set and every captionset's coverage is recomputed against it. Idempotent on an item that is already live. A media id that names no item on the dataset is rejected with 400; a dataset the caller does not own is reported as not found.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "dataset": {
      "type": "object",
      "description": "A training dataset: media + captionsets + versions. The training-data primitive.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "sodalitasId": {
          "type": "string",
          "description": "FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only."
        },
        "name": {
          "type": "string"
        },
        "modality": {
          "type": "string",
          "enum": [
            "image",
            "video",
            "audio",
            "3d"
          ]
        },
        "custody": {
          "type": "string",
          "enum": [
            "sealed",
            "local",
            "remote"
          ]
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "upload",
                  "generation"
                ]
              },
              "actumId": {
                "type": "string",
                "description": "FK -> Actum. Present iff source === 'generation'."
              },
              "addedAt": {
                "type": "string",
                "format": "date-time"
              },
              "addedBy": {
                "type": "string",
                "description": "FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded."
              }
            },
            "required": [
              "id",
              "url",
              "source",
              "addedAt"
            ]
          }
        },
        "captionsets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "method": {
                "type": "string",
                "description": "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'."
              },
              "coverage": {
                "type": "string",
                "description": "How much of the media this pass covers, e.g. \"12/12\". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored."
              },
              "captions": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed."
              }
            },
            "required": [
              "id",
              "name",
              "method",
              "coverage"
            ]
          }
        },
        "versions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "v": {
                "type": "string"
              },
              "count": {
                "type": "number"
              },
              "when": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "v",
              "count",
              "when"
            ]
          }
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "name",
        "modality",
        "custody",
        "media",
        "captionsets",
        "versions",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "dataset"
  ]
}
```

### POST /v1/data/muse/sessions

Break a Muse session off a dataset the caller owns. The session copies the dataset's fragments, pooled dataset-wide across every media item, and works from its own copies — the mother dataset is never written to. A dataset the caller does not own is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Break a session off a dataset the caller owns. Fragments are pooled dataset-wide across every media item, in item order — a session is a break-off of the whole dataset, not of one item.",
  "properties": {
    "datasetId": {
      "type": "string",
      "description": "FK -> Dataset. Must be a dataset the caller owns."
    }
  },
  "required": [
    "datasetId"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### GET /v1/data/muse/sessions

The caller's own Muse sessions off one dataset, most recently changed first. This is how a session is reached again once the page that spawned it is gone: the pointer is held server-side against the resolved caller rather than in the client. Owner-scoped from the resolved caller; a dataset the caller has no sessions off resolves to an empty list.

- **Auth:** required

**Query parameters:**

- `datasetId` (string, required) — FK -> Dataset. The mother dataset whose sessions are being looked up.

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "sessions": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
        "properties": {
          "id": {
            "type": "string"
          },
          "owner": {
            "type": "string",
            "description": "FK -> Anima, the owning identity."
          },
          "motherDatasetId": {
            "type": "string",
            "description": "FK -> Dataset, the dataset the session broke off from."
          },
          "sessionDatasetId": {
            "type": "string",
            "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
          },
          "fragments": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A categorized, reusable prompt fragment lifted from a caption.",
              "properties": {
                "category": {
                  "type": "string",
                  "description": "Which slot the fragment fills (subject, style, lighting, …)."
                },
                "text": {
                  "type": "string",
                  "description": "The fragment itself — a short, prompt-ready phrase."
                },
                "source": {
                  "type": "string",
                  "description": "The moodboard entry it came from."
                },
                "trigger": {
                  "type": "string",
                  "description": "The model binding for that source (e.g. a LoRA trigger word)."
                }
              },
              "required": [
                "category",
                "text",
                "source",
                "trigger"
              ]
            },
            "description": "Every fragment on the floor, in display order."
          },
          "floor": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
              "properties": {
                "key": {
                  "type": "string",
                  "description": "The fragment's stable identity: its category and its text."
                },
                "enabled": {
                  "type": "boolean",
                  "description": "False takes the fragment out of the draw while leaving it on the floor."
                },
                "weight": {
                  "type": "number",
                  "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
                }
              },
              "required": [
                "key",
                "enabled",
                "weight"
              ]
            }
          },
          "pieces": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A piece the session produced, with the fragments that produced it.",
              "properties": {
                "runId": {
                  "type": "string",
                  "description": "The run that produced the piece."
                },
                "rollIndex": {
                  "type": "number",
                  "description": "Which roll of the session this was."
                },
                "fragments": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "A categorized, reusable prompt fragment lifted from a caption.",
                    "properties": {
                      "category": {
                        "type": "string",
                        "description": "Which slot the fragment fills (subject, style, lighting, …)."
                      },
                      "text": {
                        "type": "string",
                        "description": "The fragment itself — a short, prompt-ready phrase."
                      },
                      "source": {
                        "type": "string",
                        "description": "The moodboard entry it came from."
                      },
                      "trigger": {
                        "type": "string",
                        "description": "The model binding for that source (e.g. a LoRA trigger word)."
                      }
                    },
                    "required": [
                      "category",
                      "text",
                      "source",
                      "trigger"
                    ]
                  },
                  "description": "The lineage — one fragment per category the roll filled."
                },
                "reaction": {
                  "type": "string",
                  "enum": [
                    "up",
                    "down",
                    "note"
                  ],
                  "description": "What the user said about the piece, if anything."
                },
                "saved": {
                  "type": "boolean",
                  "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
                },
                "dismissed": {
                  "type": "boolean"
                }
              },
              "required": [
                "runId",
                "rollIndex",
                "fragments",
                "saved",
                "dismissed"
              ]
            }
          },
          "setup": {
            "type": "object",
            "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
            "properties": {
              "modusId": {
                "type": "string",
                "description": "FK -> Modus, the flow the session fires at."
              },
              "mode": {
                "type": "string",
                "enum": [
                  "batched",
                  "infinite"
                ],
                "description": "A fixed number of pieces, or until it is stopped."
              },
              "cap": {
                "type": "number",
                "description": "Batched only: how many pieces one launch fires. At least 1."
              },
              "nozzle": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                  "properties": {
                    "intellaId": {
                      "type": "string",
                      "description": "FK -> Intella, the model itself."
                    },
                    "nomen": {
                      "type": "string",
                      "description": "The model's name, as it stood when the stack was committed."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The trigger word that applies the model."
                    },
                    "weight": {
                      "type": "number",
                      "description": "An explicit weight. Absent for the model's own default."
                    }
                  },
                  "required": [
                    "intellaId",
                    "nomen",
                    "trigger"
                  ]
                },
                "description": "The model stack, in the order it was stacked."
              },
              "prefix": {
                "type": "string",
                "description": "The standing instruction that leads every prompt fired on this nozzle."
              },
              "suffix": {
                "type": "string",
                "description": "The standing instruction that trails every prompt fired on this nozzle."
              }
            }
          },
          "keptRolls": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
              "properties": {
                "prompt": {
                  "type": "string",
                  "description": "The prompt as it was kept, edits included."
                },
                "paid": {
                  "type": "boolean",
                  "description": "Whether firing this prompt would be a paid run."
                }
              },
              "required": [
                "prompt",
                "paid"
              ]
            },
            "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
          },
          "natum": {
            "type": "string",
            "format": "date-time"
          },
          "mutatum": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "owner",
          "motherDatasetId",
          "fragments",
          "floor",
          "pieces",
          "keptRolls",
          "natum",
          "mutatum"
        ]
      },
      "description": "The caller's own sessions off the named dataset, most recently changed first."
    }
  },
  "required": [
    "sessions"
  ]
}
```

### GET /v1/data/muse/sessions/:id

A Muse session the caller owns — its floor and its piece ledger. Owner-scoped from the resolved caller; a session the caller does not own is reported as not found, identically to an id that does not exist.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### PATCH /v1/data/muse/sessions/:id/floor/enabled

Turn one fragment off or back on in a session the caller owns. A disabled fragment stays on the floor and in the fragment list; it is out of the draw, not gone. A fragment the session does not hold is rejected with 400.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Turn one fragment off or back on. The fragment is named by its identity in the body rather than in the path because that identity is free text. A disabled fragment stays on the floor and stays in the fragment list — it is out of the draw, not gone.",
  "properties": {
    "category": {
      "type": "string",
      "description": "The fragment's category."
    },
    "text": {
      "type": "string",
      "description": "The fragment's text."
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "required": [
    "category",
    "text",
    "enabled"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### PATCH /v1/data/muse/sessions/:id/floor/weight

Weight one fragment against its pool-mates in a session the caller owns. The weight is clamped server-side to the sampler's bounds. A fragment the session does not hold is rejected with 400.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Weight one fragment against its pool-mates. Clamped server-side to the sampler's bounds.",
  "properties": {
    "category": {
      "type": "string",
      "description": "The fragment's category."
    },
    "text": {
      "type": "string",
      "description": "The fragment's text."
    },
    "weight": {
      "type": "number",
      "description": "Relative draw weight. Values outside the sampler bounds are clamped."
    }
  },
  "required": [
    "category",
    "text",
    "weight"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### POST /v1/data/muse/sessions/:id/floor/fragments

Put a fragment the caller wrote on the floor of a session they own, in the draw at even odds. This is the un-metered way to widen a floor: a piece is composed from fragments already on the floor, so working with the session reweights it without widening it. Nothing is spent on this call — it reaches no model. A category outside the taxonomy is rejected with 400, and a fragment the floor already holds returns the session unchanged rather than a duplicate.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Put a fragment the caller wrote on the session floor, in the draw at even odds. The category must be one the taxonomy defines: prompts are composed by walking the categories, so a fragment filed outside them would never be drawn. Adding a fragment the floor already holds returns the session unchanged rather than a second copy of one identity. Nothing is spent on this call.",
  "properties": {
    "category": {
      "type": "string",
      "description": "The fragment's category. Must be a Muse fragment category."
    },
    "text": {
      "type": "string",
      "description": "The fragment itself — a short, prompt-ready phrase."
    }
  },
  "required": [
    "category",
    "text"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### PATCH /v1/data/muse/sessions/:id/setup

Replace the run setup of a session the caller owns — the flow, the run shape, the model stack and the standing affix the session fires its draw through. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. The setup is replaced WHOLESALE: it is one picture of what is about to fire, so a merge would leave a model on the stack after it was taken off, and a body that names nothing clears it. Nothing is spent and nothing is fired — no run, no quote, no model call. The infinite-mode acknowledgement is not part of a setup and cannot be written here: a body carrying one is stored without it, so a resumed session is never already consented to a run with no count to stop it. A session the caller does not own is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "FK -> Modus, the flow the session fires at."
    },
    "mode": {
      "type": "string",
      "enum": [
        "batched",
        "infinite"
      ],
      "description": "A fixed number of pieces, or until it is stopped."
    },
    "cap": {
      "type": "number",
      "description": "Batched only: how many pieces one launch fires. At least 1."
    },
    "nozzle": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
        "properties": {
          "intellaId": {
            "type": "string",
            "description": "FK -> Intella, the model itself."
          },
          "nomen": {
            "type": "string",
            "description": "The model's name, as it stood when the stack was committed."
          },
          "trigger": {
            "type": "string",
            "description": "The trigger word that applies the model."
          },
          "weight": {
            "type": "number",
            "description": "An explicit weight. Absent for the model's own default."
          }
        },
        "required": [
          "intellaId",
          "nomen",
          "trigger"
        ]
      },
      "description": "The model stack, in the order it was stacked."
    },
    "prefix": {
      "type": "string",
      "description": "The standing instruction that leads every prompt fired on this nozzle."
    },
    "suffix": {
      "type": "string",
      "description": "The standing instruction that trails every prompt fired on this nozzle."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### POST /v1/data/muse/sessions/:id/steer

Interpret a short instruction against the floor of a session the caller owns and return a PROPOSAL: fragments to take out of the draw, and fragments to put on the floor. NOTHING IS APPLIED — the response is offered for approval, any part of it may be rejected, and the floor moves only when the accepted parts are sent to the floor routes. Only the fragments currently in the draw are steered. The instruction is limited to 280 characters, enforced server-side. A proposed change that does not survive validation — an elimination naming a fragment the floor does not hold, an addition outside the taxonomy or already on the floor — is dropped and counted rather than silently removed. The proposal is not stored. This is a metered run: one model call, reserved before it is made and settled at its real cost. A session the caller does not own is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "A short instruction to interpret against the session floor. The instruction is LIMITED and the limit is enforced server-side: a steer is a short push against a floor, not a prompt. Only the fragments currently in the draw are steered.",
  "properties": {
    "instruction": {
      "type": "string",
      "description": "What should change, in the caller's own words. At most 280 characters."
    }
  },
  "required": [
    "instruction"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "proposal": {
      "type": "object",
      "description": "A proposed change to the floor. NOTHING IN IT HAS BEEN APPLIED: each entry is offered for approval and any of them may be rejected. The floor moves only when the accepted parts are sent to the floor routes. The proposal is not stored — it lives for as long as it is being reviewed, and the floor is the durable object.",
      "properties": {
        "eliminations": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment named by its identity — the same `{ category, text }` pair the floor routes take.",
            "properties": {
              "category": {
                "type": "string",
                "description": "The fragment's category."
              },
              "text": {
                "type": "string",
                "description": "The fragment's text."
              }
            },
            "required": [
              "category",
              "text"
            ]
          },
          "description": "Fragments proposed for removal from the draw. Every one is on the floor as it stands."
        },
        "additions": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Fragments proposed for the floor. Every one is in the taxonomy and new to the floor."
        },
        "dropped": {
          "type": "number",
          "description": "How many proposed changes did not survive validation — an elimination naming a fragment the floor does not hold, an addition outside the taxonomy or already on the floor, or a blank. Reported rather than swallowed, so a shorter list is not mistaken for the whole answer."
        }
      },
      "required": [
        "eliminations",
        "additions",
        "dropped"
      ]
    }
  },
  "required": [
    "proposal"
  ]
}
```

### POST /v1/data/muse/sessions/:id/kept

Keep one rolled prompt against a session the caller owns. Rolling is free and a roll in progress is uncommitted work, so a report and the edits made to it are the client's; keeping is the explicit act and is what is held on the session, so it survives leaving the screen. The list is APPEND-ONLY — keeping the same prompt twice stores it twice, and no route here removes one. Nothing is spent and nothing is fired: the prompt is kept, not launched. A body with no prompt, or with a verdict that is not a boolean, is rejected with 400. A session the caller does not own is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Keep one rolled prompt against the session. Append-only: keeping the same prompt twice stores it twice, because keeping is an explicit act and collapsing two of them would discard one the caller made on purpose. Nothing is spent on this call — the prompt is kept, not fired.",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "The prompt to keep. Required and non-empty."
    },
    "paid": {
      "type": "boolean",
      "description": "Whether firing this prompt would be a paid run."
    }
  },
  "required": [
    "prompt",
    "paid"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### POST /v1/data/muse/sessions/:id/pieces

Append a piece to the ledger of a session the caller owns, with the fragments that produced it. A piece citing a fragment the session does not hold is rejected rather than stored, because its lineage could not be resolved against this floor afterwards. The ledger holds one entry per run: a record for a run already in it is rejected, and changing a recorded piece is the PATCH below.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Append a piece to the session ledger with the lineage that produced it. Every cited fragment must be one this session holds; the lineage is stored from the session's own copies. The lineage is recorded now because it is not recoverable later — the floor moves and the fragment list is rebuilt.",
  "properties": {
    "runId": {
      "type": "string",
      "description": "The run that produced the piece."
    },
    "rollIndex": {
      "type": "number",
      "description": "Which roll of the session this was. A non-negative integer."
    },
    "fragments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "category": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "category",
          "text"
        ]
      },
      "description": "The lineage, each fragment named by category and text."
    },
    "reaction": {
      "type": "string",
      "enum": [
        "up",
        "down",
        "note"
      ]
    },
    "saved": {
      "type": "boolean"
    },
    "dismissed": {
      "type": "boolean"
    }
  },
  "required": [
    "runId",
    "rollIndex",
    "fragments"
  ]
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### PATCH /v1/data/muse/sessions/:id/pieces/:runId

Change what a session the caller owns says about a piece already in its ledger — its reaction, its dismissal, or both. A reaction is given after the piece exists, so this is the route that reaches a recorded piece; the piece's lineage, run and roll index are fixed when it is recorded. A run the ledger holds no entry for is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Change what the session says about a piece already in its ledger. A reaction and a dismissal are both given after the piece exists, so neither can ride the record call. At least one of the two fields must be present; a field left out is left as it was. The piece's lineage, run and roll index describe what produced it, are fixed when it is recorded, and are not changed here.",
  "properties": {
    "reaction": {
      "type": "string",
      "enum": [
        "up",
        "down",
        "note"
      ],
      "description": "What the user said about the piece."
    },
    "dismissed": {
      "type": "boolean",
      "description": "Whether the piece is discarded."
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### POST /v1/data/muse/sessions/:id/pieces/:runId/save

Put a piece from a session the caller owns back into the set: its media joins the session's own dataset, carrying the lineage that produced it as that media item's fragments. The session's dataset is created by the first save and appended to by every save after it; the mother dataset is never written. No job runs and nothing is spent — a generated piece was composed from fragments, so its recorded lineage is already its tagging. The request body is empty: the media is resolved server-side from the run the piece names, which must be the caller's own completed run. A save reweights the floor rather than widening it — the session's fragment list is unchanged. A session the caller does not own is reported as not found, as is a run the session's ledger holds no piece for.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "session": {
      "type": "object",
      "description": "A Muse session: a break-off of a dataset with its own copies of that dataset's fragments, its own floor, and its own piece ledger. The mother dataset is the starter and is never written to by the session.",
      "properties": {
        "id": {
          "type": "string"
        },
        "owner": {
          "type": "string",
          "description": "FK -> Anima, the owning identity."
        },
        "motherDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the dataset the session broke off from."
        },
        "sessionDatasetId": {
          "type": "string",
          "description": "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it."
        },
        "fragments": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A categorized, reusable prompt fragment lifted from a caption.",
            "properties": {
              "category": {
                "type": "string",
                "description": "Which slot the fragment fills (subject, style, lighting, …)."
              },
              "text": {
                "type": "string",
                "description": "The fragment itself — a short, prompt-ready phrase."
              },
              "source": {
                "type": "string",
                "description": "The moodboard entry it came from."
              },
              "trigger": {
                "type": "string",
                "description": "The model binding for that source (e.g. a LoRA trigger word)."
              }
            },
            "required": [
              "category",
              "text",
              "source",
              "trigger"
            ]
          },
          "description": "Every fragment on the floor, in display order."
        },
        "floor": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an object keyed by fragment: a fragment identity is `category:text`, which is free text and is not usable as a field name.",
            "properties": {
              "key": {
                "type": "string",
                "description": "The fragment's stable identity: its category and its text."
              },
              "enabled": {
                "type": "boolean",
                "description": "False takes the fragment out of the draw while leaving it on the floor."
              },
              "weight": {
                "type": "number",
                "description": "Draw weight against its pool-mates, clamped server-side to the sampler bounds."
              }
            },
            "required": [
              "key",
              "enabled",
              "weight"
            ]
          }
        },
        "pieces": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A piece the session produced, with the fragments that produced it.",
            "properties": {
              "runId": {
                "type": "string",
                "description": "The run that produced the piece."
              },
              "rollIndex": {
                "type": "number",
                "description": "Which roll of the session this was."
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "A categorized, reusable prompt fragment lifted from a caption.",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Which slot the fragment fills (subject, style, lighting, …)."
                    },
                    "text": {
                      "type": "string",
                      "description": "The fragment itself — a short, prompt-ready phrase."
                    },
                    "source": {
                      "type": "string",
                      "description": "The moodboard entry it came from."
                    },
                    "trigger": {
                      "type": "string",
                      "description": "The model binding for that source (e.g. a LoRA trigger word)."
                    }
                  },
                  "required": [
                    "category",
                    "text",
                    "source",
                    "trigger"
                  ]
                },
                "description": "The lineage — one fragment per category the roll filled."
              },
              "reaction": {
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "note"
                ],
                "description": "What the user said about the piece, if anything."
              },
              "saved": {
                "type": "boolean",
                "description": "Whether the piece has been put back into the set — its media is in the session's own dataset."
              },
              "dismissed": {
                "type": "boolean"
              }
            },
            "required": [
              "runId",
              "rollIndex",
              "fragments",
              "saved",
              "dismissed"
            ]
          }
        },
        "setup": {
          "type": "object",
          "description": "What the session fires its draw THROUGH: the flow, the run shape, the model stack and the standing affix. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. Every field is optional — a setup is assembled one control at a time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an acknowledgement is consent for one sitting, so this shape has no field for it and a request body carrying one is stored without it.",
          "properties": {
            "modusId": {
              "type": "string",
              "description": "FK -> Modus, the flow the session fires at."
            },
            "mode": {
              "type": "string",
              "enum": [
                "batched",
                "infinite"
              ],
              "description": "A fixed number of pieces, or until it is stopped."
            },
            "cap": {
              "type": "number",
              "description": "Batched only: how many pieces one launch fires. At least 1."
            },
            "nozzle": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "One model on the stored stack. The name rides alongside the id because it is what a resume has left to say with when the model is no longer offered. An absent weight means the model's own default, which is what a bare trigger word means to the resolver.",
                "properties": {
                  "intellaId": {
                    "type": "string",
                    "description": "FK -> Intella, the model itself."
                  },
                  "nomen": {
                    "type": "string",
                    "description": "The model's name, as it stood when the stack was committed."
                  },
                  "trigger": {
                    "type": "string",
                    "description": "The trigger word that applies the model."
                  },
                  "weight": {
                    "type": "number",
                    "description": "An explicit weight. Absent for the model's own default."
                  }
                },
                "required": [
                  "intellaId",
                  "nomen",
                  "trigger"
                ]
              },
              "description": "The model stack, in the order it was stacked."
            },
            "prefix": {
              "type": "string",
              "description": "The standing instruction that leads every prompt fired on this nozzle."
            },
            "suffix": {
              "type": "string",
              "description": "The standing instruction that trails every prompt fired on this nozzle."
            }
          }
        },
        "keptRolls": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A rolled prompt the caller kept. The verdict rides along because it is not recoverable afterwards — whether a prompt fires as a paid run is decided by what it drew and what it was rolled against, and both move.",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "The prompt as it was kept, edits included."
              },
              "paid": {
                "type": "boolean",
                "description": "Whether firing this prompt would be a paid run."
              }
            },
            "required": [
              "prompt",
              "paid"
            ]
          },
          "description": "The rolls the caller kept, in the order they kept them. Always present: a session that has kept none returns an empty list."
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "owner",
        "motherDatasetId",
        "fragments",
        "floor",
        "pieces",
        "keptRolls",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "session"
  ]
}
```

### POST /v1/data/muse/sessions/:id/promote

Promote a Muse session the caller owns into a DRAFT collection: the fragments still in the draw become the collection's trait grid, one axis per category, and the session's flow, standing affix and stacked model trigger words become the base prompt the grid expands. A fragment turned off on the cutting floor is not carried across — darkening it is the curation. The session itself is read and never written, so it is unchanged by the promotion and may be promoted again. NOTHING IS SPENT: a draft is not dispatched, and the supply, review policy and DNA rule a session cannot supply are set in the collection funnel, where firing enforces completeness. Trait rarity is left unset so the default spread applies. The request body carries at most a name; every reference the new collection holds is derived server-side from the session. A session the caller does not own is reported as not found.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Promote a Muse session into a draft collection. The body carries at most a name, and a name is a label: the flow, the trait grid, the standing prompt and the funding identity are all derived server-side from the session the caller owns, so no field here names an owner, a team, or any part of the grid. Omit the name and one is derived from the session's mother dataset.",
  "properties": {
    "nomen": {
      "type": "string",
      "description": "Optional display name for the new collection."
    }
  }
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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

### GET /v1/me

The caller's owner-keyed account settings — presentation skin (Profile), cross-cutting generation defaults (Preferences), and verb→flow bindings. Anon-capable (keyed by AuctorKey).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The caller's identity + balance + owner-keyed account settings — appearance + generation defaults + verb bindings.",
  "properties": {
    "animaId": {
      "type": "string",
      "description": "The caller's anima id, when identified. Absent for an anonymous/purse caller."
    },
    "username": {
      "type": "string",
      "description": "The caller's fiat username, when they authenticated with a password persona. Absent for wallet-only, telegram-only, or anonymous/purse callers."
    },
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
        },
        "spicyMode": {
          "type": "boolean",
          "description": "Adult (\"spicy\") mode. When ON — and an 18+ attestation is on file — permits adult-rated models, routes concierge chat to willing OpenRouter models, and relaxes SFW-forcing default negatives. Default-absent = OFF. Enabling requires a recorded 18+ attestation (POST /v1/me/attestation) — this PUT rejects with auth.forbidden otherwise."
        },
        "ageAttestation": {
          "type": "object",
          "description": "One-time self-declared 18+ attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicyMode may be enabled. Recorded via POST /v1/me/attestation; preserved across a Preferences replace.",
          "properties": {
            "attestedAt": {
              "type": "number",
              "description": "Epoch-ms timestamp of the attestation."
            }
          },
          "required": [
            "attestedAt"
          ]
        },
        "privateOutputs": {
          "type": "boolean",
          "description": "Private generation. When ON, the outputs of NEW runs are written to a bucket with no public binding; the run record carries an opaque marker and an owner-scoped run read returns a short-lived expiring link instead. Default-absent = OFF (outputs are public). Forward-only: objects already written stay where they are. Requires the deployment to have a private-outputs bucket — this PUT rejects with internal.unavailable otherwise."
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
    },
    "balanceImpetus": {
      "type": "string",
      "description": "Spendable impetus balance, serialised as a string. Same source GET /v1/me/status reports."
    },
    "balanceUsd": {
      "type": "number",
      "description": "USD-equivalent balance (informational). Same source as GET /v1/me/status."
    }
  },
  "required": [
    "bindings",
    "secrets",
    "secretsAvailable",
    "admin",
    "balanceImpetus",
    "balanceUsd"
  ]
}
```

### POST /v1/me/export

GDPR self-export — assemble the caller's OWN account data into a downloadable JSON bundle (strictly self-scoped to the caller) and return a short-lived, unguessable signed GET URL to it. Returns 503 when object storage is not configured.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Short-lived, unguessable signed GET URL to the hosted export bundle — the only handle returned (the raw object key is withheld so the response cannot be turned into a stable path)."
    },
    "expiresIn": {
      "type": "number",
      "description": "Seconds until the signed URL expires."
    },
    "bytes": {
      "type": "number",
      "description": "Size of the serialized JSON bundle in bytes."
    }
  },
  "required": [
    "url",
    "expiresIn",
    "bytes"
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

Replace the caller's cross-cutting generation defaults (style, negative prompt, output format, telegram delivery, auto-apply models, spicy mode, private generation). Applied at cast time under the affines precedence chain. Enabling spicyMode requires a recorded 18+ attestation on file (else auth.forbidden); a recorded attestation is preserved across a replace. Enabling privateOutputs requires a deployment with a private-outputs bucket (else internal.unavailable).

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
    },
    "spicyMode": {
      "type": "boolean",
      "description": "Adult (\"spicy\") mode. When ON — and an 18+ attestation is on file — permits adult-rated models, routes concierge chat to willing OpenRouter models, and relaxes SFW-forcing default negatives. Default-absent = OFF. Enabling requires a recorded 18+ attestation (POST /v1/me/attestation) — this PUT rejects with auth.forbidden otherwise."
    },
    "ageAttestation": {
      "type": "object",
      "description": "One-time self-declared 18+ attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicyMode may be enabled. Recorded via POST /v1/me/attestation; preserved across a Preferences replace.",
      "properties": {
        "attestedAt": {
          "type": "number",
          "description": "Epoch-ms timestamp of the attestation."
        }
      },
      "required": [
        "attestedAt"
      ]
    },
    "privateOutputs": {
      "type": "boolean",
      "description": "Private generation. When ON, the outputs of NEW runs are written to a bucket with no public binding; the run record carries an opaque marker and an owner-scoped run read returns a short-lived expiring link instead. Default-absent = OFF (outputs are public). Forward-only: objects already written stay where they are. Requires the deployment to have a private-outputs bucket — this PUT rejects with internal.unavailable otherwise."
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
        },
        "spicyMode": {
          "type": "boolean",
          "description": "Adult (\"spicy\") mode. When ON — and an 18+ attestation is on file — permits adult-rated models, routes concierge chat to willing OpenRouter models, and relaxes SFW-forcing default negatives. Default-absent = OFF. Enabling requires a recorded 18+ attestation (POST /v1/me/attestation) — this PUT rejects with auth.forbidden otherwise."
        },
        "ageAttestation": {
          "type": "object",
          "description": "One-time self-declared 18+ attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicyMode may be enabled. Recorded via POST /v1/me/attestation; preserved across a Preferences replace.",
          "properties": {
            "attestedAt": {
              "type": "number",
              "description": "Epoch-ms timestamp of the attestation."
            }
          },
          "required": [
            "attestedAt"
          ]
        },
        "privateOutputs": {
          "type": "boolean",
          "description": "Private generation. When ON, the outputs of NEW runs are written to a bucket with no public binding; the run record carries an opaque marker and an owner-scoped run read returns a short-lived expiring link instead. Default-absent = OFF (outputs are public). Forward-only: objects already written stay where they are. Requires the deployment to have a private-outputs bucket — this PUT rejects with internal.unavailable otherwise."
        }
      }
    }
  },
  "required": [
    "generatio"
  ]
}
```

### POST /v1/me/attestation

Record the caller's one-time 18+ self-attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicy mode may be enabled. Anon-capable (keyed by AuctorKey — anonymous Bursa/commitment and named Anima callers both).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "description": "The caller's recorded 18+ self-attestation (a click-through fact, not KYC).",
  "properties": {
    "attestation": {
      "type": "object",
      "properties": {
        "attestedAt": {
          "type": "number",
          "description": "Epoch-ms timestamp of the attestation."
        }
      },
      "required": [
        "attestedAt"
      ]
    }
  },
  "required": [
    "attestation"
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

### DELETE /v1/studios/:id

End the lease deliberately (owner-scoped, idempotent): terminate the pod, close the session. Double-DELETE returns the same terminal view, 200; a stranger gets not_found.studio.

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
      "description": "The flow expanded across the grid. Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus."
    },
    "total": {
      "type": "number",
      "description": "Target number of pieces to generate. Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus."
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
      "description": "The axes of variation (the parameter grid). Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus."
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
    "descriptio": {
      "type": "string",
      "description": "Optional working note on what this collection is."
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
  }
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
  "description": "Replace a draft Collection’s trait axes/values/rules, and (since a draft may now be created without them) its base flow + supply. Re-derives the provenance hash; rejected once the collection is fired. Omitted fields are left untouched.",
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
    },
    "modusId": {
      "type": "string",
      "description": "The draft’s base flow."
    },
    "numerus": {
      "type": "number",
      "description": "The draft’s target supply (piece count)."
    }
  }
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
          "paused": {
            "type": "boolean",
            "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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

The curation queue — a Collection's generated pieces (media + stamped attributes + review state). Owner-scoped.

- **Auth:** required

**Query parameters:**

- `review` (string) — Filter by review state: `pending | approved | rejected | all`. Defaults to `pending`. An unrecognised value also falls back to `pending`.

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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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
        "paused": {
          "type": "boolean",
          "description": "Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart."
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

The public feed — published, public-surface editions newest first (NOT auth-scoped). Each item carries the referenced artifact's produced output.

- **Auth:** public

**Query parameters:**

- `visibility` (string) — Filter by visibility: `feed | marketplace`. This is a public surface — any other value (including a private/unlisted visibility) collapses to `feed`.
- `destination` (string) — Filter to one destination/adapter key.
- `limit` (integer) — Maximum number of results to return. A non-numeric value is ignored.
- `author` (string) — Filter to one creator/agent by their animaId. Still subject to the public visibility clamp.

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

### GET /v1/tabulae

List the caller's own canvas workspaces (Tabulae). Owner-scoped.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "tabulae": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A canvas workspace — the authoring layer above a published Modus.",
        "properties": {
          "id": {
            "type": "string"
          },
          "nomen": {
            "type": "string",
            "description": "The workspace's title."
          },
          "descriptio": {
            "type": "string",
            "description": "Optional description for the marketplace listing."
          },
          "auctor": {
            "type": "object",
            "description": "The owning identity — { animaId } | { commitment } | { bursaToken }."
          },
          "nodi": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A node placed on the canvas — references the Modus/Essentia it represents.",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique within this Tabula's nodi."
                },
                "modusId": {
                  "type": "string",
                  "description": "FK → Modus or Essentia this node represents."
                },
                "x": {
                  "type": "number",
                  "description": "Canvas x position."
                },
                "y": {
                  "type": "number",
                  "description": "Canvas y position."
                },
                "aditus": {
                  "type": "object",
                  "description": "Per-node input overrides — become the published Modus's Porta.default values."
                }
              },
              "required": [
                "id",
                "modusId",
                "x",
                "y",
                "aditus"
              ]
            }
          },
          "vincula": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A wire between two nodes — fonte (source) port → scopus (target) port.",
              "properties": {
                "id": {
                  "type": "string"
                },
                "fonteNodusId": {
                  "type": "string",
                  "description": "FK → TabulaNodus.id (source)."
                },
                "fontePorta": {
                  "type": "string",
                  "description": "Output port name on the source node."
                },
                "scopusNodusId": {
                  "type": "string",
                  "description": "FK → TabulaNodus.id (target)."
                },
                "scopusPorta": {
                  "type": "string",
                  "description": "Input port name on the target node."
                },
                "discordantia": {
                  "type": "boolean",
                  "description": "True when the source/target port types don't match (flagged in the UI; publish rejects it)."
                }
              },
              "required": [
                "id",
                "fonteNodusId",
                "fontePorta",
                "scopusNodusId",
                "scopusPorta",
                "discordantia"
              ]
            }
          },
          "modusId": {
            "type": "string",
            "description": "FK → Modus. Set once this Tabula has been published."
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "published",
              "archivata"
            ]
          },
          "visibilitas": {
            "type": "string",
            "enum": [
              "privata",
              "communis",
              "publica"
            ]
          },
          "fonteId": {
            "type": "string",
            "description": "FK → Tabula this workspace was forked from, if any."
          },
          "templateId": {
            "type": "string",
            "description": "FK → the master Tabula this workspace derives from, if any."
          },
          "followTemplate": {
            "type": "boolean"
          },
          "natum": {
            "type": "string",
            "format": "date-time"
          },
          "mutatum": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "nomen",
          "auctor",
          "nodi",
          "vincula",
          "status",
          "visibilitas",
          "natum",
          "mutatum"
        ]
      }
    }
  },
  "required": [
    "tabulae"
  ]
}
```

### POST /v1/tabulae

Create a draft Tabula owned by the caller.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Create a draft Tabula owned by the caller.",
  "properties": {
    "nomen": {
      "type": "string",
      "description": "The workspace's title."
    },
    "descriptio": {
      "type": "string"
    },
    "visibilitas": {
      "type": "string",
      "enum": [
        "privata",
        "communis",
        "publica"
      ],
      "description": "Defaults to 'privata'."
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
    "tabula": {
      "type": "object",
      "description": "A canvas workspace — the authoring layer above a published Modus.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The workspace's title."
        },
        "descriptio": {
          "type": "string",
          "description": "Optional description for the marketplace listing."
        },
        "auctor": {
          "type": "object",
          "description": "The owning identity — { animaId } | { commitment } | { bursaToken }."
        },
        "nodi": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A node placed on the canvas — references the Modus/Essentia it represents.",
            "properties": {
              "id": {
                "type": "string",
                "description": "Unique within this Tabula's nodi."
              },
              "modusId": {
                "type": "string",
                "description": "FK → Modus or Essentia this node represents."
              },
              "x": {
                "type": "number",
                "description": "Canvas x position."
              },
              "y": {
                "type": "number",
                "description": "Canvas y position."
              },
              "aditus": {
                "type": "object",
                "description": "Per-node input overrides — become the published Modus's Porta.default values."
              }
            },
            "required": [
              "id",
              "modusId",
              "x",
              "y",
              "aditus"
            ]
          }
        },
        "vincula": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A wire between two nodes — fonte (source) port → scopus (target) port.",
            "properties": {
              "id": {
                "type": "string"
              },
              "fonteNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (source)."
              },
              "fontePorta": {
                "type": "string",
                "description": "Output port name on the source node."
              },
              "scopusNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (target)."
              },
              "scopusPorta": {
                "type": "string",
                "description": "Input port name on the target node."
              },
              "discordantia": {
                "type": "boolean",
                "description": "True when the source/target port types don't match (flagged in the UI; publish rejects it)."
              }
            },
            "required": [
              "id",
              "fonteNodusId",
              "fontePorta",
              "scopusNodusId",
              "scopusPorta",
              "discordantia"
            ]
          }
        },
        "modusId": {
          "type": "string",
          "description": "FK → Modus. Set once this Tabula has been published."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "published",
            "archivata"
          ]
        },
        "visibilitas": {
          "type": "string",
          "enum": [
            "privata",
            "communis",
            "publica"
          ]
        },
        "fonteId": {
          "type": "string",
          "description": "FK → Tabula this workspace was forked from, if any."
        },
        "templateId": {
          "type": "string",
          "description": "FK → the master Tabula this workspace derives from, if any."
        },
        "followTemplate": {
          "type": "boolean"
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "auctor",
        "nodi",
        "vincula",
        "status",
        "visibilitas",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "tabula"
  ]
}
```

### GET /v1/tabulae/:id

Fetch one owned Tabula by id (404 if not the owner).

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "tabula": {
      "type": "object",
      "description": "A canvas workspace — the authoring layer above a published Modus.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The workspace's title."
        },
        "descriptio": {
          "type": "string",
          "description": "Optional description for the marketplace listing."
        },
        "auctor": {
          "type": "object",
          "description": "The owning identity — { animaId } | { commitment } | { bursaToken }."
        },
        "nodi": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A node placed on the canvas — references the Modus/Essentia it represents.",
            "properties": {
              "id": {
                "type": "string",
                "description": "Unique within this Tabula's nodi."
              },
              "modusId": {
                "type": "string",
                "description": "FK → Modus or Essentia this node represents."
              },
              "x": {
                "type": "number",
                "description": "Canvas x position."
              },
              "y": {
                "type": "number",
                "description": "Canvas y position."
              },
              "aditus": {
                "type": "object",
                "description": "Per-node input overrides — become the published Modus's Porta.default values."
              }
            },
            "required": [
              "id",
              "modusId",
              "x",
              "y",
              "aditus"
            ]
          }
        },
        "vincula": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A wire between two nodes — fonte (source) port → scopus (target) port.",
            "properties": {
              "id": {
                "type": "string"
              },
              "fonteNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (source)."
              },
              "fontePorta": {
                "type": "string",
                "description": "Output port name on the source node."
              },
              "scopusNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (target)."
              },
              "scopusPorta": {
                "type": "string",
                "description": "Input port name on the target node."
              },
              "discordantia": {
                "type": "boolean",
                "description": "True when the source/target port types don't match (flagged in the UI; publish rejects it)."
              }
            },
            "required": [
              "id",
              "fonteNodusId",
              "fontePorta",
              "scopusNodusId",
              "scopusPorta",
              "discordantia"
            ]
          }
        },
        "modusId": {
          "type": "string",
          "description": "FK → Modus. Set once this Tabula has been published."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "published",
            "archivata"
          ]
        },
        "visibilitas": {
          "type": "string",
          "enum": [
            "privata",
            "communis",
            "publica"
          ]
        },
        "fonteId": {
          "type": "string",
          "description": "FK → Tabula this workspace was forked from, if any."
        },
        "templateId": {
          "type": "string",
          "description": "FK → the master Tabula this workspace derives from, if any."
        },
        "followTemplate": {
          "type": "boolean"
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "auctor",
        "nodi",
        "vincula",
        "status",
        "visibilitas",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "tabula"
  ]
}
```

### PUT /v1/tabulae/:id

Patch a Tabula's graph/metadata (nomen/descriptio/nodi/vincula/visibilitas). Owner-only.

- **Auth:** required

**Request body:**

```json
{
  "type": "object",
  "description": "Patch the Tabula's graph/metadata. Omitted fields are left unchanged.",
  "properties": {
    "nomen": {
      "type": "string"
    },
    "descriptio": {
      "type": "string"
    },
    "nodi": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A node placed on the canvas — references the Modus/Essentia it represents.",
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique within this Tabula's nodi."
          },
          "modusId": {
            "type": "string",
            "description": "FK → Modus or Essentia this node represents."
          },
          "x": {
            "type": "number",
            "description": "Canvas x position."
          },
          "y": {
            "type": "number",
            "description": "Canvas y position."
          },
          "aditus": {
            "type": "object",
            "description": "Per-node input overrides — become the published Modus's Porta.default values."
          }
        },
        "required": [
          "id",
          "modusId",
          "x",
          "y",
          "aditus"
        ]
      }
    },
    "vincula": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A wire between two nodes — fonte (source) port → scopus (target) port.",
        "properties": {
          "id": {
            "type": "string"
          },
          "fonteNodusId": {
            "type": "string",
            "description": "FK → TabulaNodus.id (source)."
          },
          "fontePorta": {
            "type": "string",
            "description": "Output port name on the source node."
          },
          "scopusNodusId": {
            "type": "string",
            "description": "FK → TabulaNodus.id (target)."
          },
          "scopusPorta": {
            "type": "string",
            "description": "Input port name on the target node."
          },
          "discordantia": {
            "type": "boolean",
            "description": "True when the source/target port types don't match (flagged in the UI; publish rejects it)."
          }
        },
        "required": [
          "id",
          "fonteNodusId",
          "fontePorta",
          "scopusNodusId",
          "scopusPorta",
          "discordantia"
        ]
      }
    },
    "visibilitas": {
      "type": "string",
      "enum": [
        "privata",
        "communis",
        "publica"
      ]
    }
  }
}
```

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "tabula": {
      "type": "object",
      "description": "A canvas workspace — the authoring layer above a published Modus.",
      "properties": {
        "id": {
          "type": "string"
        },
        "nomen": {
          "type": "string",
          "description": "The workspace's title."
        },
        "descriptio": {
          "type": "string",
          "description": "Optional description for the marketplace listing."
        },
        "auctor": {
          "type": "object",
          "description": "The owning identity — { animaId } | { commitment } | { bursaToken }."
        },
        "nodi": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A node placed on the canvas — references the Modus/Essentia it represents.",
            "properties": {
              "id": {
                "type": "string",
                "description": "Unique within this Tabula's nodi."
              },
              "modusId": {
                "type": "string",
                "description": "FK → Modus or Essentia this node represents."
              },
              "x": {
                "type": "number",
                "description": "Canvas x position."
              },
              "y": {
                "type": "number",
                "description": "Canvas y position."
              },
              "aditus": {
                "type": "object",
                "description": "Per-node input overrides — become the published Modus's Porta.default values."
              }
            },
            "required": [
              "id",
              "modusId",
              "x",
              "y",
              "aditus"
            ]
          }
        },
        "vincula": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A wire between two nodes — fonte (source) port → scopus (target) port.",
            "properties": {
              "id": {
                "type": "string"
              },
              "fonteNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (source)."
              },
              "fontePorta": {
                "type": "string",
                "description": "Output port name on the source node."
              },
              "scopusNodusId": {
                "type": "string",
                "description": "FK → TabulaNodus.id (target)."
              },
              "scopusPorta": {
                "type": "string",
                "description": "Input port name on the target node."
              },
              "discordantia": {
                "type": "boolean",
                "description": "True when the source/target port types don't match (flagged in the UI; publish rejects it)."
              }
            },
            "required": [
              "id",
              "fonteNodusId",
              "fontePorta",
              "scopusNodusId",
              "scopusPorta",
              "discordantia"
            ]
          }
        },
        "modusId": {
          "type": "string",
          "description": "FK → Modus. Set once this Tabula has been published."
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "published",
            "archivata"
          ]
        },
        "visibilitas": {
          "type": "string",
          "enum": [
            "privata",
            "communis",
            "publica"
          ]
        },
        "fonteId": {
          "type": "string",
          "description": "FK → Tabula this workspace was forked from, if any."
        },
        "templateId": {
          "type": "string",
          "description": "FK → the master Tabula this workspace derives from, if any."
        },
        "followTemplate": {
          "type": "boolean"
        },
        "natum": {
          "type": "string",
          "format": "date-time"
        },
        "mutatum": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "nomen",
        "auctor",
        "nodi",
        "vincula",
        "status",
        "visibilitas",
        "natum",
        "mutatum"
      ]
    }
  },
  "required": [
    "tabula"
  ]
}
```

### DELETE /v1/tabulae/:id

Delete a Tabula outright. Owner-only.

- **Auth:** required

### POST /v1/tabulae/:id/publish

Compile the canvas graph into a compositus Modus and register it — immediately runnable via POST /v1/runs. 400 with the offending vinculum on a cycle or a port-type mismatch.

- **Auth:** required

**Response (200):**

```json
{
  "type": "object",
  "properties": {
    "modusId": {
      "type": "string",
      "description": "The registered compositus Modus id — immediately runnable via POST /v1/runs."
    }
  },
  "required": [
    "modusId"
  ]
}
```

### GET /v1/me/flows

List the caller's own registered flows (owner-scoped discovery for the canvas node picker) — the public catalog's owner-filtered twin.

- **Auth:** required

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
          "descriptio": {
            "type": "string",
            "description": "A flow-level routing line — what this flow is for and when to pick it over its siblings."
          },
          "categoria": {
            "description": "An optional catalog tag."
          },
          "modusGenus": {
            "type": "string",
            "description": "The flow's canon verb, derived at query time from its aditus/exitus ports (see `resolveCanonVerb`, noema-054).",
            "enum": [
              "make",
              "effect",
              "animate",
              "direct",
              "render",
              "chat",
              "describe",
              "transcribe",
              "speak",
              "compose",
              "foley",
              "sculpt",
              "lift",
              "scan",
              "enhance"
            ]
          }
        },
        "required": [
          "id",
          "nomen",
          "versio",
          "modusGenus"
        ]
      }
    }
  },
  "required": [
    "flows"
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
| `input.invalid_graph` | 400 | no |
| `not_found.flow` | 404 | no |
| `not_found.tabula` | 404 | no |
| `not_found.fundamentum` | 404 | no |
| `not_found.studio` | 404 | no |
| `not_found.collection` | 404 | no |
| `not_found.team` | 404 | no |
| `not_found.project` | 404 | no |
| `not_found.edition` | 404 | no |
| `not_found.model` | 404 | no |
| `not_found.adapter` | 404 | no |
| `not_found.run` | 404 | no |
| `not_found.muse_session` | 404 | no |
| `not_found.muse_piece` | 404 | no |
| `not_found.dataset` | 404 | no |
| `input.model_not_resolved` | 422 | no |
| `economy.insufficient_signa` | 402 | no |
| `economy.cap_too_low` | 422 | no |
| `conflict.slug_taken` | 409 | no |
| `conflict.run_in_flight` | 409 | yes |
| `conflict.nothing_to_decompose` | 409 | no |
| `conflict.muse_session` | 409 | yes |
| `license.restricted` | 403 | no |
| `content.refused` | 403 | no |
| `secret.required` | 422 | no |
| `deposit.price_unavailable` | 422 | no |
| `feature.not_implemented` | 501 | no |
| `purse.disabled` | 503 | no |
| `rate.limited` | 429 | yes |
| `capacity.no_pods` | 503 | yes |
| `internal.unavailable` | 503 | yes |
| `internal.upstream_unavailable` | 503 | yes |
| `internal.error` | 500 | yes |
