import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  EXTENSIBLE_COLLECTIONS,
  fieldLabel,
  type CustomFieldDefinition,
  type ExtensibleCollection,
} from '@/components/talent/custom-field-model';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';

import { FieldDialog } from './field-dialog.js';

type AdminDefinition = CustomFieldDefinition & { filled: number };

/**
 * 设置 / 字段管理 (V1-01, 总纲 可定制约定): the fields administrators add to a
 * business table and where each appears. V1 opens 员工档案; V3-08 adds the
 * framework tables (能力项、能力等级、岗位能力要求), whose fields appear only
 * on 详情 and 列表. The server's EXTENSIBLE_COLLECTIONS is the list. Fields are deactivated, never deleted, so stored values
 * keep their meaning.
 */
export default function CustomFieldsPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [collection, setCollection] =
    useState<ExtensibleCollection>('employees');
  const remote = useRemote<AdminDefinition[]>('talent/custom-fields', {
    collection,
  });
  const [editing, setEditing] = useState<AdminDefinition | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<AdminDefinition | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function setActive(definition: AdminDefinition, active: boolean) {
    setBusy(true);
    try {
      await api.request({
        path: `talent/custom-fields/${definition.id}/active`,
        method: 'POST',
        json: { active },
      });
      toast.add({
        type: 'success',
        title: t(
          active ? 'customFields.activated' : 'customFields.deactivated',
          {
            label: fieldLabel(definition, i18n.language),
          },
        ),
      });
      remote.reload();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setBusy(false);
      setDeactivating(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('customFields.title')}
        description={t('customFields.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon data-icon='inline-start' />
            {t('customFields.add')}
          </Button>
        }
      />
      <Field className='max-w-xs'>
        <FieldLabel htmlFor='custom-field-collection'>
          {t('customFields.collectionLabel')}
        </FieldLabel>
        <NativeSelect
          id='custom-field-collection'
          value={collection}
          onChange={(e) =>
            setCollection(e.target.value as ExtensibleCollection)
          }
        >
          {EXTENSIBLE_COLLECTIONS.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {t(`customFields.collections.${c}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !remote.data ? (
        <BlockSkeleton rows={4} />
      ) : !remote.data.length ? (
        <Card>
          <CardContent className='py-10 text-center text-sm text-muted-foreground'>
            {t('customFields.empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className='overflow-x-auto p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('customFields.columns.label')}</TableHead>
                  <TableHead>{t('customFields.columns.type')}</TableHead>
                  <TableHead>{t('customFields.columns.placements')}</TableHead>
                  <TableHead>{t('customFields.columns.flags')}</TableHead>
                  <TableHead>{t('customFields.columns.filled')}</TableHead>
                  <TableHead>{t('customFields.columns.status')}</TableHead>
                  <TableHead className='text-right'>
                    {t('customFields.columns.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remote.data.map((definition) => (
                  <TableRow key={definition.id}>
                    <TableCell className='font-medium'>
                      {fieldLabel(definition, i18n.language)}
                      {definition.required ? (
                        <span className='text-muted-foreground'> *</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {t(`customFields.types.${definition.type}`)}
                    </TableCell>
                    <TableCell className='max-w-72 text-sm text-muted-foreground'>
                      {definition.placements
                        .map((p) => t(`customFields.placements.${p}`))
                        .join('、') || '—'}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1'>
                        {definition.sensitive ? (
                          <Badge variant='outline'>
                            {t('customFields.sensitive')}
                          </Badge>
                        ) : null}
                        {definition.aiReadable ? (
                          <Badge variant='outline'>
                            {t('customFields.aiReadable')}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{definition.filled}</TableCell>
                    <TableCell>
                      <Badge
                        variant={definition.active ? 'secondary' : 'outline'}
                      >
                        {t(
                          definition.active
                            ? 'customFields.active'
                            : 'customFields.inactive',
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setEditing(definition)}
                        >
                          {t('talent.common.edit')}
                        </Button>
                        {definition.active ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={busy}
                            onClick={() => setDeactivating(definition)}
                          >
                            {t('customFields.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={busy}
                            onClick={() => void setActive(definition, true)}
                          >
                            {t('customFields.activate')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {editing ? (
        <FieldDialog
          collection={collection}
          definition={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            remote.reload();
          }}
        />
      ) : null}
      <AlertDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('customFields.deactivateTitle', {
                label: deactivating
                  ? fieldLabel(deactivating, i18n.language)
                  : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('customFields.deactivateDescription', {
                count: deactivating?.filled ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deactivating && void setActive(deactivating, false)
              }
            >
              {t('customFields.deactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
