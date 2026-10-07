import { useTranslation } from '@nocobase/i18n/client';
import { PlayIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { buttonVariants } from '@/components/ui/button';

import { useRemote } from './use-remote.js';

/** `GET talent/licensed/my-grants` (server/providers/hr/licensed/index.ts). */
export interface LicensedGrants {
  enabled: boolean;
  employeeId: string | null;
  items: {
    certificateId: string;
    certificationId: string;
    title: string;
    status: string;
    expiresAt: string | null;
    expiring: boolean;
    pages: string[];
    /** The enabled industry content packs' pages among them, with name and route (no menu entry of their own). */
    pageLinks: { id: string; title: string; path: string }[];
    permissionSets: string[];
  }[];
}

/**
 * V4-14 证书带来的操作 (我的证书、证书墙): for the holder only — each
 * certificate that grants something says "可操作：设备开工登记" with a way into
 * the page (the pages have no menu entry), and an expiring one says what
 * will stop working. Renders nothing for anyone else's certificates, with the
 * industry pack off, or while loading.
 */
export function LicensedCertificateGrants({
  employeeId,
  certificationId,
}: {
  /** Shown only when this is the viewer's own employee record; omit on pages that are always the viewer's. */
  employeeId?: string;
  certificationId?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const remote = useRemote<LicensedGrants>('talent/licensed/my-grants');
  const data = remote.data;
  if (!data?.enabled) return null;
  if (employeeId && data.employeeId !== employeeId) return null;
  const items = data.items.filter(
    (item) => !certificationId || item.certificationId === certificationId,
  );
  if (!items.length) return null;
  return (
    <ul className='space-y-3' aria-label={t('licensed.grants.title')}>
      {items.map((item) => {
        const pages = item.pageLinks;
        const operations = pages.length
          ? pages.map((page) => page.title).join('、')
          : item.permissionSets.join('、');
        return (
          <li
            key={item.certificateId}
            className='space-y-2 rounded-lg border p-3 text-sm'
          >
            <p className='font-medium'>
              {certificationId ? null : `${item.title} · `}
              {t('licensed.grants.canOperate', { operations })}
            </p>
            {item.expiring ? (
              <p className='flex items-start gap-1.5 text-destructive'>
                <TriangleAlertIcon className='mt-0.5 size-4 shrink-0' />
                {t('licensed.grants.willLose', { operations })}
              </p>
            ) : null}
            {pages.length ? (
              <div className='flex flex-wrap gap-2'>
                {pages.map((page) => (
                  <Link
                    key={page.path}
                    to={page.path}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <PlayIcon data-icon='inline-start' />
                    {t('licensed.grants.open', { title: page.title })}
                  </Link>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
