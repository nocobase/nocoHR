import { ChatPanel } from '#extensions/nocobase-agent-chat/chat-panel';
import { useSyncServerLocale } from '@nocobase/app-plugin-i18n/client';
import { useMemo, type ReactElement } from 'react';
import type { AppClientRegisteredRoute } from '@nocobase/app-client/plugins';
import { Outlet, useLocation } from 'react-router';

import { RouteTreeProvider } from '../routing/route-context.js';

import {
  PageBreadcrumbProvider,
  useClientApplication,
} from '@nocobase/app-client';
import { Breadcrumbs } from '#components/breadcrumbs';
import { surfaceRoutes } from '../routing/surfaces.js';
import { useTranslation } from '@nocobase/i18n/client';
import { LayoutHeader } from './components/layout-header.js';
import {
  AppSidebar,
  AppSidebarProvider,
  AppSidebarToggle,
} from './components/app-sidebar.js';
import { NavigationMenu } from './components/navigation-menu.js';
import { AppBrand } from './components/app-brand.js';
import { HeaderActions } from './components/header-actions.js';
import { AppSidebarFooter } from './components/sidebar-footer.js';
import { MobileTabBar } from './components/mobile-tab-bar.js';
import {
  useRouteNavigation,
  selectedNavigationId,
  navigationPages,
} from '../routing/route-navigation.js';

export function AppLayout({
  routes,
}: {
  readonly routes: readonly AppClientRegisteredRoute[];
}): ReactElement {
  // The browser decides what it renders; this tells the server the same language so its messages match.
  useSyncServerLocale();

  const { t } = useTranslation();
  const { items: menuItems, denied } = useRouteNavigation(routes);
  const selectedKey = selectedNavigationId(
    routes,
    useLocation().pathname,
    denied,
  );
  const runtimeRoutes = useClientApplication().runtime.routes;
  const settingsTree = useMemo(
    () => surfaceRoutes(runtimeRoutes, 'settings'),
    [runtimeRoutes],
  );
  const settingsNavigation = useRouteNavigation(settingsTree);
  const navigationLabel = t('navigation.label', {
    defaultValue: 'Application navigation',
  });

  return (
    // The shell owns the business route tree used by its pages and navigation.
    <RouteTreeProvider routes={routes}>
      <PageBreadcrumbProvider>
        <AppSidebarProvider>
          <AppSidebar label={navigationLabel} footer={<AppSidebarFooter />}>
            <NavigationMenu
              items={menuItems}
              label={navigationLabel}
              selectedKey={selectedKey}
            />
          </AppSidebar>
          <div className='flex min-w-0 flex-1 flex-col'>
            <LayoutHeader className='sticky top-0 z-40 justify-between'>
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                <AppSidebarToggle />
                <div className='md:hidden'>
                  <AppBrand />
                </div>
                <div className='hidden h-5 w-px bg-border md:block' />
                <p className='hidden shrink-0 truncate text-sm font-medium text-muted-foreground md:block'>
                  {t('shell.workspace', {
                    defaultValue: 'AI application workspace',
                  })}
                </p>
                <Breadcrumbs className='min-w-0 flex-1' denied={denied} />
              </div>
              <HeaderActions
                showSettings={
                  navigationPages(settingsNavigation.items).length > 0
                }
                showDev={import.meta.env.DEV}
              />
            </LayoutHeader>
            <div className='relative flex min-h-0 flex-1'>
              <main className='relative min-w-0 flex-1 overflow-hidden'>
                {/* main only positions; the page scrolls in here, so a child page layer laid over main is neither
            moved by the page's scrolling nor stretched by its height. */}
                <div className='h-full overflow-y-auto'>
                  <Outlet />
                </div>
              </main>
              <ChatPanel />
            </div>
            {/* Application addition: phones get a employee tab bar (学习 · 考试 · 问答 · 自助 · 我的) under main, because the
          sidebar drawer is too far away for pages employees open daily. It reads the same authorized items. */}
            <MobileTabBar items={menuItems} />
          </div>
        </AppSidebarProvider>
      </PageBreadcrumbProvider>
    </RouteTreeProvider>
  );
}
