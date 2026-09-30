/**
 * How the office-suite bot reaches one user (V1-04). The notification plugin
 * only posts to group webhooks, so per-user messages and cards go through
 * the bot, behind this interface.
 *
 * No Feishu tenant is connected to this application, so the only transport
 * is the development mock: it keeps what would have been sent in memory for
 * 模拟渠道 (`/dev/im-mock`) to show. A production build has no transport
 * until a real one is written against the bot's credentials, which an
 * administrator configures by hand; every send then fails with
 * `IM_TRANSPORT_NOT_CONFIGURED`, which is recorded as the push error.
 */
import { HrError, newId } from '../shared.js';
import type { CardView, ImProvider } from './types.js';

export interface ImAddress {
  readonly provider: ImProvider;
  readonly externalUserId: string;
}

export interface ImTransport {
  /** `mock` in development and tests; `none` when nothing can deliver. */
  readonly name: 'mock' | 'none';
  sendText(to: ImAddress, text: string): Promise<void>;
  sendCard(to: ImAddress, cardId: string, view: CardView): Promise<void>;
  /** Replaces a sent card's content with its latest state. */
  updateCard(to: ImAddress, cardId: string, view: CardView): Promise<void>;
}

export interface MockOutboxEntry {
  readonly id: string;
  readonly provider: ImProvider;
  readonly externalUserId: string;
  readonly type: 'text' | 'card';
  readonly text: string | null;
  readonly cardId: string | null;
  readonly at: string;
}

const MOCK_LIMIT = 500;

export function createMockTransport(): ImTransport & {
  outbox(externalUserId?: string): MockOutboxEntry[];
} {
  const entries: MockOutboxEntry[] = [];
  const add = (entry: Omit<MockOutboxEntry, 'id' | 'at'>) => {
    entries.push({ ...entry, id: newId(), at: new Date().toISOString() });
    if (entries.length > MOCK_LIMIT)
      entries.splice(0, entries.length - MOCK_LIMIT);
  };
  return {
    name: 'mock',
    async sendText(to, text) {
      add({ ...to, type: 'text', text, cardId: null });
    },
    async sendCard(to, cardId) {
      // The mock page renders a card from its current state, so only the reference is kept.
      add({ ...to, type: 'card', text: null, cardId });
    },
    async updateCard() {
      // Nothing to do: the page reads the card's latest state when it shows it.
    },
    outbox(externalUserId) {
      return entries.filter(
        (e) => !externalUserId || e.externalUserId === externalUserId,
      );
    },
  };
}

export function createUnconfiguredTransport(): ImTransport {
  const fail = () =>
    Promise.reject(new HrError('IM_TRANSPORT_NOT_CONFIGURED', 409));
  return {
    name: 'none',
    sendText: fail,
    sendCard: fail,
    updateCard: fail,
  };
}
