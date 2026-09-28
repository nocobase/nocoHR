import type { Application } from '@nocobase/app-server/application';
import { aiManagerToken } from '@nocobase/app-plugin-ai-employee/server';
import { ServiceProvider } from '@nocobase/service-provider';

import AppAIResources from '../ai/index.js';

/** Hands the application's AI employee and tools to the runtime the plugin created. */
export default class AIResourcesProvider extends ServiceProvider<Application> {
  public readonly name: string = 'hr/ai-resources';

  public override async boot(): Promise<void> {
    if (!this.app.container.has(aiManagerToken)) return;
    const ai = this.app.container.resolve(aiManagerToken);
    await new AppAIResources({ source: 'application' }).registerAIResources(ai);
  }
}
