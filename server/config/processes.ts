import {
  defineAppConfig,
  envBoolean,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/u);
export const processesConfigSchema = z.strictObject({
  enabled: z.boolean(),
  scheduleUsers: z
    .record(id, id)
    .refine((value) => Object.keys(value).length <= 1000),
});
export interface ProcessesConfig {
  enabled: boolean;
  /** Native schedule ID -> execution user ID. Server configuration only; no implicit fallback user. */
  scheduleUsers: Record<string, string>;
}
const processes: AppConfigFactory<ProcessesConfig> =
  defineAppConfig<ProcessesConfig>({
    defaults: { enabled: false, scheduleUsers: {} },
    env: { APP_PROCESSES_ENABLED: envBoolean('enabled') },
    validate(value, context) {
      if (!processesConfigSchema.safeParse(value).success)
        context.error('', 'Invalid process execution-user configuration.');
    },
  });
export default processes;
