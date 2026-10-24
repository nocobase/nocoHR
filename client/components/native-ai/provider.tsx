import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { ChatProvider } from '@nocobase/app-plugin-agents/client/chat';
import type { PropsWithChildren } from 'react';

/** A new controller per authenticated identity; no state from another account survives sign-out. */
export function NativeAIProvider({ children }: PropsWithChildren) {
  const { session } = useAuthentication();
  const entry = useCan({
    resource: { type: 'composite', id: 'talent.aiAssistant' },
    action: 'use',
  });
  return (
    <ChatProvider
      key={session?.user.id ?? 'anonymous'}
      available={!!session?.user && entry.can}
    >
      {children}
    </ChatProvider>
  );
}
