import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';
import type { Conversation } from './conversation-store.js';
import {
  fileReference,
  legacyId,
  legacyRow,
  list,
  record,
  stamp,
  type AssistantFileReference,
} from './legacy-contract.js';

/** Reads retained tables directly; it has no dependency on the retired runtime, routes or checkpoint format. */
export class LegacyAssistantHistory {
  private exists?: Promise<boolean>;
  private filesExist?: Promise<boolean>;
  public constructor(private readonly db: DatabaseConnection) {}
  public available() {
    return (this.exists ??= this.db.builder.hasCollection('aiConversations'));
  }
  public async get(
    id: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    if (!(await this.available())) throw new Error('CONVERSATION_NOT_FOUND');
    const row = await this.db.query
      .selectFrom('aiConversations')
      .selectAll()
      .where('sessionId', '=', id)
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (!row) throw new Error('CONVERSATION_NOT_FOUND');
    return legacyRow(this.db, 'aiConversations', row);
  }
  public wire(row: Record<string, unknown>): Conversation {
    const options = row.options == null ? {} : record(row.options);
    const model =
      options.modelSettings == null ? {} : record(options.modelSettings);
    return {
      id: legacyId(row.sessionId),
      userId: legacyId(row.userId),
      employee: z.string().parse(row.aiEmployeeUsername ?? ''),
      title: z.string().parse(row.title ?? ''),
      model: {
        model: z.string().parse(model.model ?? ''),
        llmService: z.string().parse(model.llmService ?? ''),
      },
      mode: 'chat',
      // A retained source is read-only until explicitly copied. This is not a claim that its old execution completed.
      state: 'archived',
      revision: 0,
      activeRequest: null,
      pendingCallIds: [],
      read: Boolean(row.read),
      createdAt: new Date(stamp(row.createdAt)),
      updatedAt: new Date(stamp(row.updatedAt)),
    };
  }
  public async list(userId: string): Promise<Conversation[]> {
    if (!(await this.available())) return [];
    const q = this.db.query;
    // This anti-join is a result set: copied/archived targets must not reappear as legacy conversations.
    const rows = await q
      .selectFrom('aiConversations as source')
      .leftJoin(
        'assistantConversations as target',
        'target.id',
        'source.sessionId',
      )
      .selectAll('source')
      .where('source.userId', '=', userId)
      .where('target.id', 'is', null)
      .where('source.category', '=', 'chat')
      .orderBy('source.updatedAt', 'desc')
      .limit(200)
      .execute();
    return Promise.all(
      rows.map(async (row) =>
        this.wire(await legacyRow(this.db, 'aiConversations', row)),
      ),
    );
  }
  public async source(id: string, userId: string, connection = this.db) {
    const conversation = await connection.query
      .selectFrom('aiConversations')
      .selectAll()
      .where('sessionId', '=', id)
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    const messages = await connection.query
      .selectFrom('aiMessages')
      .selectAll()
      .where('sessionId', '=', id)
      .orderBy('messageId', 'asc')
      .limit(1001)
      .execute();
    const calls = await connection.query
      .selectFrom('aiToolMessages')
      .selectAll()
      .where('sessionId', '=', id)
      .limit(1001)
      .execute();
    if (messages.length > 1000 || calls.length > 1000)
      throw new Error('LEGACY_CONVERSATION_BATCH_LIMIT');
    return {
      conversation: await legacyRow(
        connection,
        'aiConversations',
        conversation,
      ),
      messages: await Promise.all(
        messages.map((row) => legacyRow(connection, 'aiMessages', row)),
      ),
      calls: await Promise.all(
        calls.map((row) => legacyRow(connection, 'aiToolMessages', row)),
      ),
    };
  }
  public async history(
    id: string,
    userId: string,
    canReadAny: () => Promise<boolean> = async () => false,
  ) {
    if (!(await this.available())) throw new Error('CONVERSATION_NOT_FOUND');
    const { conversation, messages, calls } = await this.source(id, userId);
    const result = [];
    for (const message of messages) {
      const content = record(message.content);
      if (content.type !== 'text' || typeof content.content !== 'string')
        throw new Error('UNMAPPED_MESSAGE_CONTENT');
      const attachments = [];
      for (const attachment of list(message.attachments)) {
        const reference = record(attachment);
        const file = await this.file(
          legacyId(reference.id),
          userId,
          canReadAny,
        );
        attachments.push({ ...reference, ...this.attachment(file) });
      }
      const toolCalls = list(message.toolCalls).map((value) => {
        const request = record(value);
        const saved = calls.find(
          (call) =>
            legacyId(call.messageId) === legacyId(message.messageId) &&
            call.toolCallId === request.id,
        );
        return {
          ...request,
          ...(saved
            ? {
                invokeStatus: saved.invokeStatus,
                status: saved.status,
                content: saved.content,
                auto: saved.auto,
                execution: saved.execution,
              }
            : {}),
        };
      });
      result.push({
        key: legacyId(message.messageId),
        role: message.role,
        createdAt: stamp(message.createdAt),
        content: {
          ...content,
          messageId: legacyId(message.messageId),
          tool_calls: toolCalls,
          attachments,
          workContext: list(message.workContext),
        },
      });
    }
    return { conversation, rows: result.reverse() };
  }
  public attachment(file: AssistantFileReference) {
    const url = `api/assistantFiles/${encodeURIComponent(file.id)}/preview`;
    return {
      id: file.id,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      url,
      preview: url,
    };
  }
  public async file(
    id: string,
    userId: string,
    canReadAny: () => Promise<boolean> = async () => false,
  ): Promise<AssistantFileReference> {
    const copied = await this.db
      .repository('assistantFiles')
      .findOne({ filter: { id } });
    const source =
      copied ||
      !(await (this.filesExist ??= this.db.builder.hasCollection('aiFiles')))
        ? undefined
        : await this.db.query
            .selectFrom('aiFiles')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
    const owner = copied?.userId ?? source?.createdById;
    if ((owner == null || legacyId(owner) !== userId) && !(await canReadAny()))
      throw new Error('FILE_ACCESS_DENIED');
    if (!copied && !source) throw new Error('FILE_NOT_FOUND');
    return copied
      ? fileReference(record(copied.reference))
      : fileReference(await legacyRow(this.db, 'aiFiles', source!));
  }
}
