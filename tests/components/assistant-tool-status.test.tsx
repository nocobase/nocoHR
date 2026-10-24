import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from '../../client/extensions/nocobase-ai/components/chat/tool-call-card.js';
import type { ToolCallPart } from '../../client/extensions/nocobase-ai/components/chat/tool-call-utils.js';

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options: { defaultValue?: string } = {}) =>
      options.defaultValue ?? _key,
  }),
}));
vi.mock(
  '../../client/extensions/nocobase-ai/locales/use-ai-translate.js',
  () => ({
    useAITranslate: () => (_key: string, fallback: string) => fallback,
  }),
);

const base = {
  type: 'dynamic-tool',
  toolName: 'listCourses',
  toolCallId: 'call-1',
  input: {},
} as const;
const cases: { name: string; part: ToolCallPart; label: string }[] = [
  {
    name: 'waiting for approval',
    part: {
      ...base,
      state: 'approval-requested',
      approval: { id: 'decision-1' },
    },
    label: 'Approval required',
  },
  {
    name: 'approved',
    part: {
      ...base,
      state: 'approval-responded',
      approval: { id: 'decision-1', approved: true },
    },
    label: 'Allowed',
  },
  {
    name: 'rejected',
    part: {
      ...base,
      state: 'approval-responded',
      approval: { id: 'decision-1', approved: false },
    },
    label: 'Denied',
  },
  {
    name: 'output denied',
    part: {
      ...base,
      state: 'output-denied',
      approval: { id: 'decision-1', approved: false },
    },
    label: 'Denied',
  },
];

describe('AI SDK tool approval status', () => {
  it.each(cases)(
    'renders a saved $name result without executing a tool',
    ({ part, label }) => {
      const onDecision = vi.fn();
      render(<ToolCallCard part={part} onDecision={onDecision} readOnly />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(onDecision).not.toHaveBeenCalled();
    },
  );
});
