import type {
  OnlineAgentContext,
  OnlineAgentService,
} from '@nocobase/app-plugin-agents/server/online-agent';
import type { z } from 'zod';
import { generateStructuredResult } from './structured-result.js';

export function generateLearningPlan<T>(
  online: OnlineAgentService,
  actor: OnlineAgentContext,
  prompt: string,
  schema: z.ZodType<T>,
) {
  return generateStructuredResult(
    online,
    actor,
    prompt,
    schema,
    'hr.learningPlans',
  );
}
