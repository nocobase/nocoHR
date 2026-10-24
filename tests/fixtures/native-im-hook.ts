import type { OnlineAgentService } from '@nocobase/app-plugin-agents/server/online-agent';

/** A response facade for isolated business afterTurn-hook tests, not native protocol acceptance. */
export function nativeIMHookResponse(
  work: () => Promise<{ text: string }>,
  origin: { provider: string; externalUserId: string },
) {
  let text = '';
  return {
    async realtime() {
      return {
        sessionId: 'hook-session',
        async send() {
          text = (await work()).text;
        },
        async receive() {
          return null;
        },
        async history() {
          return text
            ? [
                {
                  id: 'hook-reply',
                  role: 'assistant',
                  parts: [{ type: 'text', text }],
                },
              ]
            : [];
        },
      };
    },
    async configuration() {
      return { scope: ['hr.im'], variable: { im: origin } };
    },
  } as unknown as OnlineAgentService;
}
