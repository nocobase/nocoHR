/**
 * V4-14 排班资质校验 (extends the V2-05 schedule checks): a shift may require
 * certifications (`shifts.requiredCertificationIds`). Someone scheduled onto
 * it needs, for each, a certificate that is `valid` or `expiring` and does
 * not expire before the shift ends (a certificate is valid through its
 * expiry date, local time); otherwise the cell is blocked with
 * `certificationMissing`. Rules decide: neither the scheduler nor an AI
 * employee can let a blocked cell through.
 *
 * The preflight loads the inputs on its own connection (the check runs inside
 * the schedule save's transaction, so it reads nothing through services);
 * with the industry pack off, or its schedule check off, nothing is loaded
 * and nothing is checked. The same inputs filter 顶班候选 (replacement.ts).
 */
import type { QueryAdapter } from '@nocobase/db';

import { zonedInstant } from '../leave-duration.js';
import { json } from '../platform.js';
import { addDays, str } from '../shared.js';
import { readPack } from './pack.js';

const HOLDING = ['valid', 'expiring'];

export interface QualificationHolding {
  readonly employeeId: string;
  readonly certificationId: string;
  readonly certificateId: string;
  readonly certificateNo: string;
  /** Date only; null never expires. */
  readonly expiresAt: string | null;
}

export interface QualificationInput {
  /** Per shift id, the active certifications it requires. */
  readonly required: ReadonlyMap<
    string,
    readonly { id: string; title: string }[]
  >;
  readonly holdings: readonly QualificationHolding[];
}

export interface QualificationCheck {
  rule: 'certificationMissing';
  level: 'block';
  /** CERTIFICATION_MISSING (none held) or CERTIFICATION_EXPIRES_BEFORE_SHIFT_END. */
  message: string;
  certificationId: string;
  params: Record<string, string>;
}

const dateOnly = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : str(value).slice(0, 10);

/** The shifts' requirements, when the pack and its schedule check are on; undefined otherwise. */
export async function loadShiftRequirements(
  query: QueryAdapter,
  shiftIds: readonly string[],
): Promise<Map<string, { id: string; title: string }[]> | undefined> {
  const pack = await readPack(query);
  if (!pack.enabled || !pack.scheduleCheckEnabled || !shiftIds.length)
    return undefined;
  const shifts = await query
    .selectFrom('shifts')
    .select(['id', 'requiredCertificationIds'])
    .where('id', 'in', [...new Set(shiftIds)])
    .execute();
  const wanted = new Map<string, string[]>();
  for (const shift of shifts) {
    const ids = json<unknown>(shift.requiredCertificationIds, null);
    if (Array.isArray(ids) && ids.length)
      wanted.set(
        str(shift.id),
        ids.filter((id): id is string => typeof id === 'string'),
      );
  }
  if (!wanted.size) return new Map();
  const certifications = await query
    .selectFrom('certifications')
    .select(['id', 'title'])
    .where('active', '=', true)
    .where('id', 'in', [...new Set([...wanted.values()].flat())])
    .execute();
  const titles = new Map(certifications.map((c) => [str(c.id), str(c.title)]));
  const required = new Map<string, { id: string; title: string }[]>();
  for (const [shiftId, ids] of wanted) {
    // A requirement on a disabled certification no longer applies.
    const list = ids
      .filter((id) => titles.has(id))
      .map((id) => ({ id, title: titles.get(id)! }));
    if (list.length) required.set(shiftId, list);
  }
  return required;
}

/** Valid or expiring certificates of the given employees for the given certifications. */
export async function loadHoldings(
  query: QueryAdapter,
  employeeIds: readonly string[],
  certificationIds: readonly string[],
): Promise<QualificationHolding[]> {
  if (!employeeIds.length || !certificationIds.length) return [];
  const rows = await query
    .selectFrom('employeeCertificates')
    .select([
      'id',
      'employeeId',
      'certificationId',
      'certificateNo',
      'expiresAt',
    ])
    .where('employeeId', 'in', [...new Set(employeeIds)])
    .where('certificationId', 'in', [...new Set(certificationIds)])
    .where('status', 'in', HOLDING)
    .execute();
  return rows.map((row) => ({
    employeeId: str(row.employeeId),
    certificationId: str(row.certificationId),
    certificateId: str(row.id),
    certificateNo: str(row.certificateNo),
    expiresAt: dateOnly(row.expiresAt),
  }));
}

/** The preflight's input: undefined when nothing is checked. */
export async function loadQualificationInput(
  query: QueryAdapter,
  shiftIds: readonly string[],
  employeeIds: readonly string[],
): Promise<QualificationInput | undefined> {
  const required = await loadShiftRequirements(query, shiftIds);
  if (!required?.size) return undefined;
  const certificationIds = [
    ...new Set([...required.values()].flat().map((c) => c.id)),
  ];
  return {
    required,
    holdings: await loadHoldings(query, employeeIds, certificationIds),
  };
}

/** Whether a holding covers a shift ending at `shiftEnd` (epoch ms). */
export function coversShift(
  holding: Pick<QualificationHolding, 'expiresAt'>,
  shiftEnd: number,
  timeZone: string,
): boolean {
  if (!holding.expiresAt) return true;
  return (
    shiftEnd <= zonedInstant(addDays(holding.expiresAt, 1), '00:00', timeZone)
  );
}

/** The certificationMissing checks of one scheduled cell. */
export function qualificationChecks(
  cell: { employeeId: string; shiftId: string | null },
  shiftEnd: number,
  input: QualificationInput | undefined,
  timeZone: string,
): QualificationCheck[] {
  if (!input || !cell.shiftId) return [];
  const checks: QualificationCheck[] = [];
  for (const certification of input.required.get(cell.shiftId) ?? []) {
    const held = input.holdings.filter(
      (h) =>
        h.employeeId === cell.employeeId &&
        h.certificationId === certification.id,
    );
    if (held.some((h) => coversShift(h, shiftEnd, timeZone))) continue;
    const latest = held
      .map((h) => h.expiresAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1);
    checks.push({
      rule: 'certificationMissing',
      level: 'block',
      message: latest
        ? 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END'
        : 'CERTIFICATION_MISSING',
      certificationId: certification.id,
      params: { certification: certification.title, expiresAt: latest ?? '' },
    });
  }
  return checks;
}
