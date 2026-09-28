import { useTranslation } from '@nocobase/i18n/client';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface OrgNode {
  id: string;
  title: string;
  parentId: string | null;
  managerName: string | null;
  headcount: number;
  children: OrgNode[];
}

/** 组织架构 — enabled departments with their heads and headcounts; a list on narrow screens. */
export default function OrgChartPage(): ReactElement {
  const { t } = useTranslation();
  const chart = useRemote<{ tree: OrgNode[]; canOpenEmployees: boolean }>(
    'talent/org-chart',
  );
  const [selected, setSelected] = useState<OrgNode | null>(null);
  return (
    <PageContainer>
      <PageHeader
        title={t('talent.orgChart.title')}
        description={t('talent.orgChart.description')}
      />
      {chart.error ? (
        <LoadError error={chart.error} onRetry={chart.reload} />
      ) : !chart.data ? (
        <BlockSkeleton rows={6} />
      ) : !chart.data.tree.length ? (
        <EmptyState title={t('talent.orgChart.empty')} />
      ) : (
        <div className='grid gap-4 lg:grid-cols-[1fr_20rem]'>
          <Card>
            <CardContent className='pt-6'>
              <ul className='space-y-1'>
                {chart.data.tree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelected}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
          <Members node={selected} canOpen={chart.data.canOpenEmployees} />
        </div>
      )}
    </PageContainer>
  );
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: OrgNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: OrgNode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md pr-2 hover:bg-muted',
          selectedId === node.id && 'bg-muted',
        )}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        <button
          type='button'
          className='flex size-7 shrink-0 items-center justify-center text-muted-foreground'
          aria-label={
            open ? t('talent.common.collapse') : t('talent.common.expand')
          }
          aria-expanded={open}
          disabled={!node.children.length}
          onClick={() => setOpen(!open)}
        >
          {node.children.length ? (
            open ? (
              <ChevronDownIcon className='size-4' />
            ) : (
              <ChevronRightIcon className='size-4' />
            )
          ) : null}
        </button>
        <button
          type='button'
          className='flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-left'
          onClick={() => onSelect(node)}
        >
          <span className='font-medium'>{node.title}</span>
          <span className='flex items-center gap-1 text-xs text-muted-foreground'>
            <UserIcon className='size-3.5' />
            {node.managerName ?? t('talent.orgChart.noHead')}
          </span>
          <span className='flex items-center gap-1 text-xs text-muted-foreground'>
            <UsersIcon className='size-3.5' />
            {t('talent.orgChart.headcount', { count: node.headcount })}
          </span>
        </button>
      </div>
      {open && node.children.length ? (
        <ul className='space-y-1'>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Members({
  node,
  canOpen,
}: {
  node: OrgNode | null;
  canOpen: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const members = useRemote<
    { id: string; name: string; positionTitle: string | null }[]
  >(node ? `talent/org-chart/${encodeURIComponent(node.id)}/members` : null);
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          {node ? node.title : t('talent.orgChart.members')}
        </CardTitle>
        <CardDescription>
          {node
            ? t('talent.orgChart.directMembers')
            : t('talent.orgChart.pickDepartment')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        {!node ? null : members.error ? (
          <LoadError error={members.error} onRetry={members.reload} />
        ) : !members.data ? (
          <BlockSkeleton rows={3} />
        ) : members.data.length ? (
          members.data.map((m) => (
            <div key={m.id} className='flex justify-between gap-3'>
              {canOpen ? (
                <Link
                  className='hover:underline'
                  to={`/talent/employees/${m.id}/profile`}
                >
                  {m.name}
                </Link>
              ) : (
                <span>{m.name}</span>
              )}
              <span className='text-muted-foreground'>
                {m.positionTitle ?? '—'}
              </span>
            </div>
          ))
        ) : (
          <p className='text-muted-foreground'>
            {t('talent.orgChart.noMembers')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
