import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Bot } from 'lucide-react';
import { lazy, Suspense, useState, type ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// The AI chat stack loads only when the panel first opens, so the shell stays light.
const UnifiedAssistant = lazy(() =>
  import('@/components/talent/unified-assistant').then((module) => ({
    default: module.UnifiedAssistant,
  })),
);

/**
 * Application addition (V1-04 统一 AI 入口): the header's "AI 助手" button opens
 * the unified entry chat in a right-side panel on any page. It shows only to
 * users who may use `talent.aiAssistant`; the panel is temporary, so it has no
 * URL, and the 问答 page is the same chat full-screen.
 */
export function AiAssistantButton({
  className,
}: {
  readonly className: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const allowed = useCan({
    resource: { type: 'composite', id: 'talent.aiAssistant' },
    action: 'use',
  });
  if (!allowed.can) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<button type='button' className={className} />}
          aria-label={t('aiEntry.panel.button')}
          onClick={() => setOpen(true)}
        >
          <Bot className='size-5' />
        </TooltipTrigger>
        <TooltipContent side='bottom'>
          {t('aiEntry.panel.button')}
        </TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        {/* Full width on phones; a fixed reading width beside the page on larger screens. */}
        <SheetContent side='right' className='w-full gap-0 sm:max-w-lg'>
          <SheetHeader className='border-b'>
            <SheetTitle>{t('aiEntry.panel.title')}</SheetTitle>
            <SheetDescription>
              {t('aiEntry.panel.description')}
            </SheetDescription>
          </SheetHeader>
          <div className='min-h-0 flex-1'>
            <Suspense
              fallback={
                <div className='space-y-2 p-4'>
                  <Skeleton className='h-10 w-full' />
                  <Skeleton className='h-10 w-full' />
                </div>
              }
            >
              <UnifiedAssistant chatId='unified-panel' layout='panel' />
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
