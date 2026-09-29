import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import {
  NavLink,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useResolvedPath,
} from 'react-router';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';

export default function LeavePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const parent = useResolvedPath('.');
  const types = location.pathname.includes('/types');
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: types ? 'manageTypes' : 'adjustBalance',
  });
  if (
    location.pathname.replace(/\/$/u, '') ===
    parent.pathname.replace(/\/$/u, '')
  )
    return (
      <Navigate
        replace
        to={{ pathname: 'balances', search: location.search }}
      />
    );
  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.leave.title')}
        description={t('attendance.leave.description')}
        actions={
          grant.can ? (
            <Button
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: types
                      ? '/talent/leave/types/new'
                      : '/talent/leave/balances/initialize',
                    search: location.search,
                  }}
                />
              }
            >
              {t(`attendance.leave.${types ? 'createType' : 'initialize'}`)}
            </Button>
          ) : null
        }
      />
      <nav
        className='flex flex-wrap gap-2'
        aria-label={t('attendance.leave.title')}
      >
        {(['balances', 'types'] as const).map((tab) => (
          <NavLink
            key={tab}
            to={{ pathname: tab, search: location.search }}
            className={({ isActive }) =>
              buttonVariants({ variant: isActive ? 'secondary' : 'ghost' })
            }
          >
            {t(`attendance.leave.${tab}`)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  );
}
