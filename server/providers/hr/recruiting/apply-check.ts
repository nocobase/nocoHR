/**
 * The careers page's human check (readiness review 2026-10-07).
 *
 * It replaces an `a + b = ?` question that a script read from the error and
 * answered. Without a third-party CAPTCHA no check tells a person from a
 * determined script, so this one makes volume expensive and keeps a person's
 * path free of puzzles (nothing to read, hear or type — it is as accessible as
 * the form itself):
 *
 * - every application carries a ticket from `POST …/jobs/:slug/ticket`,
 *   signed by the server, bound to the posting, valid for two hours and
 *   accepted once;
 * - the ticket must be at least `MIN_FILL_SECONDS` old: a person answering the
 *   questions and filling the form takes longer, a script must wait;
 * - the ticket asks for a proof of work — a number whose SHA-256 with the
 *   ticket starts with `difficulty` zero bits. The page finds it while the
 *   person types (about 4 000 hashes, milliseconds); beyond the per-address
 *   limit of the hour (`publicPage.ipLimitPerHour`, by an address the client
 *   can no longer choose) the next ticket asks for 2^18 hashes, seconds of
 *   work per application;
 * - a hidden field (`website`) that people never see must stay empty.
 *
 * A failed check answers PUBLIC_VERIFY_REQUIRED with a fresh ticket, which the
 * page solves and sends again by itself.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const BASE_DIFFICULTY = 12;
export const HARD_DIFFICULTY = 18;
export const MIN_FILL_SECONDS = 2;
export const TICKET_TTL_MS = 2 * 3_600_000;

interface TicketBody {
  /** The posting's public slug. */
  readonly s: string;
  /** Issued at (ms). */
  readonly i: number;
  /** Nonce: the ticket's identity for single use. */
  readonly n: string;
  /** Leading zero bits the proof must reach. */
  readonly d: number;
}

export interface ApplyTicket {
  readonly ticket: string;
  readonly difficulty: number;
  readonly minSeconds: number;
}

export type TicketCheck =
  | { ok: true; nonce: string; expiresAt: number }
  | {
      ok: false;
      reason: 'missing' | 'invalid' | 'expired' | 'early' | 'weak' | 'proof';
    };

/** Leading zero bits of a digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function proofDigest(ticket: string, proof: string): Uint8Array {
  return createHash('sha256').update(`${ticket}:${proof}`).digest();
}

/** Finds a proof (tests and tools; the page has its own). */
export function solveTicket(ticket: string, difficulty: number): string {
  for (let n = 0; ; n++)
    if (leadingZeroBits(proofDigest(ticket, String(n))) >= difficulty)
      return String(n);
}

export function createApplyCheck(secret: string | undefined) {
  // Derived, so the ticket key is not the configured secret itself; random per process when none is given.
  const key = createHmac('sha256', secret || randomBytes(32))
    .update('nocohr:recruiting:apply-ticket')
    .digest();
  const sign = (payload: string) =>
    createHmac('sha256', key).update(payload).digest('base64url');

  return {
    issue(slug: string, difficulty: number, now: number): ApplyTicket {
      const body: TicketBody = {
        s: slug,
        i: now,
        n: randomBytes(12).toString('base64url'),
        d: difficulty,
      };
      const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
      return {
        ticket: `${payload}.${sign(payload)}`,
        difficulty,
        minSeconds: MIN_FILL_SECONDS,
      };
    },

    verify(
      input: { ticket?: string; proof?: string },
      slug: string,
      required: number,
      now: number,
    ): TicketCheck {
      const ticket = input.ticket ?? '';
      if (!ticket) return { ok: false, reason: 'missing' };
      if (ticket.length > 512) return { ok: false, reason: 'invalid' };
      const [payload = '', signature = ''] = ticket.split('.');
      const expected = sign(payload);
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        return { ok: false, reason: 'invalid' };
      let body: TicketBody;
      try {
        body = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as TicketBody;
      } catch {
        return { ok: false, reason: 'invalid' };
      }
      if (
        body.s !== slug ||
        typeof body.i !== 'number' ||
        typeof body.n !== 'string'
      )
        return { ok: false, reason: 'invalid' };
      if (now - body.i > TICKET_TTL_MS || body.i > now + 60_000)
        return { ok: false, reason: 'expired' };
      if (now - body.i < MIN_FILL_SECONDS * 1000)
        return { ok: false, reason: 'early' };
      if (body.d < required) return { ok: false, reason: 'weak' };
      const proof = input.proof ?? '';
      if (
        !/^\d{1,16}$/u.test(proof) ||
        leadingZeroBits(proofDigest(ticket, proof)) < body.d
      )
        return { ok: false, reason: 'proof' };
      return { ok: true, nonce: body.n, expiresAt: body.i + TICKET_TTL_MS };
    },
  };
}

export type ApplyCheck = ReturnType<typeof createApplyCheck>;
