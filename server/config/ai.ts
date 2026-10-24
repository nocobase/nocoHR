import { z } from 'zod';
import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import type { AIConfiguration } from '../providers/assistant/model-configuration.js';

/** Server-owned configuration; secrets are injected through this section's existing environment mapping. */
const ai: AppConfigFactory<AIConfiguration> = defineAppConfig<AIConfiguration>({
  env: {},
  validate: (value, context) => {
    const service = z.strictObject({
      provider: z.string().trim().min(1),
      title: z.string().optional(),
      options: z.record(z.string(), z.unknown()).optional(),
      enabled: z.boolean().optional(),
      sort: z.number().optional(),
      enabledModels: z
        .array(z.strictObject({ label: z.string(), value: z.string().min(1) }))
        .optional(),
      overrideEnabledModels: z.boolean().optional(),
      modelOptions: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = z.record(z.string(), service).safeParse(value.llmServices);
    if (!parsed.success) {
      context.error(
        'llmServices',
        'must be a keyed service map with valid non-secret field types.',
      );
      return;
    }
    for (const [name, entry] of Object.entries(parsed.data)) {
      if (entry.provider !== 'openai-completions')
        context.warning(
          `llmServices.${name}.provider`,
          'is not mapped by the application replacement; cutover remains blocked.',
        );
      if (
        entry.enabled !== false &&
        entry.provider === 'openai-completions' &&
        !entry.options?.apiKey
      )
        context.warning(
          `llmServices.${name}.options.apiKey`,
          'must be supplied through server configuration before this service can run.',
        );
    }
  },
  defaults: () => ({
    storage: {},
    aiEmployee: { storage: {} },
    aiKnowledgeBase: { storage: {}, vectorDatabases: [], manifests: [] },
    llmServices: {},
    skills: { paths: [] },
    mcpServers: {},
  }),
});
export default ai;
