import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { CategoryBadge, ReviewStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useRouteOverlay } from '@/components/use-route-overlay';

import { CompetencyForm } from './competency-form.js';
import type { CompetenciesOutletContext, CompetencyItem } from './types.js';

const FORM_ID = 'competency-detail-form';

/** Route `/talent/competencies/:competencyId`: details with inline level editing, confirm or discard a draft, disable. */
export default function CompetencyDetailPage(): ReactElement {
  const { competencyId = '' } = useParams();
  const { t } = useTranslation();
  const context = useOutletContext<CompetenciesOutletContext>();
  const competency = useRemote<CompetencyItem>(
    `talent/competencies/${encodeURIComponent(competencyId)}`,
  );
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef(false);
  return (
    <RouteDrawer
      key={competencyId}
      title={competency.data?.title ?? t('talent.competencies.detail')}
      description={
        competency.data ? (
          <span className='flex flex-wrap items-center gap-2'>
            <CategoryBadge category={competency.data.category} />
            <ReviewStatusBadge status={competency.data.reviewStatus} />
            {!competency.data.active ? (
              <Badge variant='outline'>{t('talent.common.disabled')}</Badge>
            ) : null}
            <span>
              {t('talent.competencies.usedBy', {
                count: competency.data.positionCount,
              })}
            </span>
          </span>
        ) : undefined
      }
      className='sm:max-w-3xl'
      beforeClose={() => !ref.current}
      footer={
        competency.data ? (
          <Footer
            competency={competency.data}
            submitting={submitting}
            onChanged={() => {
              competency.reload();
              context.reload();
            }}
          />
        ) : undefined
      }
    >
      {competency.error ? (
        <LoadError error={competency.error} onRetry={competency.reload} />
      ) : !competency.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <CompetencyForm
          key={`${competency.data.id}-${competency.data.maxLevel}-${competency.data.levels.length}`}
          formId={FORM_ID}
          competency={competency.data}
          disabled={!context.canManage}
          onSubmittingChange={(value) => {
            ref.current = value;
            setSubmitting(value);
          }}
          onSubmitted={() => {
            competency.reload();
            context.reload();
          }}
        />
      )}
    </RouteDrawer>
  );
}

function Footer({
  competency,
  submitting,
  onChanged,
}: {
  competency: CompetencyItem;
  submitting: boolean;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { close } = useRouteOverlay();
  const { canManage, canConfirm, reload } =
    useOutletContext<CompetenciesOutletContext>();
  const [busy, setBusy] = useState(false);
  async function run(
    path: string,
    json: unknown,
    success: string,
    closeAfter = false,
  ): Promise<void> {
    setBusy(true);
    try {
      const { data } = await api.request<{
        data?: { active?: boolean; confirmedRequirements?: number };
      }>({ path, method: 'POST', json });
      toast.add({ type: 'success', title: success });
      // V3-08: deactivating keeps history; say how many confirmed requirements still reference it.
      if (data?.active === false && (data.confirmedRequirements ?? 0) > 0)
        toast.add({
          type: 'info',
          title: t('talent.competencyExt.deactivatedInUse', {
            count: data.confirmedRequirements,
          }),
        });
      if (closeAfter) {
        reload();
        await close();
      } else onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }
  const draft = competency.reviewStatus === 'draft';
  return (
    <>
      {canConfirm && draft ? (
        <>
          <Button
            variant='outline'
            disabled={busy || submitting}
            onClick={() =>
              void run(
                'talent/competencies/discard',
                { ids: [competency.id] },
                t('talent.competencies.discarded'),
                true,
              )
            }
          >
            {t('talent.framework.discard')}
          </Button>
          <Button
            variant='outline'
            disabled={busy || submitting}
            onClick={() =>
              void run(
                'talent/competencies/confirm',
                { ids: [competency.id] },
                t('talent.competencies.confirmed'),
              )
            }
          >
            {t('talent.framework.confirm')}
          </Button>
        </>
      ) : null}
      {canManage && !draft ? (
        <Button
          variant='outline'
          disabled={busy || submitting}
          onClick={() =>
            void run(
              `talent/competencies/${encodeURIComponent(competency.id)}/active`,
              { active: !competency.active },
              competency.active
                ? t('talent.common.disabled')
                : t('talent.common.enabled'),
            )
          }
        >
          {competency.active
            ? t('talent.common.disable')
            : t('talent.common.enable')}
        </Button>
      ) : null}
      {canManage ? (
        <Button type='submit' form={FORM_ID} disabled={busy || submitting}>
          {submitting ? <Spinner data-icon='inline-start' /> : null}
          {t('actions.save')}
        </Button>
      ) : null}
    </>
  );
}
