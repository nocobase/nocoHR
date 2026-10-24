import type {
  ServiceContainer,
  ServiceToken,
} from '@nocobase/service-provider';
import type { ZodType } from 'zod';

/** Stable declarations owned by the application, independent of its execution engine. */
export interface AIEmployeeOptions {
  username: string;
  nickname?: string;
  position?: string;
  avatar?: string;
  category?: string;
  description?: string;
  bio?: string;
  greeting?: string;
  systemPrompt?: string | null;
  sort?: number;
  skills?: string[];
  tools?: { name: string; autoCall?: boolean }[];
  modelSettings?: {
    enabled?: boolean;
    llmService?: string;
    model?: string;
    models?: { llmService?: string; model?: string }[];
  };
  chatSettings?: {
    systemPromptMode?: 'default' | 'raw' | 'none';
    enableTools?: boolean;
    enableSkills?: boolean;
    [key: string]: unknown;
  };
}

type Dependencies = Record<string, ServiceToken<unknown>>;
type Services<T extends Dependencies> = {
  [K in keyof T]: T[K] extends ServiceToken<infer S> ? S : never;
};

export interface ToolActor {
  id: string | number;
  roles: string[];
  isRoot: boolean;
  locale?: string;
}

export interface ToolContext<T extends Dependencies> {
  actor: ToolActor;
  deps: Services<T>;
}

export interface ToolOptions<T extends Dependencies, Args> {
  scope: 'SPECIFIED' | 'GENERAL' | 'CUSTOM';
  execution?: 'backend' | 'frontend';
  defaultPermission?: 'ASK' | 'ALLOW';
  i18n?: { namespace: string };
  introduction?: { title: string; about?: string };
  definition: { name: string; description: string; schema?: ZodType<Args> };
  dependencies?: T;
  invoke(context: ToolContext<T>, args: Args): Promise<unknown>;
}

export interface RegisteredTool {
  scope: 'SPECIFIED' | 'GENERAL' | 'CUSTOM';
  i18n?: { namespace: string };
  introduction?: { title: string; about?: string };
  definition: { name: string; description: string; schema?: ZodType };
  defaultPermission?: 'ASK' | 'ALLOW';
  execution?: 'backend' | 'frontend';
  execute(
    container: ServiceContainer,
    actor: ToolActor,
    input: unknown,
  ): Promise<unknown>;
}

export function defineAIEmployee(
  employee: AIEmployeeOptions,
): AIEmployeeOptions {
  return employee;
}

export function defineTools<
  T extends Dependencies = Record<string, never>,
  Args = unknown,
>(tool: ToolOptions<T, Args>): ToolOptions<T, Args> & RegisteredTool {
  return {
    ...tool,
    async execute(container, actor, input) {
      if (tool.execution === 'frontend')
        throw new Error('FRONTEND_TOOL_ON_SERVER');
      if (!tool.definition.schema) throw new Error('TOOL_SCHEMA_REQUIRED');
      const parsed = tool.definition.schema.safeParse(input);
      if (!parsed.success) throw new Error('INVALID_TOOL_INPUT');
      const deps = Object.fromEntries(
        Object.entries(tool.dependencies ?? {}).map(([key, token]) => [
          key,
          container.resolve(token),
        ]),
      ) as Services<T>;
      return tool.invoke({ actor, deps }, parsed.data);
    },
  };
}
