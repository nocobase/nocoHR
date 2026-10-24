import { randomUUID } from 'node:crypto';
import {
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';

const conversation = z.object({
  id: z.string(),
  userId: z.string(),
  employee: z.string(),
  title: z.string(),
  model: z.object({ model: z.string(), llmService: z.string().optional() }),
  mode: z.enum(['chat', 'structured']),
  state: z.enum([
    'idle',
    'running',
    'pending',
    'failed',
    'cancelled',
    'archived',
  ]),
  revision: z.number(),
  activeRequest: z.string().nullable(),
  pendingCallIds: z.array(z.string()),
  read: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Conversation = z.infer<typeof conversation>;

/** Every mutation is scoped to an authenticated owner. A lost running request is never reclaimed. */
export class ConversationStore {
  public constructor(private readonly db: DatabaseConnection) {}

  public async create(
    input: Pick<
      Conversation,
      'userId' | 'employee' | 'title' | 'model' | 'mode'
    >,
  ) {
    const stamp = new Date();
    const row: Conversation = {
      ...input,
      id: `assistant-${randomUUID()}`,
      state: 'idle',
      revision: 0,
      activeRequest: null,
      pendingCallIds: [],
      read: true,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.db
      .repository('assistantConversations')
      .createOne({ values: row });
    return row;
  }
  public async get(id: string, userId: string): Promise<Conversation> {
    const row = await this.db
      .repository('assistantConversations')
      .findOne({ filter: { id, userId } });
    if (!row) throw new Error('CONVERSATION_NOT_FOUND');
    return conversation.parse(row);
  }
  public async list(userId: string) {
    const rows = await this.db.repository('assistantConversations').findMany({
      filter: (f) =>
        f.and([
          f.string('userId').eq(userId),
          f.string('mode').eq('chat'),
          f.string('state').ne('archived'),
        ]),
      sort: (s) => [s.field('updatedAt').desc(), s.field('id').desc()],
      limit: 200,
    });
    return rows.map((row) => conversation.parse(row));
  }
  public async history(id: string): Promise<BaseMessage[]> {
    const rows = await this.db.repository('assistantMessages').findMany({
      filter: { sessionId: id },
      sort: (s) => s.field('sequence').asc(),
    });
    const messages = mapStoredMessagesToChatMessages(
      rows.map(
        (row) =>
          row.message as unknown as Parameters<
            typeof mapStoredMessagesToChatMessages
          >[0][number],
      ),
    );
    for (const [index, message] of messages.entries()) {
      const stamp = rows[index].createdAt;
      message.additional_kwargs.createdAt =
        stamp instanceof Date ? stamp.toISOString() : z.string().parse(stamp);
    }
    return messages;
  }
  public async append(
    id: string,
    requestId: string,
    message: BaseMessage,
  ): Promise<void> {
    const messageId = message.id ?? randomUUID();
    // Joining the ownership check and append prevents a late callback from writing after finalization.
    await this.db.transaction(async (tx) => {
      const owner = await tx.repository('assistantConversations').findOne({
        filter: { id, activeRequest: requestId, state: 'running' },
      });
      if (!owner) throw new Error('CHAT_REQUEST_CONFLICT');
      await tx.repository('assistantMessages').createOne({
        values: {
          id: messageId,
          sessionId: id,
          message: JSON.parse(
            JSON.stringify({
              ...message.toDict(),
              data: { ...message.toDict().data, id: messageId },
            }),
          ) as Record<string, unknown>,
          createdAt: new Date(),
        },
      });
    });
  }
  public async claim(row: Conversation): Promise<string> {
    const requestId = randomUUID();
    const update = await this.db
      .repository('assistantConversations')
      .updateMany({
        filter: {
          id: row.id,
          userId: row.userId,
          revision: row.revision,
          state: row.state,
          activeRequest: null,
        },
        values: {
          state: 'running',
          activeRequest: requestId,
          revision: row.revision + 1,
          updatedAt: new Date(),
        },
      });
    if (update.updatedCount !== 1) throw new Error('CHAT_REQUEST_CONFLICT');
    return requestId;
  }
  public async finish(
    row: Conversation,
    requestId: string,
    state: Conversation['state'],
    pendingCallIds: string[],
  ) {
    const update = await this.db
      .repository('assistantConversations')
      .updateMany({
        filter: {
          id: row.id,
          userId: row.userId,
          activeRequest: requestId,
          state: 'running',
        },
        values: {
          activeRequest: null,
          state,
          pendingCallIds,
          read: false,
          updatedAt: new Date(),
        },
      });
    if (update.updatedCount !== 1) throw new Error('CHAT_REQUEST_CONFLICT');
  }
  public async edit(
    row: Conversation,
    values: { title?: string; read?: boolean; state?: 'archived' },
  ) {
    const update = await this.db
      .repository('assistantConversations')
      .updateMany({
        filter: {
          id: row.id,
          userId: row.userId,
          revision: row.revision,
          activeRequest: null,
        },
        values: {
          ...values,
          revision: row.revision + 1,
          updatedAt: new Date(),
        },
      });
    if (update.updatedCount !== 1) throw new Error('CHAT_REQUEST_CONFLICT');
  }
}
