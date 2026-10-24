import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';
import type { AIEmployeeOptions, RegisteredTool } from '../../ai/contracts.js';
import { copyCapabilityRecord } from '../upgrade/ledger.js';
import { capabilityJsonValue } from '../upgrade/json-value.js';
import {
  legacySource,
  legacyId,
  legacyRow,
  list,
  record,
  fileReference,
  stamp,
  legacyJson,
  type AssistantFileReference,
} from './legacy-contract.js';
import { LegacyAssistantHistory } from './legacy-history.js';
import { preferenceId, employeeModelChoices } from './employee-settings.js';
import {
  legacyModelSettings,
  mappedModels,
  type AIConfiguration,
} from './model-configuration.js';
import type { AssistantModels } from './conversation-service.js';
import { toolArgumentDigest } from './tool-executor.js';

const hasValue = (value: unknown) =>
  value != null &&
  (typeof value !== 'object' ||
    (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0));
const emptyConfig = {
  enabled: false,
  llmService: '',
  model: '',
  apiKey: '',
  baseURL: '',
};

/** Explicit, bounded copy jobs. Never called by reads/boot; old writers must be stopped before final copy. */
export class LegacyAssistantMigration {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly employees: ReadonlyMap<string, AIEmployeeOptions>,
    private readonly tools: ReadonlyMap<string, RegisteredTool>,
    private readonly models: AssistantModels,
    private readonly ai: AIConfiguration,
    private readonly verifyFile: (
      file: AssistantFileReference,
    ) => Promise<boolean>,
    private readonly canReadAnyFile: (
      userId: string,
    ) => Promise<boolean> = async () => false,
  ) {}
  private async copy(
    tx: DatabaseConnection,
    table: string,
    key: string,
    target: string,
    id: string,
    source: unknown,
    values: Record<string, unknown>,
  ) {
    return copyCapabilityRecord(
      tx,
      {
        ...legacySource,
        sourceCollection: table,
        sourceKey: key,
        targetCollection: target,
        targetKey: id,
      },
      source,
      async (connection) => {
        await connection
          .repository(target)
          .createOne({ values: { id, ...values } });
      },
    );
  }
  private profile(row: Record<string, unknown>) {
    const known = new Set([
      'username',
      'nickname',
      'position',
      'avatar',
      'bio',
      'about',
      'description',
      'defaultPrompt',
      'greeting',
      'chatSettings',
      'skillSettings',
      'modelSettings',
      'dataSourceSettings',
      'enableKnowledgeBase',
      'knowledgeBasePrompt',
      'knowledgeBase',
      'enabled',
      'builtIn',
      'category',
      'deprecated',
      'sort',
      'createdAt',
      'updatedAt',
    ]);
    if (Object.keys(row).some((key) => !known.has(key)))
      throw new Error('UNMAPPED_LEGACY_FIELD');
    const username = z.string().min(1).parse(row.username);
    const base = this.employees.get(username);
    if (!base) throw new Error('EMPLOYEE_NOT_MAPPED');
    if (
      row.enableKnowledgeBase === true ||
      row.enableKnowledgeBase === 1 ||
      hasValue(row.knowledgeBase) ||
      hasValue(row.dataSourceSettings)
    )
      throw new Error('AI_CAPABILITY_NOT_MAPPED');
    const skills = row.skillSettings == null ? {} : record(row.skillSettings);
    if (
      list(skills.skills).length ||
      list(skills.enabledSkills).length ||
      hasValue(skills.mcpServers)
    )
      throw new Error('AI_CAPABILITY_NOT_MAPPED');
    if (
      Object.keys(skills).some(
        (key) =>
          !['tools', 'skills', 'enabledTools', 'enabledSkills'].includes(key),
      )
    )
      throw new Error('AI_CAPABILITY_NOT_MAPPED');
    const selections = list(skills.tools).map((value) =>
      z
        .object({ name: z.string(), autoCall: z.boolean().optional() })
        .parse(value),
    );
    const enabled =
      skills.enabledTools == null
        ? undefined
        : new Set(z.array(z.string()).parse(skills.enabledTools));
    // .30 discovers GENERAL tools plus explicit selections, then applies enabledTools.
    // An existing row with missing/empty selections never inherits code defaults.
    const names = new Set([
      ...[...this.tools]
        .filter(([, tool]) => tool.scope === 'GENERAL')
        .map(([name]) => name),
      ...selections.map((value) => value.name),
      ...(enabled ?? []),
    ]);
    const tools = [...names]
      .filter((name) => !enabled || enabled.has(name))
      .map((name) => {
        const tool = this.tools.get(name);
        if (!tool || tool.execution === 'frontend')
          throw new Error('TOOL_NOT_MAPPED');
        const preset = selections.find((value) => value.name === name);
        return {
          name,
          // Legacy presets override automatic policy only for CUSTOM tools.
          autoCall:
            tool.scope === 'CUSTOM' && preset
              ? preset.autoCall === true
              : tool.defaultPermission === 'ALLOW',
        };
      });
    const chatSettings =
      row.chatSettings == null
        ? (base.chatSettings ?? {})
        : record(row.chatSettings);
    if (
      Object.keys(chatSettings).some(
        (key) =>
          !['systemPromptMode', 'enableTools', 'enableSkills'].includes(key),
      ) ||
      chatSettings.enableSkills === true
    )
      throw new Error('AI_CAPABILITY_NOT_MAPPED');
    if (
      chatSettings.systemPromptMode != null &&
      !['default', 'raw', 'none'].includes(
        z.string().parse(chatSettings.systemPromptMode),
      )
    )
      throw new Error('AI_CAPABILITY_NOT_MAPPED');
    const modelSettings =
      row.modelSettings == null
        ? undefined
        : z
            .strictObject({
              enabled: z.boolean().optional(),
              llmService: z.string().optional(),
              model: z.string().optional(),
              models: z
                .array(
                  z.strictObject({
                    llmService: z.string().optional(),
                    model: z.string().optional(),
                  }),
                )
                .max(200)
                .optional(),
            })
            .parse(record(row.modelSettings));
    const profile: Record<string, unknown> = {
      ...base,
      tools,
      chatSettings,
      modelSettings,
      sourceProfile: legacyJson(row),
      enabled: row.enabled !== false && row.enabled !== 0,
    };
    for (const key of [
      'nickname',
      'position',
      'avatar',
      'description',
      'bio',
      'greeting',
      'category',
      'sort',
      'builtIn',
      'deprecated',
    ])
      if (row[key] != null) profile[key] = row[key];
    profile.systemPrompt =
      row.about ?? row.defaultPrompt ?? base.systemPrompt ?? '';
    return capabilityJsonValue(legacyJson(profile));
  }
  public async configuration() {
    if (!(await this.db.builder.hasCollection('aiEmployees')))
      return { copied: 0, unchanged: 0 };
    return this.db.transaction(async (tx) => {
      if (
        hasValue(this.ai.mcpServers) ||
        list(record(this.ai.skills ?? {}).paths).length ||
        list(record(this.ai.aiKnowledgeBase ?? {}).vectorDatabases).length ||
        list(record(this.ai.aiKnowledgeBase ?? {}).manifests).length
      )
        throw new Error('AI_CAPABILITY_NOT_MAPPED');
      if (
        (await tx.builder.hasCollection('aiMcpClients')) &&
        (await tx.query
          .selectFrom('aiMcpClients')
          .select('name')
          .limit(1)
          .executeTakeFirst())
      )
        throw new Error('AI_CAPABILITY_NOT_MAPPED');
      const employees = await Promise.all(
        (
          await tx.query
            .selectFrom('aiEmployees')
            .selectAll()
            .limit(201)
            .execute()
        ).map((row) => legacyRow(tx, 'aiEmployees', row)),
      );
      const services = await Promise.all(
        (
          await tx.query
            .selectFrom('llmServices')
            .selectAll()
            .limit(201)
            .execute()
        ).map((row) => legacyRow(tx, 'llmServices', row)),
      );
      const settings = await Promise.all(
        (
          await tx.query.selectFrom('aiSettings').selectAll().limit(2).execute()
        ).map((row) => legacyRow(tx, 'aiSettings', row)),
      );
      if (
        employees.length > 200 ||
        services.length > 200 ||
        settings.length > 1
      )
        throw new Error('LEGACY_CONFIGURATION_BATCH_LIMIT');
      const defaults = settings[0] ?? {};
      const modelRows = services.map(legacyModelSettings);
      mappedModels(emptyConfig, this.ai, modelRows); // Validates provider and server secret availability before any write.
      const result = { copied: 0, unchanged: 0 };
      const count = (status: 'copied' | 'unchanged') => {
        result[status]++;
      };
      for (const source of services) {
        const metadata = legacyModelSettings(source);
        count(
          await this.copy(
            tx,
            'llmServices',
            legacyId(source.name),
            'assistantModelServices',
            `service:${legacyId(source.name)}`,
            source,
            { settings: metadata },
          ),
        );
      }
      if (settings.length) {
        if (
          hasValue(defaults.options) &&
          Object.keys(record(defaults.options)).some((key) => key !== 'storage')
        )
          throw new Error('AI_CAPABILITY_NOT_MAPPED');
        count(
          await this.copy(
            tx,
            'aiSettings',
            defaults.id == null ? 'main' : legacyId(defaults.id),
            'assistantModelServices',
            '#defaults',
            defaults,
            {
              settings: {
                defaultLlmService: defaults.defaultLlmService ?? null,
                defaultModel: defaults.defaultModel ?? null,
                options:
                  defaults.options == null ? {} : record(defaults.options),
              },
            },
          ),
        );
      }
      for (const source of employees)
        count(
          await this.copy(
            tx,
            'aiEmployees',
            legacyId(source.username),
            'assistantEmployees',
            legacyId(source.username),
            source,
            { profile: this.profile(source) },
          ),
        );
      return result;
    });
  }
  public async preferences(userId: string) {
    if (!(await this.db.builder.hasCollection('usersAiEmployees')))
      return { copied: 0, unchanged: 0 };
    return this.db.transaction(async (tx) => {
      const preferences = await Promise.all(
        (
          await tx.query
            .selectFrom('usersAiEmployees')
            .selectAll()
            .where('userId', '=', userId)
            .limit(201)
            .execute()
        ).map((row) => legacyRow(tx, 'usersAiEmployees', row)),
      );
      if (preferences.length > 200)
        throw new Error('LEGACY_PREFERENCES_BATCH_LIMIT');
      const result = { copied: 0, unchanged: 0 };
      const count = (status: 'copied' | 'unchanged') => {
        result[status]++;
      };
      for (const source of preferences) {
        const employee = legacyId(source.aiEmployee),
          id = preferenceId(userId, employee);
        if (
          !this.employees.has(employee) ||
          !(await tx
            .repository('assistantEmployees')
            .findOne({ filter: { id: employee } }))
        )
          throw new Error('EMPLOYEE_NOT_MAPPED');
        count(
          await this.copy(
            tx,
            'usersAiEmployees',
            id,
            'assistantEmployeePreferences',
            id,
            source,
            {
              userId,
              employee,
              prompt: source.prompt ?? null,
              sort: source.sort ?? null,
            },
          ),
        );
      }
      return result;
    });
  }
  public async conversation(sessionId: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const source = await new LegacyAssistantHistory(tx).source(
        sessionId,
        userId,
        tx,
      );
      const { conversation, messages, calls } = source;
      const employee = String(conversation.aiEmployeeUsername);
      if (!this.employees.has(employee)) throw new Error('EMPLOYEE_NOT_MAPPED');
      if (conversation.llmActiveState !== 'idle')
        throw new Error('ACTIVE_AI_TURNS');
      if (
        conversation.category !== 'chat' ||
        conversation.from !== 'main-agent' ||
        hasValue(conversation.scope) ||
        hasValue(conversation.topicId)
      )
        throw new Error('AI_CAPABILITY_NOT_MAPPED');
      const options = record(conversation.options);
      if (Object.keys(options).some((key) => key !== 'modelSettings'))
        throw new Error('AI_CAPABILITY_NOT_MAPPED');
      const model = z
        .object({ llmService: z.string(), model: z.string() })
        .parse(options.modelSettings);
      this.models.create(model);
      const employeeRow = await tx.query
        .selectFrom('aiEmployees')
        .selectAll()
        .where('username', '=', employee)
        .executeTakeFirst();
      if (!employeeRow) throw new Error('EMPLOYEE_NOT_MAPPED');
      const profile = this.profile(
        await legacyRow(tx, 'aiEmployees', employeeRow),
      ) as unknown as AIEmployeeOptions;
      if (
        !employeeModelChoices(profile, this.models.list()).some(
          (choice) =>
            choice.llmService === model.llmService &&
            choice.model === model.model,
        )
      )
        throw new Error('EMPLOYEE_MODEL_NOT_MAPPED');
      const refs = new Map<string, Record<string, unknown>>();
      const mappedMessages: {
        source: Record<string, unknown>;
        message: BaseMessage;
      }[] = [];
      const mappedCalls: {
        source: Record<string, unknown>;
        values: Record<string, unknown>;
      }[] = [];
      const seenCalls = new Set<string>();
      for (const sourceMessage of messages) {
        const id = legacyId(sourceMessage.messageId),
          content = record(sourceMessage.content),
          metadata =
            sourceMessage.metadata == null
              ? {}
              : record(sourceMessage.metadata);
        if (content.type !== 'text' || typeof content.content !== 'string')
          throw new Error('UNMAPPED_MESSAGE_CONTENT');
        if (
          metadata.incomplete === true ||
          list(sourceMessage.workContext).length ||
          hasValue(content.subAgentConversations) ||
          hasValue(metadata.subAgentConversations)
        )
          throw new Error('AI_CAPABILITY_NOT_MAPPED');
        const attachments = [];
        for (const raw of list(sourceMessage.attachments)) {
          const attachment = record(raw),
            fileId = legacyId(attachment.id);
          const rawRow =
            refs.get(fileId) ??
            (await tx.query
              .selectFrom('aiFiles')
              .selectAll()
              .where('id', '=', fileId)
              .executeTakeFirst());
          const row =
            rawRow &&
            (refs.has(fileId)
              ? rawRow
              : await legacyRow(tx, 'aiFiles', rawRow));
          if (!row) throw new Error('MISSING_FILES');
          if (row.createdById == null) throw new Error('UNKNOWN_FILE_OWNER');
          if (
            legacyId(row.createdById) !== userId &&
            !(await this.canReadAnyFile(userId))
          )
            throw new Error('FILE_ACCESS_DENIED');
          const file = fileReference(row);
          if (!refs.has(fileId) && !(await this.verifyFile(file)))
            throw new Error('MISSING_FILES');
          refs.set(fileId, row);
          attachments.push({ ...attachment, ...file });
        }
        const kwargs = {
          legacy: capabilityJsonValue(legacyJson(sourceMessage)),
          attachments: capabilityJsonValue(attachments),
        };
        let message: BaseMessage;
        if (sourceMessage.role === 'user')
          message = new HumanMessage({
            id,
            content: content.content,
            additional_kwargs: kwargs,
          });
        else if (sourceMessage.role === 'tool') {
          const callId = z.string().min(1).parse(metadata.toolCallId);
          if (!seenCalls.has(callId)) throw new Error('UNMAPPED_TOOL_RESULT');
          message = new ToolMessage({
            id,
            tool_call_id: callId,
            content: content.content,
            additional_kwargs: kwargs,
          });
        } else if (
          sourceMessage.role === employee ||
          sourceMessage.role === 'assistant'
        ) {
          const requests = list(sourceMessage.toolCalls).map((value) =>
            z
              .object({
                id: z.string().min(1),
                name: z.string().min(1),
                args: z.record(z.string(), z.unknown()),
              })
              .parse(value),
          );
          for (const request of requests) {
            if (seenCalls.has(request.id))
              throw new Error('UNMAPPED_TOOL_RESULT');
            seenCalls.add(request.id);
            const tool = this.tools.get(request.name);
            const call = calls.find(
              (call) =>
                legacyId(call.messageId) === id &&
                call.toolCallId === request.id,
            );
            if (
              !call ||
              call.toolName !== request.name ||
              call.execution !== 'backend' ||
              !tool?.definition.schema?.safeParse(request.args).success ||
              !this.employees
                .get(employee)
                ?.tools?.some((tool) => tool.name === request.name)
            )
              throw new Error('TOOL_NOT_MAPPED');
            const status = String(call.invokeStatus);
            if (
              !['interrupted', 'waiting', 'init', 'done', 'confirmed'].includes(
                status,
              )
            )
              throw new Error('UNMAPPED_TOOL_STATE');
            if (
              ['interrupted', 'waiting', 'init'].includes(status) &&
              (call.invokeStartTime != null || call.invokeEndTime != null)
            )
              throw new Error('UNMAPPED_TOOL_STATE');
            const completed = status === 'done' || status === 'confirmed';
            const decision =
              call.userDecision == null ? {} : record(call.userDecision);
            if (!completed && decision.type === 'edit')
              throw new Error('UNMAPPED_TOOL_EDIT');
            const rejected =
              status === 'confirmed' &&
              decision.type === 'reject' &&
              messages.some(
                (message) =>
                  message.role === 'tool' &&
                  record(message.metadata).toolCallId === request.id,
              );
            if (
              completed &&
              !rejected &&
              !['success', 'error'].includes(String(call.status))
            )
              throw new Error('UNMAPPED_TOOL_STATE');
            const result = { status: call.status, content: call.content };
            mappedCalls.push({
              source: call,
              values: {
                id: `legacy-${legacyId(call.id)}`,
                userId,
                sessionId,
                employee,
                tool: request.name,
                messageId: id,
                modelCallId: request.id,
                arguments: capabilityJsonValue(request.args),
                argumentDigest: toolArgumentDigest(request.args),
                auto: completed ? Boolean(call.auto) : false,
                status: rejected
                  ? 'rejected'
                  : completed
                    ? 'completed'
                    : 'pending',
                result: completed ? capabilityJsonValue(result) : null,
                createdAt: new Date(stamp(call.createdAt)),
                updatedAt: new Date(stamp(call.updatedAt)),
              },
            });
          }
          message = new AIMessage({
            id,
            content: content.content,
            tool_calls: requests,
            additional_kwargs: kwargs,
          });
        } else throw new Error('UNMAPPED_MESSAGE_ROLE');
        mappedMessages.push({ source: sourceMessage, message });
      }
      if (mappedCalls.length !== calls.length)
        throw new Error('UNMAPPED_TOOL_RESULT');
      const pending = mappedCalls.filter(
        (call) => call.values.status === 'pending',
      );
      const lastAI = mappedMessages
        .slice()
        .reverse()
        .find((entry) => AIMessage.isInstance(entry.message));
      if (pending.some((call) => call.values.messageId !== lastAI?.message.id))
        throw new Error('UNMAPPED_TOOL_STATE');
      const pendingGroup =
        lastAI &&
        mappedCalls.filter(
          (call) => call.values.messageId === lastAI.message.id,
        );
      const tail = mappedMessages.at(-1)?.message;
      const waiting =
        pending.length > 0 ||
        (AIMessage.isInstance(tail) && (tail.tool_calls?.length ?? 0) > 0);
      if (waiting && !AIMessage.isInstance(tail))
        throw new Error('UNMAPPED_TOOL_STATE');
      const result = { copied: 0, unchanged: 0 };
      const count = (status: 'copied' | 'unchanged') => {
        result[status]++;
      };
      count(
        await this.copy(
          tx,
          'aiConversations',
          sessionId,
          'assistantConversations',
          sessionId,
          { ...source, files: [...refs.values()] },
          {
            userId,
            employee,
            title: z.string().parse(conversation.title ?? ''),
            model,
            mode: 'chat',
            state: waiting ? 'pending' : 'idle',
            revision: 0,
            activeRequest: null,
            pendingCallIds: waiting
              ? (pendingGroup ?? []).map((call) => String(call.values.id))
              : [],
            read: Boolean(conversation.read),
            createdAt: new Date(stamp(conversation.createdAt)),
            updatedAt: new Date(stamp(conversation.updatedAt)),
          },
        ),
      );
      for (const { source: row, message } of mappedMessages)
        count(
          await this.copy(
            tx,
            'aiMessages',
            legacyId(row.messageId),
            'assistantMessages',
            message.id!,
            row,
            {
              sessionId,
              message: capabilityJsonValue(legacyJson(message.toDict())),
              createdAt: new Date(stamp(row.createdAt)),
            },
          ),
        );
      for (const call of mappedCalls)
        count(
          await this.copy(
            tx,
            'aiToolMessages',
            legacyId(call.source.id),
            'assistantToolCalls',
            String(call.values.id),
            call.source,
            call.values,
          ),
        );
      for (const [id, row] of refs)
        count(
          await this.copy(tx, 'aiFiles', id, 'assistantFiles', id, row, {
            userId: legacyId(row.createdById),
            reference: fileReference(row),
          }),
        );
      return result;
    });
  }
}
