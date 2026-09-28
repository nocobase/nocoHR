import type { AIToolRendererMap } from '@/extensions/nocobase-ai';

import {
  CoursesRenderer,
  SourcesRenderer,
} from './tool-renderer-components.js';

/** Citations and related courses as links the learner can follow inside the application. */
export const talentToolRenderers: AIToolRendererMap = {
  searchKnowledge: SourcesRenderer,
  recommendCourses: CoursesRenderer,
};
