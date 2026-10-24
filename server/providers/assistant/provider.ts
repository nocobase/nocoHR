import { Readable } from 'node:stream';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { AssistantEmployeeSettings } from './employee-settings.js';
import { LegacyAssistantHistory } from './legacy-history.js';
import {
  mappedModels,
  type AIConfiguration,
  type ModelSettings,
} from './model-configuration.js';
import { record } from './legacy-contract.js';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import AppAIResources from '../../ai/index.js';
import type { AIEmployeeOptions, RegisteredTool } from '../../ai/contracts.js';
import type { AssistantConfig } from '../../config/assistant.js';
import { scopeForUser } from '../hr/authorize.js';
import { AssistantConversations } from './conversation-service.js';
import { ConversationStore } from './conversation-store.js';
import { assistantModels } from './configured-models.js';
import type { AssistantModels } from './conversation-service.js';
import { DatabaseToolCallStore } from './tool-call-store.js';
import { assistantConversationsToken } from './tokens.js';

export default class AssistantProvider extends ServiceProvider<Application> {
  public readonly name = 'app/assistant';
  private readonly employees = new Map<string, AIEmployeeOptions>();
  private readonly tools = new Map<string, RegisteredTool>();
  private configuredModels?: AssistantModels;
  private settings?: AssistantEmployeeSettings;
  public override register() {
    const config = this.app.config.get<AssistantConfig>('assistant');
    if (!config?.enabled) return;
    const container = this.app.container;
    const db = container.resolve(databaseManagerToken).connection();
    this.settings = new AssistantEmployeeSettings(db, this.employees);
    this.configuredModels = assistantModels(config);
    const entry = async (actor: { id: string | number }) => {
      // Resolve subjects again for every operation, including decisions from an already open page.
      const authz = await scopeForUser(
        container.resolve(authorizationToken),
        String(actor.id),
      );
      const decision = await authz.authorize({
        resource: { type: 'composite', id: 'talent.aiAssistant' },
        action: 'use',
      });
      const effect = String(decision.effect);
      if (effect !== 'allow' && effect !== 'permit')
        throw new Error('ASSISTANT_FORBIDDEN');
    };
    container.singleton(
      assistantConversationsToken,
      () =>
        new AssistantConversations(
          container,
          new ConversationStore(db),
          new DatabaseToolCallStore(db),
          this.employees,
          this.tools,
          {
            authorizeConversation: entry,
            authorize: async (actor, employee, _session, tool) => {
              await entry(actor);
              const profile = await this.settings!.profile(employee);
              if (
                !profile.enabled ||
                profile.chatSettings?.enableTools === false ||
                !profile.tools?.some((reference) => reference.name === tool)
              )
                throw new Error('TOOL_NOT_AVAILABLE');
            },
            decision: async (_actor, employee, tool) => {
              const profile = await this.settings!.profile(employee);
              const reference = profile.tools?.find(
                (item) => item.name === tool,
              );
              return reference?.autoCall !== false &&
                this.tools.get(tool)?.defaultPermission === 'ALLOW'
                ? 'allow'
                : 'ask';
            },
          },
          {
            list: () => this.configuredModels!.list(),
            create: (selected, schema) =>
              this.configuredModels!.create(selected, schema),
          },
          {
            history: new LegacyAssistantHistory(db),
            employees: this.settings!,
            openFile: async (file) =>
              Readable.toWeb(
                await container
                  .resolve(driveManagerToken)
                  .use(file.disk)
                  .getStream(file.path),
              ) as ReadableStream<Uint8Array>,
            canReadAnyFile: async (actor) => {
              const effect = String(
                (
                  await (
                    await scopeForUser(
                      container.resolve(authorizationToken),
                      String(actor.id),
                    )
                  ).authorize({
                    resource: { type: 'page', id: 'ai.settings' },
                    action: 'access',
                  })
                ).effect,
              );
              return effect === 'allow' || effect === 'permit';
            },
          },
        ),
    );
    // Application declarations bound automatic calls. Business services recheck their action and row policies as this user. Installed overrides remain a cutover inventory requirement.
  }
  public override async boot() {
    if (!this.app.config.get<AssistantConfig>('assistant')?.enabled) return;
    const db = this.app.container.resolve(databaseManagerToken).connection();
    const copied = await db
      .repository('assistantModelServices')
      .findMany({ filter: (f) => f.string('id').ne('#defaults'), limit: 201 });
    if (copied.length > 200)
      throw new Error('LEGACY_CONFIGURATION_BATCH_LIMIT');
    this.configuredModels = mappedModels(
      this.app.config.get<AssistantConfig>('assistant')!,
      this.app.config.get<AIConfiguration>('ai') ?? { llmServices: {} },
      copied.map((row) => record(row.settings) as unknown as ModelSettings),
      true,
    );
    const resources = await new AppAIResources().collect();
    for (const [name, employee] of resources.employees)
      this.employees.set(name, employee);
    for (const [name, tool] of resources.tools) this.tools.set(name, tool);
  }
}
