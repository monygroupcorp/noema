/**
 * RunPodInstanceSweeper — orphan & runaway-cost detection for RunPod pods.
 *
 * Mirrors src/core/services/vastai/InstanceSweeper.js's class shape
 * (start/stop/sweep/getStatus, periodic interval, alertCallback) but is
 * *label-based and stateless*. We do NOT depend on a training database
 * here — the sweeper trusts the pod's `name` to decide ownership:
 *
 *   - name starts with `labelPrefix` (default "stationthis-") => ours
 *   - anything else                                            => skip
 *
 * Termination policy:
 *   - Pod runtime exceeds `maxRuntimeMs` (default 4h) => terminate.
 *     Reason: runtime-cap. This catches workers that crashed before
 *     terminating their pod, or jobs that wedged.
 *   - We can't detect "stuck inside the pod" from out here; that's
 *     StallDetector's job in Tier B. This sweeper is the safety net.
 *
 * Cost guardrail (Item 3B):
 *   - Each sweep, accumulate (now - createdAt) * costPerHr / 3600 across all
 *     live ours-labeled pods to estimate spend-since-midnight-UTC.
 *   - If `dailyBudgetUsd` is set and spend exceeds it, fire
 *     alertCallback({ type: 'daily-budget-exceeded', spentUsd, dailyBudgetUsd })
 *     but DO NOT terminate active jobs — alerting is the soft signal,
 *     the worker scheduler should react. Killing live jobs from here is
 *     a worse failure mode than overspend.
 *   - Spend tracking is in-memory and resets at midnight UTC. Restarts
 *     lose state; this is acceptable because the alert is advisory.
 *
 * Concurrency: `_sweeping` reentrancy guard, same as VastAI sweeper.
 *
 * No DB. No persistent state. No external dependencies beyond runpodClient.
 */

class RunPodInstanceSweeper {
  constructor({
    runpodClient,
    logger,
    sweepIntervalMs = 5 * 60 * 1000,        // 5 minutes
    maxRuntimeMs = 4 * 60 * 60 * 1000,      // 4 hours
    labelPrefix = 'stationthis-',
    dailyBudgetUsd = null,                  // null = disabled
    alertCallback = null,
    enrich = true,                          // per-pod getPod() backfill for missing fields
    enrichConcurrency = 4,
  } = {}) {
    if (!runpodClient) throw new Error('RunPodInstanceSweeper requires runpodClient');

    this.runpodClient = runpodClient;
    this.logger = logger || console;
    this.sweepIntervalMs = sweepIntervalMs;
    this.maxRuntimeMs = maxRuntimeMs;
    this.labelPrefix = labelPrefix;
    this.dailyBudgetUsd = dailyBudgetUsd;
    this.alertCallback = alertCallback;
    this.enrich = enrich;
    this.enrichConcurrency = Math.max(1, enrichConcurrency);

    this._intervalHandle = null;
    this._sweeping = false;
    // In-memory spend accumulator, see _spendBucketKey().
    this._spendBucketKey = this._currentSpendBucketKey();
    this._spendBucketUsd = 0;
    // Enrichment observability — reset each sweep.
    this._lastSweepEnrichedCount = 0;
    this._lastSweepEnrichFailures = 0;
  }

  /** Bucket key = the UTC date stamp; flipping resets the accumulator. */
  _currentSpendBucketKey() {
    const d = new Date();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }

  /**
   * Start the periodic sweeper.
   */
  start() {
    if (this._intervalHandle) {
      this.logger.warn('[RunPodInstanceSweeper] Already running');
      return;
    }

    this.logger.info(`[RunPodInstanceSweeper] Starting (interval=${this.sweepIntervalMs}ms, maxRuntime=${this.maxRuntimeMs}ms, labelPrefix=${this.labelPrefix})`);

    this.sweep().catch(err => {
      this.logger.error('[RunPodInstanceSweeper] Initial sweep failed:', err);
    });

    this._intervalHandle = setInterval(() => {
      this.sweep().catch(err => {
        this.logger.error('[RunPodInstanceSweeper] Periodic sweep failed:', err);
      });
    }, this.sweepIntervalMs);
  }

  /**
   * Stop the periodic sweeper.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
      this.logger.info('[RunPodInstanceSweeper] Stopped');
    }
  }

  /**
   * Perform a single sweep.
   * @returns {Object} { podsChecked, terminated, errors, alerts, skipped, spentUsd }
   */
  async sweep() {
    if (this._sweeping) {
      this.logger.debug('[RunPodInstanceSweeper] Sweep already in progress, skipping');
      return { skipped: true };
    }
    this._sweeping = true;
    const results = {
      podsChecked: 0,
      terminated: [],
      errors: [],
      alerts: [],
      spentUsd: 0,
    };

    try {
      // Reset spend bucket if we crossed midnight UTC since last sweep.
      const bucket = this._currentSpendBucketKey();
      if (bucket !== this._spendBucketKey) {
        this._spendBucketKey = bucket;
        this._spendBucketUsd = 0;
      }

      const listResp = await this.runpodClient.listPods();
      // RunPod's /pods can return either [...] or { data: [...] }.
      const pods = Array.isArray(listResp) ? listResp
        : Array.isArray(listResp?.data) ? listResp.data
        : Array.isArray(listResp?.pods) ? listResp.pods
        : [];

      // Reset enrichment counters for this sweep.
      this._lastSweepEnrichedCount = 0;
      this._lastSweepEnrichFailures = 0;

      // Enrichment pass — for ours-labeled pods missing key fields, refetch
      // via getPod() with bounded concurrency. Best-effort: failures don't
      // block the sweep's primary mission (terminate runaways).
      const workingPods = await this._enrichPods(pods);

      const now = Date.now();
      let bucketSpend = 0;

      for (const pod of workingPods) {
        const podId = pod.id || pod.podId;
        const name = pod.name || '';

        // Ownership: we only touch pods we labeled.
        if (!name.startsWith(this.labelPrefix)) {
          continue;
        }
        results.podsChecked += 1;

        // createdAt — RunPod returns ISO string in `createdAt` (REST) or
        // sometimes a unix-ms `created`/`startTime`. Normalize.
        const createdAtMs = this._parseCreatedAt(pod);
        const runtimeMs = createdAtMs ? (now - createdAtMs) : 0;

        // Cost accumulation (Item 3B).
        const hourlyUsd = pod.costPerHr ?? pod.adjustedCostPerHr ?? null;
        if (hourlyUsd && createdAtMs) {
          // Bound contribution to "since midnight UTC" — a long-running pod
          // shouldn't book all its prior spend into today's bucket.
          const midnightMs = new Date(`${this._spendBucketKey}T00:00:00Z`).getTime();
          const billStart = Math.max(createdAtMs, midnightMs);
          const billed = Math.max(0, (now - billStart) / 3600000) * hourlyUsd;
          bucketSpend += billed;
        }

        // Runtime cap.
        if (runtimeMs > this.maxRuntimeMs) {
          const runtimeHours = (runtimeMs / 3600000).toFixed(2);
          const maxHours = (this.maxRuntimeMs / 3600000).toFixed(1);
          const reason = `runtime-cap (${runtimeHours}h > ${maxHours}h)`;
          this.logger.warn(`[RunPodInstanceSweeper] Terminating pod ${podId}: ${reason}`);
          try {
            await this.runpodClient.terminatePod(podId);
            results.terminated.push({ podId, reason, runtimeHours });
            this._alert({ type: 'runtime-cap', podId, runtimeHours, maxHours });
          } catch (err) {
            this.logger.error(`[RunPodInstanceSweeper] Failed to terminate pod ${podId}: ${err?.message}`);
            results.errors.push({ podId, error: err?.message });
          }
        }
      }

      // Update accumulator: track the MAX of observed instantaneous spend
      // and any prior bucketSpend computed this UTC day. (We don't add
      // across sweeps — each sweep is a fresh full-fleet observation.)
      this._spendBucketUsd = Math.max(this._spendBucketUsd, bucketSpend);
      results.spentUsd = this._spendBucketUsd;

      if (this.dailyBudgetUsd != null && this._spendBucketUsd > this.dailyBudgetUsd) {
        const alertPayload = {
          type: 'daily-budget-exceeded',
          spentUsd: this._spendBucketUsd,
          dailyBudgetUsd: this.dailyBudgetUsd
        };
        this.logger.error(`[RunPodInstanceSweeper] Daily budget tripwire: spent $${this._spendBucketUsd.toFixed(2)} > limit $${this.dailyBudgetUsd}`);
        results.alerts.push(alertPayload);
        this._alert(alertPayload);
      }

      if (results.terminated.length > 0) {
        this.logger.info(`[RunPodInstanceSweeper] Sweep complete: terminated ${results.terminated.length} pod(s), checked ${results.podsChecked}, spent $${this._spendBucketUsd.toFixed(2)} today`);
      } else {
        this.logger.debug(`[RunPodInstanceSweeper] Sweep complete: no terminations, checked ${results.podsChecked}, spent $${this._spendBucketUsd.toFixed(2)} today`);
      }

      return results;
    } catch (err) {
      this.logger.error('[RunPodInstanceSweeper] Sweep failed:', err);
      results.errors.push({ error: err?.message });
      throw err;
    } finally {
      this._sweeping = false;
    }
  }

  /**
   * Field is "missing" if it's null, undefined, or an empty string/array.
   * @private
   */
  _isFieldMissing(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.length === 0) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  /**
   * A pod is incomplete if any of the enrichment-eligible fields are missing.
   * Kept tight on purpose — too broad and we re-fetch every pod every sweep.
   * @private
   */
  _isPodIncomplete(pod) {
    const fields = ['costPerHr', 'publicIp', 'portMappings', 'createdAt'];
    return fields.some((f) => this._isFieldMissing(pod?.[f]));
  }

  /**
   * Merge enriched pod data into the bulk record. Bulk data is authoritative
   * when present — only fill in fields that were missing. Avoids overwriting
   * already-set fields if a transient race in the enriched response leaves
   * them blank.
   * @private
   */
  _mergeEnriched(bulkPod, enrichedPod) {
    if (!enrichedPod || typeof enrichedPod !== 'object') return bulkPod;
    const merged = { ...bulkPod };
    for (const key of Object.keys(enrichedPod)) {
      if (this._isFieldMissing(merged[key]) && !this._isFieldMissing(enrichedPod[key])) {
        merged[key] = enrichedPod[key];
      }
    }
    return merged;
  }

  /**
   * Bounded-concurrency parallel map. Runs at most `limit` tasks at once.
   * No external deps. Resolves to an array of {value} or {error} per input.
   * @private
   */
  async _pMapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        try {
          results[idx] = { value: await fn(items[idx], idx) };
        } catch (err) {
          results[idx] = { error: err };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Run enrichment over the bulk pod list. Only ours-labeled, incomplete pods
   * are refetched. Returns a new array with merged records (non-ours pods
   * pass through unchanged).
   * @private
   */
  async _enrichPods(pods) {
    if (!this.enrich) return pods;
    if (typeof this.runpodClient.getPod !== 'function') return pods;

    // Index pods that need enrichment so we can splice results back in place.
    const targets = [];
    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i];
      const name = pod?.name || '';
      if (!name.startsWith(this.labelPrefix)) continue;
      if (!this._isPodIncomplete(pod)) continue;
      const podId = pod.id || pod.podId;
      if (!podId) continue;
      targets.push({ index: i, podId });
    }

    if (targets.length === 0) return pods;
    this._lastSweepEnrichedCount = targets.length;

    const out = pods.slice();
    const results = await this._pMapLimit(targets, this.enrichConcurrency, async (t) => {
      const resp = await this.runpodClient.getPod(t.podId);
      // getPod responses may be wrapped as listPods is.
      return (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object')
        ? resp.data
        : resp;
    });

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const r = results[i];
      if (r.error) {
        this._lastSweepEnrichFailures += 1;
        this.logger.warn(`[RunPodInstanceSweeper] enrich failed for pod ${t.podId}: ${r.error?.message || r.error}`);
        continue;
      }
      out[t.index] = this._mergeEnriched(out[t.index], r.value);
    }

    return out;
  }

  /** @private */
  _parseCreatedAt(pod) {
    if (pod.createdAt) {
      const t = Date.parse(pod.createdAt);
      if (!Number.isNaN(t)) return t;
    }
    if (typeof pod.created === 'number') {
      // Unix-ms vs unix-s: heuristic — anything > 10^12 is ms.
      return pod.created > 1e12 ? pod.created : pod.created * 1000;
    }
    if (typeof pod.startTime === 'number') {
      return pod.startTime > 1e12 ? pod.startTime : pod.startTime * 1000;
    }
    return null;
  }

  /** @private */
  _alert(payload) {
    if (this.alertCallback) {
      try {
        this.alertCallback(payload);
      } catch (err) {
        this.logger.error('[RunPodInstanceSweeper] Alert callback failed:', err);
      }
    }
  }

  /**
   * Health-check shape mirrors VastAI sweeper's getStatus().
   */
  getStatus() {
    return {
      running: this._intervalHandle !== null,
      sweeping: this._sweeping,
      config: {
        sweepIntervalMs: this.sweepIntervalMs,
        maxRuntimeMs: this.maxRuntimeMs,
        labelPrefix: this.labelPrefix,
        dailyBudgetUsd: this.dailyBudgetUsd,
      },
      spend: {
        bucketKey: this._spendBucketKey,
        spentUsd: this._spendBucketUsd,
      },
      lastSweepEnrichedCount: this._lastSweepEnrichedCount,
      lastSweepEnrichFailures: this._lastSweepEnrichFailures,
    };
  }
}

module.exports = RunPodInstanceSweeper;

// ---------------------------------------------------------------------------
// Inline smoke check — `node RunPodInstanceSweeper.js` runs this. Mocks
// runpodClient.{listPods, terminatePod} and asserts the sweeper terminates
// only the too-old, ours-labeled pod.
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const now = Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;

    const fleet = [
      // ours, fresh — keep
      {
        id: 'pod-fresh',
        name: 'stationthis-bench-1',
        createdAt: new Date(now - 10 * 60 * 1000).toISOString(),
        costPerHr: 0.25
      },
      // ours, too-old — terminate
      {
        id: 'pod-too-old',
        name: 'stationthis-bench-2',
        createdAt: new Date(now - FOUR_HOURS - 10 * 60 * 1000).toISOString(),
        costPerHr: 0.25
      },
      // third-party — skip entirely
      {
        id: 'pod-not-ours',
        name: 'someoneelses-pod',
        createdAt: new Date(now - FOUR_HOURS - 60 * 60 * 1000).toISOString(),
        costPerHr: 0.25
      },
    ];

    const terminated = [];
    const runpodClient = {
      listPods: async () => ({ data: fleet }),
      terminatePod: async (id) => { terminated.push(id); return { ok: true }; }
    };

    const alerts = [];
    const sweeper = new RunPodInstanceSweeper({
      runpodClient,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      maxRuntimeMs: FOUR_HOURS,
      dailyBudgetUsd: 1000, // high — shouldn't trip
      alertCallback: (a) => alerts.push(a),
    });

    const result = await sweeper.sweep();

    const failures = [];
    if (result.podsChecked !== 2) failures.push(`expected podsChecked=2, got ${result.podsChecked}`);
    if (terminated.length !== 1) failures.push(`expected 1 termination, got ${terminated.length}: ${terminated.join(',')}`);
    if (terminated[0] !== 'pod-too-old') failures.push(`expected terminated=[pod-too-old], got ${terminated.join(',')}`);
    if (result.terminated.length !== 1 || result.terminated[0]?.podId !== 'pod-too-old') {
      failures.push(`result.terminated mismatch: ${JSON.stringify(result.terminated)}`);
    }
    const runtimeAlert = alerts.find((a) => a.type === 'runtime-cap');
    if (!runtimeAlert) failures.push('expected a runtime-cap alert');

    // Daily-budget tripwire test — re-run with low budget.
    const sweeper2 = new RunPodInstanceSweeper({
      runpodClient: {
        listPods: async () => ({ data: [fleet[0]] }), // one fresh pod billing
        terminatePod: async () => ({})
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      dailyBudgetUsd: 0.001, // ridiculously low so any spend trips it
      alertCallback: (a) => alerts.push(a),
    });
    const result2 = await sweeper2.sweep();
    const budgetAlert = alerts.find((a) => a.type === 'daily-budget-exceeded');
    if (!budgetAlert) failures.push('expected daily-budget-exceeded alert');
    if (result2.terminated.length !== 0) failures.push('budget tripwire should NOT terminate active pods');

    // Enrich-on-sweep test — bulk listing returns a too-old, ours-labeled pod
    // with costPerHr:null; getPod() supplies the missing cost. Sweep must
    // terminate it AND book the enriched cost into the spend accumulator.
    const ENRICH_HOURS = 5; // older than 4h cap, so termination expected
    const incompleteBulkPod = {
      id: 'pod-needs-enrich',
      name: 'stationthis-bench-3',
      createdAt: new Date(now - ENRICH_HOURS * 60 * 60 * 1000).toISOString(),
      costPerHr: null,         // missing — should trigger enrichment
      publicIp: null,
      portMappings: null,
    };
    const enrichedPod = {
      ...incompleteBulkPod,
      costPerHr: 0.46,
      publicIp: '1.2.3.4',
      portMappings: { '8188/tcp': 12345 },
    };
    const enrichTerminated = [];
    const enrichGetCalls = [];
    const enrichAlerts = [];
    const sweeper3 = new RunPodInstanceSweeper({
      runpodClient: {
        listPods: async () => ({ data: [incompleteBulkPod] }),
        getPod: async (id) => { enrichGetCalls.push(id); return enrichedPod; },
        terminatePod: async (id) => { enrichTerminated.push(id); return { ok: true }; }
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      maxRuntimeMs: FOUR_HOURS,
      dailyBudgetUsd: 1000,
      alertCallback: (a) => enrichAlerts.push(a),
    });
    const result3 = await sweeper3.sweep();
    const status3 = sweeper3.getStatus();

    if (enrichGetCalls.length !== 1 || enrichGetCalls[0] !== 'pod-needs-enrich') {
      failures.push(`expected getPod called once for pod-needs-enrich, got ${JSON.stringify(enrichGetCalls)}`);
    }
    if (enrichTerminated.length !== 1 || enrichTerminated[0] !== 'pod-needs-enrich') {
      failures.push(`expected enrich scenario to terminate pod-needs-enrich, got ${JSON.stringify(enrichTerminated)}`);
    }
    const enrichRuntimeAlert = enrichAlerts.find((a) => a.type === 'runtime-cap');
    if (!enrichRuntimeAlert) failures.push('expected enrich scenario runtime-cap alert');
    // Spend should be > 0 because enrichment supplied costPerHr (0.46 * ~5h).
    // We check it's at least 1.5 (lower bound on 0.46 * 4h, well below 0.46*5h).
    if (!(result3.spentUsd > 1.5)) {
      failures.push(`expected enriched spend > 1.5 USD, got ${result3.spentUsd}`);
    }
    if (status3.lastSweepEnrichedCount !== 1) {
      failures.push(`expected lastSweepEnrichedCount=1, got ${status3.lastSweepEnrichedCount}`);
    }
    if (status3.lastSweepEnrichFailures !== 0) {
      failures.push(`expected lastSweepEnrichFailures=0, got ${status3.lastSweepEnrichFailures}`);
    }

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: RunPodInstanceSweeper');
    console.log('  - terminated only too-old, ours-labeled pod (pod-too-old)');
    console.log('  - skipped third-party pod (someoneelses-pod)');
    console.log('  - kept fresh ours-labeled pod (pod-fresh)');
    console.log('  - runtime-cap alert fired:', runtimeAlert);
    console.log('  - daily-budget tripwire fires alert without terminating:', budgetAlert);
    console.log('  - enrich-on-sweep: getPod backfilled costPerHr=0.46 for pod-needs-enrich');
    console.log(`  - enrich-on-sweep: terminated with enriched spend=$${result3.spentUsd.toFixed(2)} (status=${status3.lastSweepEnrichedCount} enriched, ${status3.lastSweepEnrichFailures} failures)`);
  })().catch((err) => {
    console.error('FAIL: smoke check threw', err);
    process.exit(1);
  });
}
