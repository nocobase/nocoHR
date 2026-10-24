import type { ApiClient } from '@nocobase/app-client';
import { NocoBaseAIService } from './nocobase-ai-service.js';
import type {
  AIService,
  CreateAIConversationOptions,
  UpdateToolCallDecisionOptions,
} from './types.js';

/** Application APIs own both new conversations and retained history. Disabled runtimes fail explicitly. */
export class RuntimeAIService implements AIService {
  private readonly application: NocoBaseAIService;
  private enabled?: Promise<boolean>;
  public constructor(private readonly client: ApiClient) {
    this.application = new NocoBaseAIService(client, (path) =>
      path
        .replace(/^aiEmployee\/conversations/u, 'assistantConversations')
        .replace(/^aiEmployees\/roster$/u, 'assistantEmployees')
        .replace(
          /^aiEmployees\/([^/]+)\/userPrompt$/u,
          'assistantEmployees/$1/userPrompt',
        )
        .replace(/^aiEmployee\/models$/u, 'assistantModels')
        .replace(/^aiEmployee\//u, 'unsupportedAssistant/')
        .replace(/^aiEmployees\//u, 'unsupportedAssistant/'),
    );
  }
  private isEnabled() {
    return (this.enabled ??= this.client
      .request<{ data: { enabled: boolean } }>({
        path: 'assistantRuntime',
        method: 'GET',
      })
      .then((value) => value.data.enabled));
  }
  private async service() {
    if (!(await this.isEnabled())) throw new Error('ASSISTANT_UNAVAILABLE');
    return this.application;
  }

  async listEmployees() {
    return (await this.service()).listEmployees();
  }
  async listModels() {
    return (await this.service()).listModels();
  }
  async listConversations(keyword?: string) {
    return (await this.service()).listConversations(keyword);
  }

  async getConversationMessages(
    id: string,
    options?: { updateRead?: boolean },
  ) {
    return (await this.service()).getConversationMessages(id, options);
  }
  async getConversationActiveState(id: string) {
    return (await this.service()).getConversationActiveState(id);
  }

  async updateConversationTitle(id: string, title: string) {
    return (await this.service()).updateConversationTitle(id, title);
  }
  async destroyConversation(id: string) {
    return (await this.service()).destroyConversation(id);
  }
  async createConversation(options: CreateAIConversationOptions) {
    return (await this.service()).createConversation(options);
  }
  async sendMessagesStream(body: unknown, signal?: AbortSignal) {
    this.sessionId(body);
    return (await this.service()).sendMessagesStream(body, signal);
  }
  async resumeToolCallStream(body: unknown, signal?: AbortSignal) {
    this.sessionId(body);
    return (await this.service()).resumeToolCallStream(body, signal);
  }
  async updateToolCallDecision(options: UpdateToolCallDecisionOptions) {
    return (await this.service()).updateToolCallDecision(options);
  }
  async resendMessagesStream(
    _body: unknown,
    _signal?: AbortSignal,
  ): Promise<never> {
    await this.service();
    throw new Error('UNSUPPORTED_CHAT_REQUEST');
  }
  async resumeConversationStream(
    _id: string,
    _signal?: AbortSignal,
  ): Promise<never> {
    await this.service();
    throw new Error('UNSUPPORTED_CHAT_REQUEST');
  }
  async uploadFile(_file: File, _signal?: AbortSignal): Promise<never> {
    await this.service();
    throw new Error('UNSUPPORTED_CHAT_REQUEST');
  }
  async updateEmployeeUserPrompt(username: string, prompt: string) {
    return (await this.service()).updateEmployeeUserPrompt(username, prompt);
  }
  private sessionId(body: unknown): string {
    if (
      !body ||
      typeof body !== 'object' ||
      !('sessionId' in body) ||
      typeof body.sessionId !== 'string' ||
      !body.sessionId
    )
      throw new Error('CONVERSATION_NOT_FOUND');
    return body.sessionId;
  }
}
