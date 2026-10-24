import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/** Legacy configuration retained for inventory; execution belongs to the application process runtime. */
interface WorkflowRuntimeConfig {
  readonly sourceRoot: string;
  readonly distRoot: string;
  readonly artifactDisk: string;
  readonly production: boolean;
}

const workflow: AppConfigFactory<WorkflowRuntimeConfig> = defineAppConfig(
  ({ paths, env }) => ({
    sourceRoot: paths.root('workflows'),
    distRoot: paths.root('workflows'),
    artifactDisk: 'local',
    production: env.NODE_ENV === 'production',
  }),
);

export default workflow;
