/**
 * 通知推送 to the office suite (V1-04). Every HR notification goes to the
 * in-app inbox; a recipient bound to Feishu also gets it there, unless they
 * turned Feishu off in 我的档案 · 通知设置. The notification plugin only posts
 * to group webhooks, so this sends through the bot to the one user:
 *
 * - a pending personnel-action approval becomes an 审批卡片; everything else
 *   is a short message: title, one-line summary (none when the notifier
 *   withholds it as personal) and a NocoHR link;
 * - a key is pushed to a user once, as the inbox sends a key once;
 * - the result is written to the to-do's `pushedAt` / `pushError`; a failure
 *   never affects the inbox.
 *
 * The preference is one application-settings row per user
 * (`personnelSettings` id `imPush:<userId>`), since the notification plugin
 * has no user preferences; the inbox cannot be turned off.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { HrError } from '../shared.js';
import { APPROVAL_CARD } from './approval-card.js';
import { recordOnce, type Bindings, type ImCards } from './service.js';
import type { ImTransport } from './transport.js';
import type { ImProvider } from './types.js';

/** The office suites a user can be reached on. V2 adds dingtalk and wecom. */
export const PUSH_PROVIDERS: readonly ImProvider[] = ['feishu'];

const prefsSchema = z.object({ feishu: z.boolean() }).partial().strict();
export type PushPreferences = z.infer<typeof prefsSchema>;

export interface PushInput {
  readonly key: string;
  readonly message: string;
  readonly userIds: readonly string[];
  readonly title: string;
  /** Withheld (null) when the text may carry personal data. */
  readonly summary: string | null;
  readonly path?: string;
  /** The to-do the notifier wrote for each recipient, if any. */
  readonly workItem?: {
    readonly type: string;
    readonly refType: string;
    readonly refId: string;
  } | null;
}

/**
 * Extension point for later steps (V2-05 考勤与假期): a notification that
 * should reach the user as a card instead of a text (a pending leave or
 * attendance approval), and the business records whose sent cards it makes
 * stale. Routes are asked in the order they were added.
 */
export interface PushCardRoute {
  card?(
    input: PushInput,
    userId: string,
  ):
    | {
        readonly kind: string;
        readonly refType: string;
        readonly refId: string;
        readonly dedupeKey: string;
        readonly payload: unknown;
      }
    | undefined;
  refresh?(input: PushInput): readonly (readonly [string, string])[];
}

export function createImPush(deps: {
  readonly database: DatabaseManager;
  readonly transport: ImTransport;
  readonly cards: ImCards;
  readonly bindings: Bindings;
  readonly publicUrl: (path: string) => string;
  readonly warn: (detail: Record<string, unknown>, message: string) => void;
}) {
  const { database } = deps;
  const rowId = (userId: string) => `imPush:${userId}`.slice(0, 64);
  const routes: PushCardRoute[] = [];

  async function preferences(userId: string): Promise<PushPreferences> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', rowId(userId))
      .executeTakeFirst();
    let value: unknown = row?.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    const parsed = prefsSchema.safeParse(value ?? {});
    return parsed.success ? parsed.data : {};
  }

  async function mark(
    userId: string,
    item: NonNullable<PushInput['workItem']>,
    error: string | null,
  ): Promise<void> {
    await database
      .query()
      .updateTable('workItems')
      .set(
        error
          ? { pushError: error.slice(0, 255), updatedAt: new Date() }
          : { pushedAt: new Date(), pushError: null, updatedAt: new Date() },
      )
      .where('recipientUserId', '=', userId)
      .where('type', '=', item.type)
      .where('refType', '=', item.refType)
      .where('refId', '=', item.refId)
      .execute();
  }

  /** The channels a user may switch: only those they are bound to. The inbox is always on. */
  async function settingsFor(userId: string) {
    const prefs = await preferences(userId);
    const channels = [];
    for (const provider of PUSH_PROVIDERS)
      channels.push({
        provider,
        bound: Boolean(await deps.bindings.externalOf(provider, userId)),
        enabled: prefs[provider as keyof PushPreferences] !== false,
      });
    return { inbox: true as const, channels };
  }

  return {
    settingsFor,

    /** Adds a card route (see PushCardRoute). */
    addRoute(route: PushCardRoute): void {
      routes.push(route);
    },

    async updateSettings(userId: string, input: unknown) {
      const parsed = z
        .object({ channels: prefsSchema })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const value = { ...(await preferences(userId)), ...parsed.data.channels };
      const stamp = new Date();
      const id = rowId(userId);
      const existing = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['revision'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (existing)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value: value,
            revision: Number(existing.revision) + 1,
            updatedBy: userId,
            updatedAt: stamp,
          })
          .where('id', '=', id)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id,
            value: value,
            revision: 1,
            updatedBy: userId,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      return settingsFor(userId);
    },

    /** Pushes one notification to each bound recipient who has not turned the channel off. */
    async push(input: PushInput): Promise<void> {
      const approval =
        input.message === 'actionPending' && input.path
          ? /^action:([^:]+):level:(\d+)$/u.exec(input.key)
          : null;
      // Any news about a personnel action (next level, rejected, effective) refreshes its sent cards.
      const action = /^action:([^:]+):/u.exec(input.key);
      if (action) await deps.cards.refresh('personnelAction', action[1]);
      for (const route of routes)
        for (const [refType, refId] of route.refresh?.(input) ?? [])
          await deps.cards.refresh(refType, refId);
      for (const userId of new Set(input.userIds))
        for (const provider of PUSH_PROVIDERS) {
          const externalUserId = await deps.bindings.externalOf(
            provider,
            userId,
          );
          if (!externalUserId) continue;
          if (
            (await preferences(userId))[provider as keyof PushPreferences] ===
            false
          )
            continue;
          if (
            !(await recordOnce(
              database,
              `imPush:${provider}:${input.key}:${userId}`,
            ))
          )
            continue;
          let error: string | null = null;
          const routed = approval
            ? undefined
            : routes
                .map((route) => route.card?.(input, userId))
                .find((card) => card !== undefined);
          try {
            if (routed) {
              const sent = await deps.cards.send({
                ...routed,
                provider,
                recipientUserId: userId,
              });
              if (sent.status === 'failed') error = sent.error;
            } else if (approval) {
              const sent = await deps.cards.send({
                kind: APPROVAL_CARD,
                provider,
                recipientUserId: userId,
                refType: 'personnelAction',
                refId: approval[1],
                dedupeKey: `${APPROVAL_CARD}:${approval[1]}:${approval[2]}:${userId}`,
                payload: { actionId: approval[1], level: Number(approval[2]) },
              });
              if (sent.status === 'failed') error = sent.error;
            } else {
              const lines = [input.title];
              if (input.summary) lines.push(input.summary);
              if (input.path) lines.push(deps.publicUrl(input.path));
              await deps.transport.sendText(
                { provider, externalUserId },
                lines.join('\n'),
              );
            }
          } catch (cause) {
            // The provider's code and message (Feishu: `FEISHU_API_<code>: <msg>`), not a bare IM_SEND_FAILED.
            error = (
              cause instanceof HrError
                ? cause.code
                : `IM_SEND_FAILED: ${cause instanceof Error ? cause.message : String(cause)}`
            ).slice(0, 255);
            deps.warn(
              { error: cause, key: input.key },
              'HR office-suite push failed',
            );
          }
          if (input.workItem) await mark(userId, input.workItem, error);
        }
    },
  };
}

export type ImPush = ReturnType<typeof createImPush>;
