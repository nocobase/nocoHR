import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import { z } from 'zod';

export const nativeKnowledgeSchema = z
  .strictObject({
    spaces: z
      .array(
        z.strictObject({
          scope: z.string().min(1).max(64),
          scopeId: z.string().max(128),
          title: z.string().min(1).max(200),
          relatedUserIds: z.array(z.string().min(1).max(128)).max(1000),
        }),
      )
      .max(100),
    embedding: z
      .strictObject({
        modelService: z.string().min(1),
        model: z.string().min(1),
      })
      .nullable(),
  })
  .refine(
    (value) =>
      new Set(value.spaces.map((s) => JSON.stringify([s.scope, s.scopeId])))
        .size === value.spaces.length,
  );
export type NativeKnowledgeConfig = z.infer<typeof nativeKnowledgeSchema>;
const nativeKnowledge: AppConfigFactory<NativeKnowledgeConfig> =
  defineAppConfig({
    defaults: { spaces: [], embedding: null },
    validate(value, context) {
      if (!nativeKnowledgeSchema.safeParse(value).success)
        context.error('', 'Invalid native knowledge configuration.');
    },
  });
export default nativeKnowledge;
