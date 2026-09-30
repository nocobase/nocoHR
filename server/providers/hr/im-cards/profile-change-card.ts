/**
 * 本人提交卡片 for 信息修改申请 (V1-04): the HR assistant drafts the change in
 * the bot conversation with its `submitMyProfileChange` tool; the tool waits
 * for the employee's approval, and the bot turns that pause into this card
 * instead of asking the employee to open NocoHR. 提交 calls the same
 * `requestProfileChange` as 我的档案, as the employee, with source
 * `feishuCard`; HR reviews it as any other request. 修改后在 NocoHR 提交 links to
 * the form; 放弃 closes the card. Only the recipient can press either.
 *
 * The card lists each change as before → after, masked: a mobile number,
 * address or contact's phone never appears in full, even the employee's own.
 * The drafted values stay in the card's payload until it is handled and are
 * cleared then.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { HrCoreService } from '../core-service.js';
import { HrError, isRecord, str } from '../shared.js';
import { defineCardKind, type Translate } from './types.js';

export const PROFILE_CHANGE_CARD = 'profileChangeSubmit';

const payloadSchema = z.object({
  /** The drafted change, exactly as `requestProfileChange` takes it; null once handled. */
  changes: z.record(z.string(), z.unknown()).nullable(),
  /** Masked lines computed when drafted, so the card reads the same after submitting. */
  display: z
    .array(
      z.object({ field: z.string(), before: z.string(), after: z.string() }),
    )
    .max(40),
});
export type ProfileChangeCardPayload = z.infer<typeof payloadSchema>;

export function maskMobile(value: string): string {
  const digits = value.replace(/\s/gu, '');
  return digits.length >= 7
    ? `${digits.slice(0, 3)}****${digits.slice(-4)}`
    : '****';
}
function maskEmail(value: string): string {
  const [name = '', domain = ''] = value.split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
}
function maskAddress(value: string): string {
  const text = value.trim();
  return text ? `${Array.from(text).slice(0, 3).join('')}****` : '';
}

function contacts(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter(isRecord)
    .map((c) =>
      [
        str(c.name ?? ''),
        c.relation ? `（${str(c.relation)}）` : '',
        c.phone ? ` ${maskMobile(str(c.phone))}` : '',
      ].join(''),
    )
    .join('；');
}

export function profileChangeCardKind(deps: {
  readonly database: DatabaseManager;
  readonly core: () => HrCoreService;
}) {
  /** Masked before → after lines for a drafted change; throws when a field cannot be self-changed. */
  async function describe(
    userId: string,
    changes: Record<string, unknown>,
    t: Translate,
  ): Promise<ProfileChangeCardPayload['display']> {
    const allowed = await deps.core().selfServiceFields();
    const employee = await deps.database
      .query()
      .selectFrom('employees')
      .select(['id', 'mobile', 'email', 'address'])
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (!employee) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
    const lines: ProfileChangeCardPayload['display'] = [];
    const empty = t('imCards.profileChange.empty');
    for (const [field, after] of Object.entries(changes)) {
      if (field === 'customFields') {
        if (!isRecord(after)) throw new HrError('INVALID_INPUT', 400);
        for (const [key, value] of Object.entries(after)) {
          const definition = allowed.customFields.find((d) => d.key === key);
          if (!definition)
            throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, {
              field: key,
            });
          lines.push({
            field: definition.label['zh-CN'],
            before: '',
            after: Array.isArray(value)
              ? value.map(String).join('、')
              : typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ? String(value)
                : '',
          });
        }
        continue;
      }
      if (!allowed.fields.includes(field))
        throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, { field });
      const label = t(`imCards.profileChange.fields.${field}`);
      if (field === 'mobile' || field === 'email' || field === 'address') {
        const mask =
          field === 'mobile'
            ? maskMobile
            : field === 'email'
              ? maskEmail
              : maskAddress;
        const before = employee[field] ? str(employee[field]) : '';
        lines.push({
          field: label,
          before: before ? mask(before) : empty,
          after: typeof after === 'string' && after ? mask(after) : empty,
        });
      } else if (field === 'emergencyContacts') {
        const current = await deps.database
          .query()
          .selectFrom('employeeEmergencyContacts')
          .select(['name', 'relation', 'phone'])
          .where('employeeId', '=', str(employee.id))
          .execute();
        lines.push({
          field: label,
          before: contacts(current) || empty,
          after: contacts(after) || empty,
        });
      } else {
        lines.push({
          field: label,
          before: '',
          after: t('imCards.profileChange.items', {
            count: Array.isArray(after) ? after.length : 0,
          }),
        });
      }
    }
    return lines;
  }

  const kind = defineCardKind({
    kind: PROFILE_CHANGE_CARD,
    payload: payloadSchema,

    async render({ payload, card, t }) {
      const open = card.status === 'open';
      return {
        title: t('imCards.profileChange.title'),
        lines: payload.display.map((line) =>
          line.before
            ? `${line.field}：${line.before} → ${line.after}`
            : `${line.field}：${line.after}`,
        ),
        buttons: open
          ? [
              {
                key: 'submit',
                label: t('imCards.profileChange.submit'),
                style: 'primary',
              },
              { key: 'discard', label: t('imCards.profileChange.discard') },
            ]
          : [],
        link: {
          label: t('imCards.profileChange.editInApp'),
          path: '/talent/me?change=1',
        },
        state: open ? 'open' : card.status,
      };
    },

    async act({ payload, actor, button, t }) {
      if (button === 'discard')
        return {
          outcome: 'discarded',
          message: t('imCards.profileChange.discarded'),
          payload: { ...payload, changes: null },
        };
      if (button !== 'submit' || !payload.changes)
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      try {
        await deps
          .core()
          .requestProfileChange(actor, { ...payload.changes }, 'feishuCard');
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
        if (error.code === 'PROFILE_CHANGE_PENDING')
          return {
            outcome: 'kept',
            message: t('imCards.profileChange.pending'),
          };
        if (error.status === 403)
          return {
            outcome: 'refused',
            message: t('imCards.profileChange.forbidden'),
          };
        return {
          outcome: 'kept',
          message: t('imCards.result.failed', { code: error.code }),
        };
      }
      return {
        outcome: 'handled',
        message: t('imCards.profileChange.submitted'),
        payload: { ...payload, changes: null },
      };
    },
  });

  return { kind, describe };
}
