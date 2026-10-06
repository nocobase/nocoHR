/**
 * The card registry and store (V1-04 飞书卡片). See `types.ts` for the
 * registration API. Cards are sent to one bound user through the transport;
 * a button press arrives as a signed callback naming only the card id and
 * the button, so what a card acts on is what the server stored when it sent
 * it, never what the callback says.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';

import { scopeForUser } from '../authorize.js';
import { HrError, newId, str } from '../shared.js';
import type { ImTransport } from './transport.js';
import type {
  CardKindDefinition,
  CardView,
  ImProvider,
  StoredCard,
  Translate,
} from './types.js';

/** The same employees.externalUserId binding the bot uses for messages (V1-03). */
export function createBindings(database: DatabaseManager) {
  return {
    /** The NocoHR user behind an office-suite member, or undefined when unbound, without an account, or left. */
    async userOf(
      provider: ImProvider,
      externalUserId: string,
    ): Promise<string | undefined> {
      if (!externalUserId) return undefined;
      const employee = await database
        .query()
        .selectFrom('employees')
        .select(['userId', 'status'])
        .where('externalProvider', '=', provider)
        .where('externalUserId', '=', externalUserId)
        .executeTakeFirst();
      if (!employee?.userId || employee.status === 'leave') return undefined;
      return str(employee.userId);
    },
    /** The office-suite member a NocoHR user is bound to, if any. */
    async externalOf(
      provider: ImProvider,
      userId: string,
    ): Promise<string | undefined> {
      const employee = await database
        .query()
        .selectFrom('employees')
        .select(['externalUserId', 'status'])
        .where('externalProvider', '=', provider)
        .where('userId', '=', userId)
        .where('externalUserId', 'is not', null)
        .executeTakeFirst();
      if (!employee?.externalUserId || employee.status === 'leave')
        return undefined;
      return str(employee.externalUserId);
    },
  };
}
export type Bindings = ReturnType<typeof createBindings>;

/** Records a key once in hrReminderLog; false when it was already there. */
export async function recordOnce(
  database: DatabaseManager,
  key: string,
): Promise<boolean> {
  const stamp = new Date();
  try {
    await database
      .query()
      .insertInto('hrReminderLog')
      .values({
        id: newId(),
        reminderKey: key.slice(0, 255),
        sentAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    return true;
  } catch {
    return false;
  }
}

export interface CardCallback {
  readonly provider: ImProvider;
  /** The provider's id for this callback; a replay is ignored. */
  readonly callbackId: string;
  /** Who pressed the button, as the provider identifies them. */
  readonly operatorId: string;
  readonly cardId: string;
  readonly button: string;
  readonly comment: string | null;
}

export interface CardCallbackResult {
  /** false when nothing ran: unknown operator or card, not the recipient, already handled, refused. */
  readonly ok: boolean;
  readonly code:
    | 'done'
    | 'duplicate'
    | 'unidentified'
    | 'notFound'
    | 'notRecipient'
    | 'alreadyHandled'
    | 'kept'
    | 'refused';
  readonly message: string;
  /** The card's latest state; null when the operator may not see it. */
  readonly card: CardView | null;
}

export function createImCards(deps: {
  readonly database: DatabaseManager;
  readonly authz: AppAuthorization;
  readonly transport: ImTransport;
  readonly translate: () => Promise<Translate>;
  /** Send failures are logged with the provider's own code and message. */
  readonly warn?: (detail: Record<string, unknown>, message: string) => void;
}) {
  const { database } = deps;

  /**
   * What a failed send stores and logs: an HrError's code, else the provider's
   * error (the Feishu client words it `FEISHU_API_<code>: <msg>`, without
   * tokens), so 发送失败 can be traced to its cause, such as a recipient
   * outside the app's availability range.
   */
  function sendFailure(error: unknown, cardId: string): string {
    const detail =
      error instanceof HrError
        ? error.code
        : `IM_SEND_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    deps.warn?.({ cardId, error: detail }, 'Office-suite card send failed');
    return detail.slice(0, 255);
  }
  const bindings = createBindings(database);
  const kinds = new Map<string, CardKindDefinition<unknown>>();

  function toCard(row: Record<string, unknown>): StoredCard {
    const date = (value: unknown) =>
      value ? new Date(value as string).toISOString() : null;
    return {
      id: str(row.id),
      provider: str(row.provider) as ImProvider,
      kind: str(row.kind),
      recipientUserId: str(row.recipientUserId),
      externalUserId: str(row.externalUserId),
      refType: str(row.refType),
      refId: str(row.refId),
      status: str(row.status) as StoredCard['status'],
      resultText: row.resultText ? str(row.resultText) : null,
      handledAt: date(row.handledAt),
      createdAt: date(row.createdAt) ?? '',
    };
  }

  function decode(value: unknown): unknown {
    let decoded = value;
    for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
      decoded = JSON.parse(decoded);
    return decoded;
  }

  async function load(id: string) {
    const row = await database
      .query()
      .selectFrom('imCards')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  async function renderRow(row: Record<string, unknown>): Promise<CardView> {
    const card = toCard(row);
    const t = await deps.translate();
    const kind = kinds.get(card.kind);
    const payload = kind?.payload.safeParse(decode(row.payload));
    if (!kind || !payload?.success)
      return {
        title: t('imCards.unknown.title'),
        lines: [],
        buttons: [],
        state: 'handled',
        stateText: t('imCards.state.unavailable'),
      };
    const actor = {
      userId: card.recipientUserId,
      authz: await scopeForUser(deps.authz, card.recipientUserId),
    };
    const view = await kind.render({ card, payload: payload.data, actor, t });
    // A closed card never offers buttons, whatever the kind says.
    if (card.status === 'open') return view;
    return {
      ...view,
      buttons: [],
      state: view.state === 'open' ? card.status : view.state,
      stateText:
        view.stateText ?? card.resultText ?? t('imCards.state.handled'),
    };
  }

  async function update(
    id: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await database
      .query()
      .updateTable('imCards')
      .set({ ...values, updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async function pushUpdate(row: Record<string, unknown>): Promise<void> {
    try {
      await deps.transport.updateCard(
        {
          provider: str(row.provider) as ImProvider,
          externalUserId: str(row.externalUserId),
        },
        str(row.id),
        await renderRow(row),
      );
    } catch (error) {
      // The card shows its latest state the next time it is opened or pressed; the reason is logged.
      sendFailure(error, str(row.id));
    }
  }

  async function refresh(refType: string, refId: string): Promise<void> {
    const rows = await database
      .query()
      .selectFrom('imCards')
      .selectAll()
      .where('refType', '=', refType)
      .where('refId', '=', refId)
      .execute();
    for (const row of rows) await pushUpdate(row);
  }

  return {
    bindings,
    /** The server-locale strings cards use, for callers that word a reply around a card. */
    translate: deps.translate,

    /** Adds a card kind; a second registration of the same kind is a programming error. */
    register<P>(definition: CardKindDefinition<P>): void {
      if (kinds.has(definition.kind))
        throw new Error(`Card kind already registered: ${definition.kind}`);
      kinds.set(definition.kind, definition);
    },

    has(kind: string): boolean {
      return kinds.has(kind);
    },

    /**
     * Sends a card to a bound user. Answers `notBound` without sending when
     * the user has no office-suite binding, and the existing card when the
     * dedupe key was sent before (nothing is sent again).
     */
    async send(input: {
      readonly kind: string;
      readonly recipientUserId: string;
      readonly refType: string;
      readonly refId: string;
      readonly dedupeKey: string;
      readonly payload: unknown;
      readonly provider?: ImProvider;
    }): Promise<
      | { status: 'sent' | 'duplicate'; cardId: string }
      | { status: 'notBound' }
      | { status: 'failed'; cardId: string; error: string }
    > {
      const kind = kinds.get(input.kind);
      if (!kind) throw new Error(`Unknown card kind: ${input.kind}`);
      const payload = kind.payload.parse(input.payload);
      const provider = input.provider ?? 'feishu';
      const externalUserId = await bindings.externalOf(
        provider,
        input.recipientUserId,
      );
      if (!externalUserId) return { status: 'notBound' };
      const existing = await database
        .query()
        .selectFrom('imCards')
        .select(['id'])
        .where('dedupeKey', '=', input.dedupeKey.slice(0, 255))
        .executeTakeFirst();
      if (existing) return { status: 'duplicate', cardId: str(existing.id) };
      const id = newId();
      const stamp = new Date();
      try {
        await database
          .query()
          .insertInto('imCards')
          .values({
            id,
            provider,
            kind: input.kind,
            recipientUserId: input.recipientUserId,
            externalUserId,
            refType: input.refType,
            refId: input.refId,
            dedupeKey: input.dedupeKey.slice(0, 255),
            // An object: the query builder encodes JSON columns itself.
            payload: payload as never,
            status: 'open',
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      } catch {
        // A concurrent send of the same key won the insert.
        const again = await database
          .query()
          .selectFrom('imCards')
          .select(['id'])
          .where('dedupeKey', '=', input.dedupeKey.slice(0, 255))
          .executeTakeFirst();
        if (again) return { status: 'duplicate', cardId: str(again.id) };
        throw new Error('Card could not be stored');
      }
      const row = (await load(id))!;
      try {
        await deps.transport.sendCard(
          { provider, externalUserId },
          id,
          await renderRow(row),
        );
        return { status: 'sent', cardId: id };
      } catch (error) {
        const code = sendFailure(error, id);
        await update(id, { sendError: code });
        return { status: 'failed', cardId: id, error: code };
      }
    },

    /** Open cards whose send failed, newest first: 设置 · 组织同步 lists them for a resend. */
    async failed(limit = 50) {
      const rows = await database
        .query()
        .selectFrom('imCards')
        .selectAll()
        .where('status', '=', 'open')
        .where('sendError', 'is not', null)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .execute();
      return Promise.all(
        rows.map(async (row) => {
          const card = toCard(row);
          return {
            id: card.id,
            kind: card.kind,
            title: (await renderRow(row)).title,
            recipientUserId: card.recipientUserId,
            error: str(row.sendError),
            createdAt: card.createdAt,
          };
        }),
      );
    },

    /** Sends an open card again, after the cause (such as the availability range) was fixed. */
    async resend(
      cardId: string,
    ): Promise<{ status: 'sent' | 'failed'; error?: string }> {
      const row = await load(cardId);
      if (!row) throw new HrError('NOT_FOUND', 404);
      if (row.status !== 'open' || !row.sendError)
        throw new HrError('IM_CARD_NOT_RESENDABLE', 409);
      try {
        await deps.transport.sendCard(
          {
            provider: str(row.provider) as ImProvider,
            externalUserId: str(row.externalUserId),
          },
          cardId,
          await renderRow(row),
        );
        await update(cardId, { sendError: null });
        return { status: 'sent' };
      } catch (error) {
        const code = sendFailure(error, cardId);
        await update(cardId, { sendError: code });
        return { status: 'failed', error: code };
      }
    },

    /** A card's latest state. */
    async view(cardId: string): Promise<CardView | undefined> {
      const row = await load(cardId);
      return row ? renderRow(row) : undefined;
    },

    /** Cards sent to one office-suite member, newest first, for the mock channel. */
    async listFor(provider: ImProvider, externalUserId: string, limit = 50) {
      const rows = await database
        .query()
        .selectFrom('imCards')
        .selectAll()
        .where('provider', '=', provider)
        .where('externalUserId', '=', externalUserId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .execute();
      return Promise.all(
        rows.map(async (row) => ({
          id: str(row.id),
          kind: str(row.kind),
          createdAt: toCard(row).createdAt,
          view: await renderRow(row),
        })),
      );
    },

    /** Re-renders the sent cards about one business record after it changed elsewhere. */
    refresh,

    /**
     * A button press. The route has already checked the signature; here the
     * operator is identified by binding and must be the card's recipient.
     * Nothing runs for an unidentified operator, another user's card, a
     * replayed callback or a card that is no longer open.
     */
    async handleCallback(input: CardCallback): Promise<CardCallbackResult> {
      const t = await deps.translate();
      if (
        !(await recordOnce(
          database,
          `imCard:${input.provider}:${input.callbackId}`,
        ))
      )
        return {
          ok: false,
          code: 'duplicate',
          message: t('imCards.result.duplicate'),
          card: null,
        };
      const operator = await bindings.userOf(input.provider, input.operatorId);
      if (!operator)
        return {
          ok: false,
          code: 'unidentified',
          message: t('imBot.unbound'),
          card: null,
        };
      const row = await load(input.cardId);
      if (!row || str(row.provider) !== input.provider)
        return {
          ok: false,
          code: 'notFound',
          message: t('imCards.result.notFound'),
          card: null,
        };
      const card = toCard(row);
      if (card.recipientUserId !== operator)
        return {
          ok: false,
          code: 'notRecipient',
          message: t('imCards.result.notRecipient'),
          card: null,
        };
      if (card.status !== 'open')
        return {
          ok: false,
          code: 'alreadyHandled',
          message: t('imCards.result.alreadyHandled'),
          card: await renderRow(row),
        };
      const kind = kinds.get(card.kind);
      const payload = kind?.payload.safeParse(decode(row.payload));
      if (!kind || !payload?.success)
        return {
          ok: false,
          code: 'notFound',
          message: t('imCards.result.notFound'),
          card: null,
        };
      const actor = {
        userId: operator,
        authz: await scopeForUser(deps.authz, operator),
      };
      const result = await kind.act({
        card,
        payload: payload.data,
        actor,
        button: input.button,
        comment: input.comment?.trim() || null,
        t,
      });
      const closes =
        result.outcome === 'handled' || result.outcome === 'discarded';
      if (closes || result.payload !== undefined)
        await update(card.id, {
          ...(closes
            ? {
                status: result.outcome,
                resultText: result.message.slice(0, 500),
                handledAt: new Date(),
              }
            : {}),
          ...(result.payload !== undefined ? { payload: result.payload } : {}),
        });
      const fresh = (await load(card.id))!;
      // The other recipients' cards about the same record show the new state too.
      if (closes) await refresh(card.refType, card.refId);
      return {
        ok: closes,
        code: closes ? 'done' : result.outcome === 'kept' ? 'kept' : 'refused',
        message: result.message,
        card: await renderRow(fresh),
      };
    },
  };
}

export type ImCards = ReturnType<typeof createImCards>;
