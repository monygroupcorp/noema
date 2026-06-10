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
| `not_found.run` | 404 | no |
| `economy.insufficient_signa` | 402 | no |
| `internal.error` | 500 | yes |
