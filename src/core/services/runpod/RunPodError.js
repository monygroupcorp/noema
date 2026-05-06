/**
 * RunPodError — typed error for the RunPod surface.
 *
 * Carries an optional `cause`. The cause MUST be safe to serialize — axios
 * errors are NOT safe (their `.config` includes `Authorization` headers and
 * the request body). RunPodPodClient.request() always sanitizes via
 * sanitizeAxiosError() before passing the error here, but as a defense in
 * depth we strip a known set of unsafe shapes if a raw axios error slips in.
 */
function looksLikeAxiosError(err) {
  return !!(err && (err.isAxiosError === true || err.config || err.response?.config));
}

function sanitizeCause(cause) {
  if (!cause) return cause;
  if (!looksLikeAxiosError(cause)) return cause;
  // Strip everything axios-specific. Keep just message + status + name.
  const safe = new Error(cause.message || 'Request failed');
  safe.name = cause.name || 'Error';
  if (cause.response?.status != null) safe.status = cause.response.status;
  return safe;
}

class RunPodError extends Error {
  constructor(message, { status, code, cause, requestId, jobId } = {}) {
    super(message);
    this.name = 'RunPodError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.jobId = jobId;
    if (cause) {
      this.cause = sanitizeCause(cause);
    }
  }
}

module.exports = RunPodError;
