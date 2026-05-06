/**
 * StallDetector — watch a running ComfyUI job on a RunPod pod for stall
 * signals and emit a kill verdict when stalled. Detection only; the caller
 * (orchestrator) decides what to do with the verdict.
 *
 * Three independent heuristics, OR'd together:
 *   1. progress-stale  — /queue says queue_running is non-empty, but no
 *      observable progress (queue_running mutation, /history growth, or
 *      progress event) for stallTimeoutMs.
 *   2. log-silence     — streamed stdout has been idle for stallTimeoutMs
 *      while we still believe a job is running.
 *   3. http-unreachable — /queue has failed httpFailureThreshold times in a
 *      row.
 *
 * Inputs are intentionally minimal: caller supplies the SSH connection
 * (already established) and the ComfyUI host:port. We don't open the
 * connection or own the pod lifecycle.
 *
 * Events:
 *   progress  ({ source, at })       — fresh progress observed
 *   stalled   ({ reason, status })   — first time we cross the threshold
 *   recovered ({ at })               — stall cleared (e.g. progress resumed)
 */

const EventEmitter = require('events');

class StallDetector extends EventEmitter {
  constructor({
    podId,
    sshConnection,
    comfyUiHost,
    comfyUiPort = 8188,
    expectedSteps = null,
    stallTimeoutMs = 120000,
    pollIntervalMs = 10000,
    httpFailureThreshold = 3,
    logger,
    httpFetch,
  } = {}) {
    super();
    if (!podId) throw new Error('StallDetector requires podId');
    if (!comfyUiHost) throw new Error('StallDetector requires comfyUiHost');

    this.podId = podId;
    this.sshConnection = sshConnection || null;
    this.comfyUiHost = comfyUiHost;
    this.comfyUiPort = comfyUiPort;
    this.expectedSteps = expectedSteps;
    this.stallTimeoutMs = stallTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.httpFailureThreshold = httpFailureThreshold;
    this.logger = logger || console;
    this._httpFetch = httpFetch || null;

    const now = Date.now();
    this._intervalHandle = null;
    this._stalled = false;
    this._stallReason = null;
    this._lastProgressAt = now;
    this._lastLogLineAt = now;
    this._consecutiveHttpFailures = 0;
    this._lastQueueSignature = null;
    this._lastHistoryCount = null;
    this._stdoutListener = null;
    this._stderrListener = null;
    this._stream = null;
  }

  start() {
    if (this._intervalHandle) {
      this.logger.warn(`[StallDetector:${this.podId}] Already running`);
      return;
    }
    this.logger.info(`[StallDetector:${this.podId}] Starting (timeout=${this.stallTimeoutMs}ms, poll=${this.pollIntervalMs}ms)`);

    const now = Date.now();
    this._lastProgressAt = now;
    this._lastLogLineAt = now;

    this._attachLogStream();

    this._poll().catch((err) => {
      this.logger.error(`[StallDetector:${this.podId}] Initial poll failed:`, err);
    });
    this._intervalHandle = setInterval(() => {
      this._poll().catch((err) => {
        this.logger.error(`[StallDetector:${this.podId}] Poll failed:`, err);
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
    this._detachLogStream();
    this.logger.info(`[StallDetector:${this.podId}] Stopped`);
  }

  getStatus() {
    return {
      stalled: this._stalled,
      lastProgressAt: this._lastProgressAt,
      lastLogLineAt: this._lastLogLineAt,
      reason: this._stallReason,
      consecutiveHttpFailures: this._consecutiveHttpFailures,
    };
  }

  /**
   * Attach to SSH stdout/stderr if a stream-providing connection was passed.
   * We accept either a ssh2 ClientChannel-like object (passed via
   * sshConnection.stream) or a stream object directly on sshConnection.
   */
  _attachLogStream() {
    const stream = this._resolveLogStream();
    if (!stream) return;
    this._stream = stream;

    this._stdoutListener = (chunk) => this._onLogChunk(chunk, 'stdout');
    this._stderrListener = (chunk) => this._onLogChunk(chunk, 'stderr');

    if (typeof stream.on === 'function') {
      stream.on('data', this._stdoutListener);
      if (stream.stderr && typeof stream.stderr.on === 'function') {
        stream.stderr.on('data', this._stderrListener);
      }
    }
  }

  _detachLogStream() {
    const stream = this._stream;
    if (!stream) return;
    if (typeof stream.off === 'function') {
      if (this._stdoutListener) stream.off('data', this._stdoutListener);
      if (stream.stderr && this._stderrListener) stream.stderr.off('data', this._stderrListener);
    } else if (typeof stream.removeListener === 'function') {
      if (this._stdoutListener) stream.removeListener('data', this._stdoutListener);
      if (stream.stderr && this._stderrListener) stream.stderr.removeListener('data', this._stderrListener);
    }
    this._stream = null;
    this._stdoutListener = null;
    this._stderrListener = null;
  }

  _resolveLogStream() {
    const c = this.sshConnection;
    if (!c) return null;
    if (typeof c.on === 'function') return c;
    if (c.stream && typeof c.stream.on === 'function') return c.stream;
    if (c.channel && typeof c.channel.on === 'function') return c.channel;
    return null;
  }

  _onLogChunk(chunk, source) {
    const now = Date.now();
    this._lastLogLineAt = now;
    // Stdout activity often correlates with real progress (sampler ticks,
    // step counters). Treat any chunk as a soft progress signal too.
    this._markProgress('log', now);
    if (this.logger && typeof this.logger.debug === 'function') {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      this.logger.debug(`[StallDetector:${this.podId}] ${source}: ${text.slice(0, 120)}`);
    }
  }

  _markProgress(source, at) {
    this._lastProgressAt = at;
    if (this._stalled) {
      this._stalled = false;
      this._stallReason = null;
      this.emit('recovered', { at });
    }
    this.emit('progress', { source, at });
  }

  async _poll() {
    const now = Date.now();
    let queueRunningCount = 0;
    let queueOk = false;

    try {
      const queue = await this._fetchJson(`/queue`);
      queueOk = true;
      this._consecutiveHttpFailures = 0;

      const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
      const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
      queueRunningCount = running.length;

      const signature = JSON.stringify({
        r: running.map((x) => (Array.isArray(x) ? x[0] : x)),
        p: pending.length,
      });
      if (signature !== this._lastQueueSignature) {
        this._lastQueueSignature = signature;
        this._markProgress('queue', now);
      }
    } catch (err) {
      this._consecutiveHttpFailures += 1;
      this.logger.warn(`[StallDetector:${this.podId}] /queue fetch failed (${this._consecutiveHttpFailures}/${this.httpFailureThreshold}): ${err?.message}`);
    }

    if (queueOk) {
      try {
        const history = await this._fetchJson(`/history`);
        const count = history && typeof history === 'object' ? Object.keys(history).length : 0;
        if (this._lastHistoryCount !== null && count > this._lastHistoryCount) {
          this._markProgress('history', now);
        }
        this._lastHistoryCount = count;
      } catch (err) {
        this.logger.debug(`[StallDetector:${this.podId}] /history fetch failed: ${err?.message}`);
      }
    }

    this._evaluate({ queueRunningCount, queueOk, now });
  }

  _evaluate({ queueRunningCount, queueOk, now }) {
    if (this._stalled) return;

    if (this._consecutiveHttpFailures >= this.httpFailureThreshold) {
      this._trip(`http-unreachable (${this._consecutiveHttpFailures} consecutive failures)`);
      return;
    }

    const jobRunning = queueRunningCount > 0;
    if (!jobRunning) return;

    const sinceProgress = now - this._lastProgressAt;
    if (queueOk && sinceProgress >= this.stallTimeoutMs) {
      this._trip(`progress-stale (${sinceProgress}ms since last progress)`);
      return;
    }

    const sinceLog = now - this._lastLogLineAt;
    if (this._stream && sinceLog >= this.stallTimeoutMs) {
      this._trip(`log-silence (${sinceLog}ms since last stdout)`);
      return;
    }
  }

  _trip(reason) {
    this._stalled = true;
    this._stallReason = reason;
    this.logger.error(`[StallDetector:${this.podId}] STALL DETECTED: ${reason}`);
    this.emit('stalled', { reason, status: this.getStatus() });
  }

  async _fetchJson(path) {
    if (this._httpFetch) {
      const res = await this._httpFetch(path);
      if (!res || res.ok === false) {
        const status = res && res.status != null ? res.status : 'unknown';
        throw new Error(`HTTP ${status}`);
      }
      return typeof res.json === 'function' ? await res.json() : res.body;
    }

    if (typeof fetch !== 'function') {
      throw new Error('No HTTP client available (set httpFetch or run on Node 18+)');
    }
    const url = `http://${this.comfyUiHost}:${this.comfyUiPort}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
}

module.exports = StallDetector;

// ---------------------------------------------------------------------------
// Inline smoke check — `node StallDetector.js`. Three scenarios using fake
// SSH/HTTP shims: healthy progress, log silence, HTTP unreachable.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { EventEmitter: EE } = require('events');

  const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  function makeFakeStream() {
    const stream = new EE();
    stream.stderr = new EE();
    return stream;
  }

  function makeQueueShim({ runningPromptIds = [], history = {} } = {}) {
    return async (path) => {
      if (path === '/queue') {
        return {
          ok: true,
          json: async () => ({
            queue_running: runningPromptIds.map((id) => [id, id, {}]),
            queue_pending: [],
          }),
        };
      }
      if (path === '/history') {
        return { ok: true, json: async () => history };
      }
      return { ok: false, status: 404 };
    };
  }

  function makeFailingShim() {
    return async () => { throw new Error('ECONNREFUSED'); };
  }

  async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  (async () => {
    const failures = [];

    // Scenario 1: healthy — progress every poll, no stall.
    {
      const stream = makeFakeStream();
      let runId = 1;
      const detector = new StallDetector({
        podId: 'pod-healthy',
        sshConnection: stream,
        comfyUiHost: '127.0.0.1',
        stallTimeoutMs: 200,
        pollIntervalMs: 40,
        logger: silentLogger,
        httpFetch: async (path) => {
          // Mutate queue signature each call to simulate progress.
          runId += 1;
          return makeQueueShim({ runningPromptIds: [`prompt-${runId}`] })(path);
        },
      });
      let stalled = false;
      detector.on('stalled', () => { stalled = true; });
      detector.start();
      // Drip stdout to keep log timer fresh.
      const dripper = setInterval(() => stream.emit('data', Buffer.from('step 1/20\n')), 30);
      await wait(400);
      clearInterval(dripper);
      detector.stop();
      const s = detector.getStatus();
      if (stalled) failures.push('healthy: should NOT have stalled');
      if (s.stalled) failures.push('healthy: getStatus().stalled should be false');
      console.log(`  healthy:    stalled=${s.stalled} reason=${s.reason || 'none'}`);
    }

    // Scenario 2: log silence — queue running but signature frozen + no log.
    {
      const stream = makeFakeStream();
      const detector = new StallDetector({
        podId: 'pod-logsilent',
        sshConnection: stream,
        comfyUiHost: '127.0.0.1',
        stallTimeoutMs: 150,
        pollIntervalMs: 30,
        logger: silentLogger,
        httpFetch: makeQueueShim({ runningPromptIds: ['frozen-prompt'] }),
      });
      let stallEvent = null;
      detector.on('stalled', (e) => { stallEvent = e; });
      // Seed with one log chunk so log timer starts, then go silent.
      detector.start();
      stream.emit('data', Buffer.from('starting...\n'));
      await wait(400);
      detector.stop();
      const s = detector.getStatus();
      if (!s.stalled) failures.push('logsilent: should be stalled');
      if (!stallEvent) failures.push('logsilent: stalled event not emitted');
      const ok = s.reason && (s.reason.startsWith('progress-stale') || s.reason.startsWith('log-silence'));
      if (!ok) failures.push(`logsilent: unexpected reason ${s.reason}`);
      console.log(`  logsilent:  stalled=${s.stalled} reason=${s.reason}`);
    }

    // Scenario 3: HTTP unreachable — every fetch throws.
    {
      const detector = new StallDetector({
        podId: 'pod-httpdown',
        comfyUiHost: '127.0.0.1',
        stallTimeoutMs: 10000,
        pollIntervalMs: 25,
        httpFailureThreshold: 3,
        logger: silentLogger,
        httpFetch: makeFailingShim(),
      });
      let stallEvent = null;
      detector.on('stalled', (e) => { stallEvent = e; });
      detector.start();
      await wait(250);
      detector.stop();
      const s = detector.getStatus();
      if (!s.stalled) failures.push('httpdown: should be stalled');
      if (!stallEvent) failures.push('httpdown: stalled event not emitted');
      if (!s.reason || !s.reason.startsWith('http-unreachable')) {
        failures.push(`httpdown: unexpected reason ${s.reason}`);
      }
      console.log(`  httpdown:   stalled=${s.stalled} reason=${s.reason}`);
    }

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: StallDetector');
  })().catch((err) => {
    console.error('FAIL: smoke check threw', err);
    process.exit(1);
  });
}
