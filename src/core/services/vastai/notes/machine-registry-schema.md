# VastAI Machine Registry — Schema Spec

## Purpose

A persistent map of the VastAI offer space. Every machine we've ever tried gets
a record. Over time this becomes our source of truth for which offers are reliable,
which IP ranges are dead zones, and which to skip entirely — across all VastAI
workloads (training, inference, anything future).

---

## Collection: `vastai_machines`

One document per VastAI offer ID (stable machine identity).

```js
{
  // ── Identity ──────────────────────────────────────────────────────────────
  offerId:         String,      // VastAI offer/ask ID — primary key
  ip:              String,      // Public IP of the machine
  sshHost:         String,      // Proxy hostname (e.g. ssh2.vast.ai)
  gpuType:         String,      // "RTX 4090", "RTX 3090", etc.
  gpuVramGb:       Number,
  cudaVersion:     String,
  hourlyUsd:       Number,      // Last seen price

  // ── Reliability ───────────────────────────────────────────────────────────
  successCount:         Number,  // Jobs that reached training
  failureCount:         Number,  // Jobs that failed SSH/provision
  consecutiveFailures:  Number,  // Resets to 0 on any success
  lastOutcome:          String,  // "success" | "ssh_timeout" | "auth_failure" | "provision_error"
  lastAttemptAt:        Date,
  lastSuccessAt:        Date,    // null if never succeeded

  // ── Block status ──────────────────────────────────────────────────────────
  blocked:         Boolean,     // Excluded from offer search when true
  blockedAt:       Date,        // null if not blocked
  blockedReason:   String,      // "auto:5_consecutive_failures" | "manual: <ops note>"

  // ── Attempt history (capped, most recent N) ───────────────────────────────
  attempts: [
    {
      jobId:        String,
      workload:     String,      // "training" | "inference" | etc.
      outcome:      String,      // "success" | "ssh_timeout" | "auth_failure" | "provision_error" | "gpu_check_failed"
      failureDetail: String,     // stderr snippet or error message, null on success
      durationMs:   Number,      // How long the attempt took
      timestamp:    Date,
    }
    // keep last 20
  ],

  // ── Metadata ──────────────────────────────────────────────────────────────
  firstSeenAt:     Date,
  lastSeenAt:      Date,        // Last time this offer appeared in a search
  notes:           String,      // Freeform ops annotation
  createdAt:       Date,
  updatedAt:       Date,
}
```

---

## Auto-block rule

Block automatically when `consecutiveFailures >= 5`. Record reason as
`"auto:5_consecutive_failures"`. Auto-blocks can be cleared manually (set
`blocked: false`, reset `consecutiveFailures`, add a note).

---

## Indexes

```js
{ offerId: 1 }                          // unique, primary lookup
{ blocked: 1 }                          // filter in offer search
{ ip: 1 }                               // detect bad IP ranges
{ gpuType: 1, blocked: 1 }             // filtered search by GPU type
{ consecutiveFailures: -1 }            // find worst machines
{ lastSuccessAt: 1 }                   // find machines that never worked
```

---

## Integration points (when we build it)

1. **`VastAIService.filterAndSortOffers`** — query blocked offers before returning
   results, factor `successCount / (successCount + failureCount)` into sort weight
   alongside VastAI's reliability score.

2. **`launch-training.js`** — on each offer attempt, upsert a record:
   - provision start → create/update doc, append attempt stub
   - SSH success → mark success, reset `consecutiveFailures`
   - SSH/provision failure → increment `failureCount`, `consecutiveFailures`,
     update `lastOutcome`, trigger auto-block if threshold hit

3. **Admin endpoint** `GET /internal/v1/vastai/machines` — list with filters
   (blocked, gpuType, minFailures). `PATCH /internal/v1/vastai/machines/:offerId`
   to manually block/unblock or add a note.

---

## Future uses beyond training

- Inference workloads: same registry, `workload` field on attempt distinguishes
- Preferred machine lists: flag offers as `preferred: true` for high-priority jobs
- Cost tracking: aggregate `hourlyUsd × durationMs` across attempts per machine
- Regional analysis: group by IP prefix to identify bad hosting providers
