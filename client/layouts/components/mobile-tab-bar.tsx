import { useTranslation } from '@nocobase/i18n/client';
import {
  BookOpen,
  IdCard,
  LayoutGrid,
  MessageCircleQuestion,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

import {
  navigationPages,
  type RouteNavigationItem,
} from '../../routing/route-navigation.js';

/** The employee's everyday pages, by route name: 学习 · 考试 · 问答 · 自助 · 我的 (V1-04 added 自助). */
const TABS: readonly { route: string; title: string; icon: LucideIcon }[] = [
  {
    route: 'talent-my-learning',
    title: 'navigation.tabs.learn',
    icon: BookOpen,
  },
  {
    route: 'talent-my-exams',
    title: 'navigation.tabs.exams',
    icon: NotebookPen,
  },
  {
    route: 'talent-knowledge-qa',
    title: 'navigation.tabs.ask',
    icon: MessageCircleQuestion,
  },
  {
    route: 'talent-self-service',
    title: 'navigation.tabs.selfService',
    icon: LayoutGrid,
  },
  { route: 'talent-me', title: 'navigation.tabs.me', icon: IdCard },
];

/**
 * Bottom tab bar on phones (below `md`): 学习 · 考试 · 问答 · 自助 · 我的. It reads the
 * same authorized navigation as the sidebar, so a tab appears only when the
 * user may open that page, and the bar disappears when none remain.
 */
export function MobileTabBar({
  items,
}: {
  items: readonly RouteNavigationItem[];
}): ReactElement | null {
  const { t } = useTranslation();
  const pages = new Map(
    navigationPages(items).map((route) => [route.name, route]),
  );
  const tabs = TABS.flatMap((tab) => {
    const route = pages.get(tab.route);
    return route ? [{ ...tab, path: route.path }] : [];
  });
  if (!tabs.length) return null;
  return (
    <nav
      aria-label={t('navigation.tabs.label')}
      className='grid shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden'
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map(({ route, title, icon: Icon, path }) => (
        <NavLink
          key={route}
          to={path}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground transition-colors focus-visible:bg-muted focus-visible:outline-none',
              isActive && 'text-primary',
            )
          }
        >
          <Icon className='size-5' />
          {t(title)}
        </NavLink>
      ))}
    </nav>
  );
}
