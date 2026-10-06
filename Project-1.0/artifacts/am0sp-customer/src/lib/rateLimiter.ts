// Client-side rate limiter for authentication actions.
// Prevents brute-force attempts by enforcing a cooldown between requests
// and a maximum number of attempts per window.

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

interface RateLimitState {
  attempts: number[];
  windowMs: number;
  maxAttempts: number;
}

const store = new Map<string, RateLimitState>();

/**
 * Check whether an action is allowed under the rate limit.
 * Returns { allowed, retryAfterMs } — if not allowed, retryAfterMs
 * tells the caller how long to wait before the next attempt is permitted.
 */
export function checkRateLimit(
  key: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let state = store.get(key);

  if (!state) {
    state = { attempts: [now], windowMs, maxAttempts };
    store.set(key, state);
    return { allowed: true, retryAfterMs: 0 };
  }

  // Prune attempts outside the window
  state.attempts = state.attempts.filter((t) => now - t < state!.windowMs);

  if (state.attempts.length >= state.maxAttempts) {
    const oldestInWindow = state.attempts[0];
    const retryAfterMs = state.windowMs - (now - oldestInWindow);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  state.attempts.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/** Reset the rate limiter for a given key (e.g., after a successful action). */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
