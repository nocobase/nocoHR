import { useCan } from '@nocobase/app-plugin-authorization/client';
import { ChatHeaderButton } from '#extensions/nocobase-agent-chat/launchers';

/** Preserve the existing HR entry grant; the native provider owns the shared panel. */
export function AiAssistantButton({
  className,
}: {
  readonly className: string;
}) {
  const allowed = useCan({
    resource: { type: 'composite', id: 'talent.aiAssistant' },
    action: 'use',
  });
  return allowed.can ? (
    <span className={className}>
      <ChatHeaderButton />
    </span>
  ) : null;
}
