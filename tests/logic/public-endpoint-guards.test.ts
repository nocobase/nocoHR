// @vitest-environment node

// Readiness review 2026-10-07 · public endpoints: the client address behind a proxy, the bounded throttle tables,
// the careers page's human check (server and page agree on the proof of work), the callback signature window and
// the candidate link lifetime.
import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  sha256 as pageSha256,
  solveProof,
} from '../../client/pages/talent/recruiting/public/apply-proof.ts';
import {
  clientIp,
  trustedProxyMatcher,
  UNKNOWN_CLIENT,
} from '../../server/http/client-ip.ts';
import {
  callbackSignatureValid,
  signCallback,
} from '../../server/http/signed-callback.ts';
import { ExpiringSet, WindowThrottle } from '../../server/http/throttle.ts';
import {
  BASE_DIFFICULTY,
  createApplyCheck,
  HARD_DIFFICULTY,
  MIN_FILL_SECONDS,
  solveTicket,
  TICKET_TTL_MS,
} from '../../server/providers/hr/recruiting/apply-check.ts';
import { candidateLinkExpired } from '../../server/providers/hr/recruiting/common.ts';

function ipApp(trusted: readonly string[]) {
  const matcher = trustedProxyMatcher(trusted);
  const app = new Hono();
  app.get('/', (c) => c.text(clientIp(c, matcher)));
  return async (
    peer: string | undefined,
    headers: Record<string, string> = {},
  ) =>
    (
      await app.request(
        '/',
        { headers },
        peer ? { incoming: { socket: { remoteAddress: peer } } } : undefined,
      )
    ).text();
}

describe('clientIp', () => {
  it('ignores X-Forwarded-For and X-Real-IP from a peer that is not a trusted proxy', async () => {
    const ip = ipApp([]);
    expect(
      await ip('203.0.113.5', {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '5.6.7.8',
      }),
    ).toBe('203.0.113.5');
    expect(await ip('::ffff:203.0.113.5')).toBe('203.0.113.5');
    // No socket (embedded host, tests): one shared bucket, whatever the headers say.
    expect(await ip(undefined, { 'x-forwarded-for': '1.2.3.4' })).toBe(
      UNKNOWN_CLIENT,
    );
  });

  it('honours the forwarded address from a trusted proxy, right-most untrusted hop first', async () => {
    const ip = ipApp(['10.0.0.0/8', '::1']);
    expect(await ip('10.1.2.3', { 'x-forwarded-for': '198.51.100.9' })).toBe(
      '198.51.100.9',
    );
    // The client wrote the left-most value itself; the proxy appended the real peer.
    expect(
      await ip('10.1.2.3', {
        'x-forwarded-for': '1.1.1.1, 198.51.100.9, 10.0.0.7',
      }),
    ).toBe('198.51.100.9');
    expect(await ip('::1', { 'x-real-ip': '198.51.100.10' })).toBe(
      '198.51.100.10',
    );
    expect(await ip('10.1.2.3')).toBe('10.1.2.3');
    expect(await ip('10.1.2.3', { 'x-forwarded-for': 'not-an-ip' })).toBe(
      '10.1.2.3',
    );
  });
});

describe('WindowThrottle and ExpiringSet', () => {
  it('limits a key within its window and forgets it afterwards', () => {
    let now = 0;
    const throttle = new WindowThrottle({
      limit: 3,
      windowMs: 1000,
      now: () => now,
    });
    expect([1, 2, 3, 4].map(() => throttle.hit('a'))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 1001;
    expect(throttle.hit('a')).toBe(true);
  });

  it('stays bounded however many addresses a client cycles through', () => {
    let now = 0;
    const throttle = new WindowThrottle({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 100,
      now: () => now,
    });
    for (let i = 0; i < 10_000; i++) {
      throttle.hit(`198.51.${i >> 8}.${i & 255}`);
      now += 1;
    }
    expect(throttle.size).toBeLessThanOrEqual(100);
    // Expired keys are swept once their window has passed.
    now += 120_000;
    throttle.hit('fresh');
    expect(throttle.size).toBe(1);
    const used = new ExpiringSet({ maxKeys: 50, now: () => now });
    for (let i = 0; i < 500; i++) used.add(`n${i}`, now + 1000);
    expect(used.size).toBeLessThanOrEqual(50);
    expect(used.add('n499', now + 1000)).toBe(false);
  });
});

describe('the careers page human check', () => {
  it('computes the same SHA-256 on the page as on the server', () => {
    for (const text of [
      '',
      'a',
      'x'.repeat(55),
      'y'.repeat(64),
      'z'.repeat(200),
    ]) {
      const hex = [...pageSha256(text)]
        .map((w) => w.toString(16).padStart(8, '0'))
        .join('');
      expect(hex).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });

  it('accepts the page’s proof after the minimum fill time, and nothing a naive script sends', async () => {
    const check = createApplyCheck('secret');
    const t0 = 1_800_000_000_000;
    const issued = check.issue('cnc-op', BASE_DIFFICULTY, t0);
    const proof = await solveProof(issued.ticket, issued.difficulty);
    const later = t0 + MIN_FILL_SECONDS * 1000;
    expect(
      check.verify(
        { ticket: issued.ticket, proof },
        'cnc-op',
        BASE_DIFFICULTY,
        later,
      ).ok,
    ).toBe(true);
    const reason = (
      input: { ticket?: string; proof?: string },
      slug = 'cnc-op',
      required = BASE_DIFFICULTY,
      at = later,
    ) => {
      const result = check.verify(input, slug, required, at);
      return result.ok ? 'ok' : result.reason;
    };
    expect(reason({})).toBe('missing');
    expect(reason({ ticket: issued.ticket, proof }, 'other-job')).toBe(
      'invalid',
    );
    expect(reason({ ticket: `${issued.ticket}x`, proof })).toBe('invalid');
    expect(
      reason(
        { ticket: issued.ticket, proof },
        'cnc-op',
        BASE_DIFFICULTY,
        t0 + 100,
      ),
    ).toBe('early');
    expect(
      reason(
        { ticket: issued.ticket, proof },
        'cnc-op',
        BASE_DIFFICULTY,
        t0 + TICKET_TTL_MS + 1,
      ),
    ).toBe('expired');
    expect(
      reason({ ticket: issued.ticket, proof }, 'cnc-op', HARD_DIFFICULTY),
    ).toBe('weak');
    expect(reason({ ticket: issued.ticket, proof: 'abc' })).toBe('proof');
    // A ticket from another server key (or a forged one) is refused.
    const foreign = createApplyCheck('other').issue(
      'cnc-op',
      BASE_DIFFICULTY,
      t0,
    );
    expect(
      reason({
        ticket: foreign.ticket,
        proof: solveTicket(foreign.ticket, BASE_DIFFICULTY),
      }),
    ).toBe('invalid');
  });
});

describe('callback signatures', () => {
  it('accepts a recent signed callback and refuses a stale, unsigned or forged one', () => {
    const raw = '{"eventId":"e1"}';
    const now = 1_800_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const base = { secret: 's', raw, toleranceSeconds: 300, now };
    expect(
      callbackSignatureValid({
        ...base,
        timestamp: ts,
        signature: signCallback('s', ts, raw),
      }),
    ).toBe(true);
    const old = String(Math.floor(now / 1000) - 301);
    expect(
      callbackSignatureValid({
        ...base,
        timestamp: old,
        signature: signCallback('s', old, raw),
      }),
    ).toBe(false);
    expect(
      callbackSignatureValid({
        ...base,
        timestamp: undefined,
        signature: signCallback('s', ts, raw),
      }),
    ).toBe(false);
    expect(
      callbackSignatureValid({
        ...base,
        timestamp: ts,
        signature: signCallback('t', ts, raw),
      }),
    ).toBe(false);
    expect(
      callbackSignatureValid({
        ...base,
        secret: '',
        timestamp: ts,
        signature: signCallback('', ts, raw),
      }),
    ).toBe(false);
  });
});

describe('candidate links', () => {
  it('last 30 days from issue; a link without an issue time counts as expired', () => {
    const now = Date.now();
    expect(candidateLinkExpired(new Date(now - 29 * 86_400_000), now)).toBe(
      false,
    );
    expect(
      candidateLinkExpired(new Date(now - 31 * 86_400_000).toISOString(), now),
    ).toBe(true);
    expect(candidateLinkExpired(null, now)).toBe(true);
  });
});
