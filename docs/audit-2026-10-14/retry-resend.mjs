// Prove retryWithBackoff does not retry a resolved {error} payload (Resend SDK shape)
async function retryWithBackoff(fn, opts = {}) {
  const { maxRetries = 3, baseDelayMs = 500, shouldRetry = () => true } = opts;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !shouldRetry(err)) throw err;
      await new Promise(r => setTimeout(r, 1));
    }
  }
  throw lastError;
}
let calls = 0;
const fakeResendSend = async () => { calls++; return { data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } }; };
const res = await retryWithBackoff(fakeResendSend, { maxRetries: 2, baseDelayMs: 500 });
console.log('attempts made:', calls, '(expected 3 if retried, 1 if not)');
console.log('returned error field:', JSON.stringify(res.error));
// payment-service.ts:321 discards the return value entirely:
await retryWithBackoff(fakeResendSend, { maxRetries: 2, baseDelayMs: 500 });
console.log('payment-service style call: no throw, error silently discarded. total attempts:', calls);
