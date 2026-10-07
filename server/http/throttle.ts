/**
 * A per-key sliding-window limit kept in memory (readiness review
 * 2026-10-07). The public endpoints used plain Maps keyed by address that
 * were never pruned, so a client changing its address grew them without
 * bound. This one keeps at most `limit` times per key, drops keys whose
 * window has passed, and holds at most `maxKeys` keys: past that the least
 * recently used are dropped first (a dropped key starts again, which is the
 * price of a bounded table — the cap is far above legitimate traffic).
 *
 * In memory per server process: with several instances each counts its own.
 */
export interface ThrottleOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys?: number;
  readonly now?: () => number;
}

export class WindowThrottle {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #hits = new Map<string, number[]>();
  #sweptAt = 0;

  constructor(options: ThrottleOptions) {
    this.#limit = Math.max(1, Math.floor(options.limit));
    this.#windowMs = options.windowMs;
    this.#maxKeys = Math.max(1, options.maxKeys ?? 10_000);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#hits.size;
  }

  /** The times of `key` still inside the window. */
  count(key: string): number {
    return this.#recent(key, this.#now()).length;
  }

  /** Records a hit when `key` is under its limit; false when it is not (nothing is recorded). */
  hit(key: string, limit = this.#limit): boolean {
    const now = this.#now();
    this.#sweep(now);
    const recent = this.#recent(key, now);
    if (recent.length >= limit) return false;
    recent.push(now);
    // Re-inserted, so Map order is least recently used first.
    this.#hits.delete(key);
    this.#hits.set(key, recent.slice(-Math.max(limit, this.#limit)));
    while (this.#hits.size > this.#maxKeys) {
      const oldest = this.#hits.keys().next().value;
      if (oldest === undefined) break;
      this.#hits.delete(oldest);
    }
    return true;
  }

  #recent(key: string, now: number): number[] {
    return (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
  }

  #sweep(now: number) {
    if (now - this.#sweptAt < this.#windowMs && this.#hits.size < this.#maxKeys)
      return;
    this.#sweptAt = now;
    for (const [key, times] of this.#hits)
      if (!times.some((t) => now - t < this.#windowMs)) this.#hits.delete(key);
  }
}

/** One-time values (nonces, ticket ids) remembered until they expire, at most `maxKeys` of them. */
export class ExpiringSet {
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #items = new Map<string, number>();

  constructor(options: { maxKeys?: number; now?: () => number } = {}) {
    this.#maxKeys = Math.max(1, options.maxKeys ?? 50_000);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#items.size;
  }

  /** Adds `key` until `expiresAt`; false when it is already there. */
  add(key: string, expiresAt: number): boolean {
    const now = this.#now();
    const existing = this.#items.get(key);
    if (existing !== undefined && existing > now) return false;
    if (this.#items.size >= this.#maxKeys)
      for (const [k, at] of this.#items) if (at <= now) this.#items.delete(k);
    while (this.#items.size >= this.#maxKeys) {
      const oldest = this.#items.keys().next().value;
      if (oldest === undefined) break;
      this.#items.delete(oldest);
    }
    this.#items.set(key, expiresAt);
    return true;
  }
}
