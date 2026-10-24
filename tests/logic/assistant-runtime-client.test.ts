import type { ApiClient, ApiRequestOptions } from '@nocobase/app-client';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeAIService } from '../../client/extensions/nocobase-ai/services/runtime-ai-service.js';

describe('application assistant client selection', () => {
  it('never falls back to removed plugin endpoints when disabled', async () => {
    const request = vi.fn(async () => ({ data: { enabled: false } }));
    const service = new RuntimeAIService({ request } as unknown as ApiClient);
    await expect(service.listEmployees()).rejects.toThrow(
      'ASSISTANT_UNAVAILABLE',
    );
    await expect(service.listConversations()).rejects.toThrow(
      'ASSISTANT_UNAVAILABLE',
    );
    await expect(
      service.getConversationMessages('legacy-session'),
    ).rejects.toThrow('ASSISTANT_UNAVAILABLE');
    expect(request).toHaveBeenCalledExactlyOnceWith({
      path: 'assistantRuntime',
      method: 'GET',
    });
  });

  it('reads both old and new identifiers through the application API', async () => {
    const request = vi.fn(async (options: ApiRequestOptions) =>
      options.path === 'assistantRuntime'
        ? { data: { enabled: true } }
        : { data: [] },
    );
    const service = new RuntimeAIService({ request } as unknown as ApiClient);
    await service.listEmployees();
    await service.listConversations();
    await service.getConversationMessages('legacy-session', {
      updateRead: false,
    });
    await service.getConversationMessages('assistant-session', {
      updateRead: false,
    });
    const paths = request.mock.calls.map(([options]) => options.path);
    expect(paths.filter((path) => path === 'assistantRuntime')).toHaveLength(1);
    expect(paths).toContain('assistantEmployees');
    expect(paths.every((path) => path.startsWith('assistant'))).toBe(true);
  });
});
