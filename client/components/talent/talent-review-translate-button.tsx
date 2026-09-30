/**
 * V4-13 生成英文版: asks the content writer for an English draft of a course,
 * question, knowledge document or practice scenario (the owner or hr.admin),
 * then links to 译文审核. The same original version is drafted only once.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { LanguagesIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { useTrAction } from './talent-review-lib.js';
import { Button } from '@/components/ui/button';

export function TranslateButton({
  type,
  id,
}: {
  type: 'course' | 'question' | 'document' | 'scenario';
  id: string;
}): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const action = useTrAction();
  return (
    <Button
      variant='outline'
      disabled={action.busy}
      title={action.error}
      onClick={() => { void (async () => {
        const done = await action.run(
          { method: 'POST', path: `talent/translations/${type}/${encodeURIComponent(id)}/request` },
          t('talentReview.translations.requested'),
        );
        if (done) void navigate('/talent/translations');
      })(); }}
    >
      <LanguagesIcon data-icon='inline-start' />
      {t('talentReview.translations.request')}
    </Button>
  );
}
