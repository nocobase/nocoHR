import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { EmptyState } from '@/components/talent/states';
import { titleText } from '@/components/talent/titles';
import type { DepartmentOption } from '@/components/talent/use-lookups';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { ChainPreviewCard } from './other-cards.js';
import { ReloadConfirm } from './reload-confirm.js';
import { RuleDialog } from './rule-dialog.js';
import type {
  ChainRule,
  Settings,
  SettingsOptions,
  Snapshot,
} from './types.js';
import { useSection } from './use-section.js';

type Value = Settings['approvalChain'];

/**
 * 审批链: levels added for a department (and its sub-departments) by action
 * type, and whether adjacent levels with one approver merge. Rules and the
 * merge switch are one section with one revision, so both are drafts in this
 * Card until "保存". The rule dialog edits that draft, not a stored record,
 * which is why it has no URL of its own (see the design trade-offs).
 */
export function ApprovalChainCard({
  initial,
  departments,
  options,
}: {
  readonly initial: Snapshot<Value>;
  readonly departments: readonly DepartmentOption[];
  readonly options: SettingsOptions;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('approvalChain', initial);
  const [draft, setDraft] = useState<Value>(initial.value);
  const [editing, setEditing] = useState<{
    open: boolean;
    rule: ChainRule | null;
  }>({ open: false, rule: null });
  const [removing, setRemoving] = useState<{
    open: boolean;
    rule: ChainRule | null;
  }>({ open: false, rule: null });
  const [confirmReload, setConfirmReload] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(section.snapshot.value);
  const departmentTitle = (id: string) =>
    departments.find((d) => d.id === id)?.label ?? id;
  const departmentLabel = (id: string | null | undefined) =>
    id ? departmentTitle(id) : '';
  const setTitle = (key: string) => {
    const set = options.permissionSets.find((s) => s.key === key);
    return set
      ? typeof set.title === 'string'
        ? titleText(set.title, t)
        : isDescriptor(set.title)
          ? t(set.title.key, { ns: set.title.ns })
          : key
      : key;
  };
  const approverText = (rule: ChainRule) =>
    rule.approver.type === 'departmentHead'
      ? t('personnelSettings.approverHeadOf', {
          department: departmentTitle(rule.approver.departmentId),
        })
      : rule.approver.type === 'user'
        ? t('personnelSettings.approverUser')
        : t('personnelSettings.approverSet', {
            set: setTitle(rule.approver.key),
          });
  const move = (index: number, by: number) =>
    setDraft((d) => {
      const rules = [...d.rules];
      const [rule] = rules.splice(index, 1);
      if (rule) rules.splice(index + by, 0, rule);
      return { ...d, rules };
    });

  async function save() {
    const saved = await section.save(draft);
    if (saved) setDraft(saved.value);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('personnelSettings.approvalChain.title')}</CardTitle>
          <CardDescription>
            {t('personnelSettings.approvalChain.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {section.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{section.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className='flex items-center gap-2'>
            <Checkbox
              id='chain-merge'
              checked={draft.mergeAdjacent}
              disabled={section.busy}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, mergeAdjacent: checked === true }))
              }
            />
            <Label htmlFor='chain-merge'>
              {t('personnelSettings.mergeAdjacent')}
            </Label>
          </div>
          {draft.rules.length ? (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12'>
                      {t('personnelSettings.ruleOrder')}
                    </TableHead>
                    <TableHead>{t('personnelSettings.ruleName')}</TableHead>
                    <TableHead>
                      {t('personnelSettings.ruleDepartment')}
                    </TableHead>
                    <TableHead>{t('personnelSettings.ruleTypes')}</TableHead>
                    <TableHead>{t('personnelSettings.ruleApprover')}</TableHead>
                    <TableHead>{t('personnelSettings.rulePosition')}</TableHead>
                    <TableHead>{t('personnelSettings.ruleEnabled')}</TableHead>
                    <TableHead className='w-12'>
                      <span className='sr-only'>
                        {t('talent.common.actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.rules.map((rule, index) => (
                    <TableRow key={rule.id}>
                      <TableCell className='tabular-nums'>
                        {index + 1}
                      </TableCell>
                      <TableCell className='font-medium'>{rule.name}</TableCell>
                      <TableCell>
                        {departmentTitle(rule.departmentId)}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {rule.actionTypes.map((type) => (
                            <Badge key={type} variant='secondary'>
                              {t(`talent.actionType.${type}`)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>{approverText(rule)}</TableCell>
                      <TableCell>
                        {t(`personnelSettings.position.${rule.position}`)}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.enabled}
                          disabled={section.busy}
                          aria-label={t('personnelSettings.ruleEnabledFor', {
                            name: rule.name,
                          })}
                          onCheckedChange={(checked) =>
                            setDraft((d) => ({
                              ...d,
                              rules: d.rules.map((r) =>
                                r.id === rule.id
                                  ? { ...r, enabled: checked }
                                  : r,
                              ),
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                disabled={section.busy}
                                aria-label={t('personnelSettings.ruleMenu', {
                                  name: rule.name,
                                })}
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onClick={() => setEditing({ open: true, rule })}
                            >
                              <PencilIcon />
                              {t('talent.common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUpIcon />
                              {t('personnelSettings.moveUp')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={index === draft.rules.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDownIcon />
                              {t('personnelSettings.moveDown')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant='destructive'
                              onClick={() => setRemoving({ open: true, rule })}
                            >
                              <Trash2Icon />
                              {t('personnelSettings.deleteRule')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              title={t('personnelSettings.rulesEmpty')}
              description={t('personnelSettings.rulesEmptyDescription')}
            />
          )}
        </CardContent>
        <CardFooter className='justify-end gap-2'>
          {section.conflict ? (
            <Button
              type='button'
              variant='outline'
              disabled={section.busy}
              onClick={() => setConfirmReload(true)}
            >
              {t('personnelSettings.reload')}
            </Button>
          ) : null}
          <Button
            type='button'
            variant='outline'
            disabled={section.busy}
            onClick={() => setEditing({ open: true, rule: null })}
          >
            <PlusIcon data-icon='inline-start' />
            {t('personnelSettings.addRule')}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={section.busy || section.conflict || !dirty}
            onClick={() => void save()}
          >
            {section.saving ? <Spinner data-icon='inline-start' /> : null}
            {t(section.saving ? 'personnelSettings.saving' : 'actions.save')}
          </Button>
        </CardFooter>
      </Card>
      {/* The preview follows the saved chain; it says so while this Card has unsaved edits. */}
      <ChainPreviewCard
        departments={departments}
        dirtyChain={dirty}
        departmentTitle={departmentLabel}
        revision={section.snapshot.revision}
      />
      <RuleDialog
        open={editing.open}
        rule={editing.rule}
        departments={departments}
        options={options}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
        onSubmit={(rule) => {
          setDraft((d) => ({
            ...d,
            rules: d.rules.some((r) => r.id === rule.id)
              ? d.rules.map((r) => (r.id === rule.id ? rule : r))
              : [...d.rules, rule],
          }));
          setEditing((e) => ({ ...e, open: false }));
        }}
      />
      <AlertDialog
        open={removing.open}
        onOpenChange={(open) => setRemoving((r) => ({ ...r, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('personnelSettings.deleteRuleTitle', {
                name: removing.rule?.name ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('personnelSettings.deleteRuleDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const id = removing.rule?.id;
                setDraft((d) => ({
                  ...d,
                  rules: d.rules.filter((r) => r.id !== id),
                }));
                setRemoving((r) => ({ ...r, open: false }));
              }}
            >
              {t('personnelSettings.deleteRule')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReloadConfirm
        open={confirmReload}
        onOpenChange={setConfirmReload}
        onConfirm={async () => {
          setConfirmReload(false);
          const next = await section.reload();
          if (next) setDraft(next.value);
        }}
      />
    </>
  );
}

function isDescriptor(value: unknown): value is { key: string; ns?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string'
  );
}
