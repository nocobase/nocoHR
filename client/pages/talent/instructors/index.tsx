/**
 * V4-13 讲师 (`/talent/instructors`, hr.admin): internal instructors (with an
 * account) and external ones (without), each with the statistics computed
 * for the date range — teaching hours, sessions, the average satisfaction
 * (l1) and the exam pass rate of the people who attended. 分配讲师 sets a
 * session's instructor: an external profile clears the account.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, UserCogIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Instructor {
  id: string;
  userId: string | null;
  name: string;
  type: 'internal' | 'external';
  organization: string | null;
  level: string | null;
  active: boolean;
  stats: {
    sessions: number;
    hours: number;
    satisfaction: number | null;
    responses: number;
    passRate: number | null;
    attendees: number;
  };
}

export default function InstructorsPage(): ReactElement {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useRemote<{ instructors: Instructor[]; can: { manage: boolean } }>(
    'talent/instructors',
    { from: from || undefined, to: to || undefined },
  );
  const [editing, setEditing] = useState<Instructor | 'new' | null>(null);
  const [assigning, setAssigning] = useState(false);
  return (
    <PageContainer>
      <PageHeader
        title={t('talentReview.instructors.title')}
        description={t('talentReview.instructors.description')}
        actions={
          list.data?.can.manage ? (
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => setAssigning(true)}>
                <UserCogIcon data-icon='inline-start' />
                {t('talentReview.instructors.assign')}
              </Button>
              <Button onClick={() => setEditing('new')}>
                <PlusIcon data-icon='inline-start' />
                {t('talentReview.instructors.create')}
              </Button>
            </div>
          ) : null
        }
      />
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span>{t('talentReview.instructors.range')}</span>
        <Input type='date' className='w-40' aria-label={t('talentReview.instructors.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>–</span>
        <Input type='date' className='w-40' aria-label={t('talentReview.instructors.to')} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.instructors.length ? (
        <EmptyState title={t('talentReview.instructors.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.instructors.name')}</TableHead>
                <TableHead>{t('talentReview.instructors.type')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.instructors.hours')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.instructors.sessions')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.instructors.satisfaction')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.instructors.passRate')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.instructors.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className='font-medium'>{i.name}</div>
                    <div className='text-muted-foreground text-xs'>
                      {[i.organization, i.level ? t(`talentReview.instructors.level.${i.level}`) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.type === 'internal' ? 'default' : 'outline'}>
                      {t(`talentReview.instructors.kind.${i.type}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-end tabular-nums'>{i.stats.hours}</TableCell>
                  <TableCell className='text-end tabular-nums'>{i.stats.sessions}</TableCell>
                  <TableCell className='text-end tabular-nums'>
                    {i.stats.satisfaction ?? '—'}
                    {i.stats.responses ? ` (${i.stats.responses})` : ''}
                  </TableCell>
                  <TableCell className='text-end tabular-nums'>
                    {i.stats.passRate === null ? '—' : `${i.stats.passRate}%`}
                  </TableCell>
                  <TableCell className='text-end'>
                    {list.data?.can.manage ? (
                      <Button size='sm' variant='outline' onClick={() => setEditing(i)}>
                        {t('talentReview.common.edit')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ProfileDialog profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={list.reload} />
      ) : null}
      {assigning && list.data ? (
        <AssignDialog instructors={list.data.instructors} onClose={() => setAssigning(false)} onDone={list.reload} />
      ) : null}
    </PageContainer>
  );
}

function ProfileDialog({
  profile,
  onClose,
  onDone,
}: {
  profile: Instructor | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const users = useRemote<{ userId: string; name: string }[]>('talent/instructors/accounts');
  const [name, setName] = useState(profile?.name ?? '');
  const [type, setType] = useState<'internal' | 'external'>(profile?.type ?? 'internal');
  const [userId, setUserId] = useState(profile?.userId ?? '');
  const [organization, setOrganization] = useState(profile?.organization ?? '');
  const [level, setLevel] = useState(profile?.level ?? '');
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{profile ? profile.name : t('talentReview.instructors.create')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <Field>
            <FieldLabel htmlFor='in-type'>{t('talentReview.instructors.type')}</FieldLabel>
            <NativeSelect id='in-type' value={type} onChange={(e) => setType(e.target.value as 'internal' | 'external')}>
              <NativeSelectOption value='internal'>{t('talentReview.instructors.kind.internal')}</NativeSelectOption>
              <NativeSelectOption value='external'>{t('talentReview.instructors.kind.external')}</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='in-name'>{t('talentReview.instructors.name')}</FieldLabel>
            <Input id='in-name' value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {type === 'internal' ? (
            <Field>
              <FieldLabel htmlFor='in-user'>{t('talentReview.instructors.account')}</FieldLabel>
              <NativeSelect id='in-user' value={userId} onChange={(e) => setUserId(e.target.value)}>
                <NativeSelectOption value=''>—</NativeSelectOption>
                {(users.data ?? []).map((u) => (
                  <NativeSelectOption key={u.userId} value={u.userId}>
                    {u.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor='in-org'>{t('talentReview.instructors.organization')}</FieldLabel>
              <Input id='in-org' value={organization} onChange={(e) => setOrganization(e.target.value)} />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor='in-level'>{t('talentReview.instructors.levelLabel')}</FieldLabel>
            <NativeSelect id='in-level' value={level} onChange={(e) => setLevel(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {['junior', 'senior', 'expert'].map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {t(`talentReview.instructors.level.${l}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !name.trim()}
            onClick={() => { void (async () => {
              const json = {
                name,
                type,
                userId: type === 'internal' ? userId || null : null,
                organization: type === 'external' ? organization || null : null,
                level: level || null,
              };
              const done = await action.run(
                profile
                  ? { method: 'PUT', path: `talent/instructors/${encodeURIComponent(profile.id)}`, json }
                  : { method: 'POST', path: 'talent/instructors', json },
                t('talentReview.instructors.saved'),
              );
              if (done) {
                onDone();
                onClose();
              }
            })(); }}
          >
            {t('talentReview.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  instructors,
  onClose,
  onDone,
}: {
  instructors: Instructor[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const sessions = useRemote<{ id: string; title: string; startAt: string | null; instructorProfileId: string | null }[]>(
    'talent/instructors/sessions',
  );
  const [sessionId, setSessionId] = useState('');
  const [profileId, setProfileId] = useState('');
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talentReview.instructors.assign')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <Field>
            <FieldLabel htmlFor='as-session'>{t('talentReview.instructors.session')}</FieldLabel>
            <NativeSelect id='as-session' value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {(sessions.data ?? []).map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='as-profile'>{t('talentReview.instructors.name')}</FieldLabel>
            <NativeSelect id='as-profile' value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {instructors.map((i) => (
                <NativeSelectOption key={i.id} value={i.id}>
                  {i.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !sessionId || !profileId}
            onClick={() => { void (async () => {
              const done = await action.run(
                {
                  method: 'PUT',
                  path: `talent/instructors/sessions/${encodeURIComponent(sessionId)}`,
                  json: { instructorProfileId: profileId },
                },
                t('talentReview.instructors.assigned'),
              );
              if (done) {
                onDone();
                onClose();
              }
            })(); }}
          >
            {t('talentReview.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
