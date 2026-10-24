import { z } from 'zod';
import type { AssistantConfig } from '../../config/assistant.js';
import type { AssistantModels } from './conversation-service.js';
import { assistantModels } from './configured-models.js';
import { record } from './legacy-contract.js';

export interface AIServiceConfiguration {
  provider: string;
  title?: string;
  options?: { apiKey?: string; baseURL?: string };
  enabled?: boolean;
  sort?: number;
  enabledModels?: { label: string; value: string }[];
  overrideEnabledModels?: boolean;
  modelOptions?: Record<string, unknown>;
}
export interface AIConfiguration {
  llmServices: Readonly<Record<string, AIServiceConfiguration>>;
  [key: string]: unknown;
}
const optionsSchema = z.strictObject({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
});
const modelOptionsSchema = z.strictObject({
  temperature: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
});
const modelsSchema = z
  .array(z.strictObject({ label: z.string(), value: z.string().min(1) }))
  .max(200);

/** Produces non-secret metadata. Old DB keys are never copied into the new store. */
export function legacyModelSettings(row: Record<string, unknown>) {
  const options = z
    .strictObject({
      apiKey: z.unknown().optional(),
      baseURL: z.string().optional(),
    })
    .parse(row.options == null ? {} : record(row.options));
  const enabled = record(row.enabledModels);
  if (
    !['provider', 'custom'].includes(String(enabled.mode)) ||
    !Array.isArray(enabled.models)
  )
    throw new Error('UNMAPPED_MODEL_SELECTION');
  if (row.provider !== 'openai-completions')
    throw new Error('PROVIDER_NOT_MAPPED');
  return {
    name: z.string().min(1).parse(row.name),
    title: row.title == null ? String(row.name) : z.string().parse(row.title),
    sort: row.sort == null ? 0 : z.number().int().parse(row.sort),
    selectionMode: String(enabled.mode),
    provider: 'openai-completions' as const,
    enabled: row.enabled !== false && row.enabled !== 0,
    enabledModels: modelsSchema.parse(enabled.models),
    modelOptions: modelOptionsSchema.parse(
      row.modelOptions == null ? {} : record(row.modelOptions),
    ),
    // The endpoint stays server-side; credentials must be supplied through server configuration.
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  };
}
export type ModelSettings = ReturnType<typeof legacyModelSettings>;

/** Exact provider matching: the legacy `openai` name uses Responses, not completions. */
export function mappedModels(
  config: AssistantConfig,
  ai: AIConfiguration,
  rows: readonly ModelSettings[],
  allowUnavailable = false,
): AssistantModels {
  const unavailable = new Map<string, string>();
  const entries: {
    name: string;
    title: string;
    model: string;
    label: string;
    apiKey: string;
    baseURL: string;
    options: z.infer<typeof modelOptionsSchema>;
  }[] = [];
  const names = new Set([
    ...Object.keys(ai.llmServices),
    ...rows.map((row) => row.name),
  ]);
  const orderedNames = [...names].sort(
    (a, b) =>
      (ai.llmServices[a]?.sort ??
        rows.find((row) => row.name === a)?.sort ??
        0) -
        (ai.llmServices[b]?.sort ??
          rows.find((row) => row.name === b)?.sort ??
          0) || a.localeCompare(b),
  );
  for (const name of orderedNames) {
    const server = ai.llmServices[name];
    const row = rows.find((row) => row.name === name);
    const provider = server?.provider ?? row?.provider;
    if (provider !== 'openai-completions') {
      if (!allowUnavailable) throw new Error('PROVIDER_NOT_MAPPED');
      unavailable.set(name, 'PROVIDER_NOT_MAPPED');
      continue;
    }
    const secret = optionsSchema.parse(server?.options ?? {});
    const enabled = row?.enabled ?? server?.enabled ?? true;
    const models =
      server?.overrideEnabledModels === true
        ? (server.enabledModels ?? [])
        : (row?.enabledModels ?? server?.enabledModels ?? []);
    const options = modelOptionsSchema.parse(
      server?.modelOptions ?? row?.modelOptions ?? {},
    );
    if (!enabled) continue;
    if (!secret.apiKey) {
      if (!allowUnavailable) throw new Error('MISSING_SECRETS');
      unavailable.set(name, 'MISSING_SECRETS');
      continue;
    }
    for (const model of modelsSchema.parse(models))
      entries.push({
        name,
        title: server?.title ?? row?.title ?? name,
        model: model.value,
        label: model.label,
        apiKey: secret.apiKey,
        baseURL: secret.baseURL ?? row?.baseURL ?? '',
        options,
      });
  }
  const fallback = assistantModels(config);
  return {
    list() {
      const services = new Map<
        string,
        {
          llmService: string;
          llmServiceTitle: string;
          enabledModels: { value: string; label: string }[];
        }
      >();
      for (const entry of entries) {
        const row = services.get(entry.name) ?? {
          llmService: entry.name,
          llmServiceTitle: entry.title,
          enabledModels: [],
        };
        row.enabledModels.push({ value: entry.model, label: entry.label });
        services.set(entry.name, row);
      }
      return [
        ...services.values(),
        ...fallback.list().filter((row) => !names.has(row.llmService)),
      ];
    },
    create(selected, schema) {
      if (unavailable.has(selected.llmService ?? ''))
        throw new Error(unavailable.get(selected.llmService ?? ''));
      const entry = entries.find(
        (entry) =>
          entry.name === selected.llmService && entry.model === selected.model,
      );
      if (!entry) {
        if (names.has(selected.llmService ?? ''))
          throw new Error('ASSISTANT_MODEL_UNAVAILABLE');
        return fallback.create(selected, schema);
      }
      return assistantModels(
        {
          enabled: true,
          llmService: entry.name,
          model: entry.model,
          apiKey: entry.apiKey,
          baseURL: entry.baseURL,
        },
        entry.options,
      ).create(selected, schema);
    },
  };
}
