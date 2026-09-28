import type { QuestionType } from '@/components/talent/exam-types';

export const QUESTION_TYPES: readonly QuestionType[] = [
  'single',
  'multiple',
  'judge',
  'blank',
  'short',
];
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
