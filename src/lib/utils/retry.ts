/**
 * Retry a function with exponential backoff and jitter.
 *
 * Defaults: 3 retries, 500 ms base delay, retries on all thrown errors.
 *
 * ## Result-shaped failures
 *
 * Some SDKs never throw. The Resend SDK, for example, resolves with
 * `{ data: null, error: {...} }` for every non-2xx response *and* from inside
 * its own catch block, so even a network failure produces a resolved promise.
 * A retry loop that only reacts to `catch` therefore performs exactly one
 * attempt against such a client (audit docs/29 P0-4).
 *
 * Pass `isFailure` to make those failures retryable. When the predicate
 * returns true the value is treated like a thrown error: it is retried with
 * the same backoff. Once the attempts are exhausted the last failing value is
 * *returned* rather than thrown, so callers keep using the SDK's own
 * `{ data, error }` contract and can inspect `.error` themselves.
 *
 * Callers that do not pass `isFailure` are unaffected: every resolved value is
 * returned on the first attempt, exactly as before.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    /** Retry predicate for *thrown* errors. Default: retry everything. */
    shouldRetry?: (err: unknown) => boolean;
    /** Retry predicate for *resolved* values (result-shaped errors). */
    isFailure?: (value: T) => boolean;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, shouldRetry = () => true, isFailure } = opts;

  let lastError: unknown;
  let lastFailedValue: T | undefined;
  let hasFailedValue = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let value: T;

    try {
      value = await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxRetries || !shouldRetry(err)) {
        throw err;
      }

      await backoff(baseDelayMs, attempt);
      continue;
    }

    // Resolved. Only a caller-supplied predicate can classify it as a failure.
    if (!isFailure?.(value)) return value;

    lastFailedValue = value;
    hasFailedValue = true;

    // Attempts exhausted: hand the failing value back so the caller can
    // inspect its error field, matching the SDK's own contract.
    if (attempt === maxRetries) return value;

    await backoff(baseDelayMs, attempt);
  }

  /* c8 ignore start -- unreachable; the loop always returns or throws */
  if (hasFailedValue) return lastFailedValue as T;
  throw lastError;
  /* c8 ignore stop */
}

/** Exponential backoff with jitter: baseDelay * 2^attempt * (0.5..1.5). */
function backoff(baseDelayMs: number, attempt: number): Promise<void> {
  const jitter = 0.5 + Math.random();
  const delayMs = baseDelayMs * Math.pow(2, attempt) * jitter;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
