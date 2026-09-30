import { useApiClient } from '@nocobase/app-client';
import { fetchUnreadCount } from '@nocobase/app-plugin-notification-in-app/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Bell } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Application addition: the header's 通知 bell opens the in-app inbox
 * (/talent/inbox) and shows the unread count. The in-app plugin has no
 * production entry of its own and a route's navigation cannot place a header
 * control, so the shell carries it, like the AI 助手 button. The count is
 * refetched on navigation, window focus and once a minute.
 */
export function NotificationsButton({
  className,
}: {
  readonly className: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = () =>
      void fetchUnreadCount(api, controller.signal)
        .then((count) => {
          if (alive) setUnread(count);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [api, location.pathname]);
  const label = unread
    ? t('inbox.buttonUnread', { count: unread })
    : t('inbox.button');
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link to='/talent/inbox' className={`${className} relative`} />}
        aria-label={label}
      >
        <Bell className='size-5' />
        {unread ? (
          <span className='absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground'>
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  );
}
