import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { BotIcon, ChevronDownIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const VISIBLE_GROUPS = 6;

interface Entry {
  at: string;
  text: string | null;
  link: string | null;
}
interface Group {
  task: string;
  employee: string;
  today: number;
  week: number;
  latestAt: string;
  entries: Entry[];
}
interface Summary {
  timeZone: string;
  today: number;
  week: number;
  groups: Group[];
}

/**
 * 工作台 · AI 员工已办完: what the AI employees finished this week for the
 * tasks this user is responsible for, counted from their run records, with
 * a link to each record. The open to-dos below are 等你决定.
 */
export function AiDonePanel(): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const summary = useRemote<Summary>('talent/work-items/ai-done');
  const data = summary.data;
  // The few latest kinds of work first, so 等你决定 below stays in view.
  const [showAll, setShowAll] = useState(false);
  const groups = data
    ? showAll
      ? data.groups
      : data.groups.slice(0, VISIBLE_GROUPS)
    : [];
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: data?.timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale, data?.timeZone],
  );
  // Not for this user (no workbench) or not reachable: the to-dos still show.
  if (summary.error) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <BotIcon className='size-4 text-primary' />
          {t('workbench.aiDone.title')}
        </CardTitle>
        <CardDescription>
          {data
            ? t('workbench.aiDone.counts', {
                today: data.today,
                week: data.week,
              })
            : t('workbench.aiDone.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <BlockSkeleton rows={3} />
        ) : !data.groups.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('workbench.aiDone.empty')}
          </p>
        ) : (
          <ul className='divide-y'>
            {groups.map((group) => {
              const latest = group.entries[0];
              return (
                <li key={group.task} className='py-3 first:pt-0 last:pb-0'>
                  <Collapsible>
                    <div className='flex flex-wrap items-start gap-x-3 gap-y-1'>
                      <Badge variant='secondary'>
                        {t(`aiAutomations.employees.${group.employee}`, {
                          defaultValue: group.employee,
                        })}
                      </Badge>
                      <div className='min-w-0 flex-1'>
                        <p className='font-medium break-words'>
                          {t(`aiAutomations.tasks.${group.task}.title`, {
                            defaultValue: group.task,
                          })}
                          <span className='ml-2 text-sm font-normal text-muted-foreground'>
                            {group.today
                              ? t('workbench.aiDone.timesToday', {
                                  week: group.week,
                                  today: group.today,
                                })
                              : t('workbench.aiDone.times', {
                                  week: group.week,
                                })}
                          </span>
                        </p>
                        {latest?.text ? (
                          <p className='text-sm break-words text-muted-foreground'>
                            {latest.text}
                          </p>
                        ) : null}
                      </div>
                      <div className='flex items-center gap-1'>
                        {latest?.link ? (
                          <Button
                            variant='outline'
                            size='sm'
                            nativeButton={false}
                            render={<Link to={latest.link} />}
                          >
                            {t('workbench.aiDone.view')}
                          </Button>
                        ) : null}
                        {group.entries.length > 1 ? (
                          <CollapsibleTrigger
                            render={
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                aria-label={t('workbench.aiDone.more', {
                                  title: t(
                                    `aiAutomations.tasks.${group.task}.title`,
                                    { defaultValue: group.task },
                                  ),
                                })}
                              />
                            }
                          >
                            <ChevronDownIcon />
                          </CollapsibleTrigger>
                        ) : null}
                      </div>
                    </div>
                    <CollapsibleContent>
                      <ul className='mt-2 space-y-1 border-l pl-3 text-sm'>
                        {group.entries.map((entry) => (
                          <li
                            key={`${entry.at}|${entry.link ?? ''}|${entry.text ?? ''}`}
                            className='flex flex-wrap items-center gap-x-2'
                          >
                            <span className='text-muted-foreground tabular-nums'>
                              {time.format(new Date(entry.at))}
                            </span>
                            {entry.link ? (
                              <Link
                                className='break-words hover:underline'
                                to={entry.link}
                              >
                                {entry.text ?? t('workbench.aiDone.done')}
                              </Link>
                            ) : (
                              <span className='break-words'>
                                {entry.text ?? t('workbench.aiDone.done')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              );
            })}
          </ul>
        )}
        {data && data.groups.length > VISIBLE_GROUPS ? (
          <Button
            variant='link'
            size='sm'
            className='mt-2 h-auto px-0'
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t('workbench.aiDone.showLess')
              : t('workbench.aiDone.showAll', { count: data.groups.length })}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
