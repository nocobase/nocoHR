import { useTranslation } from '@nocobase/i18n/client';
import { TriangleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { explorerErrorMessage } from './lib/errors.js';
import { describeFields, describeTarget, type FieldRow } from './lib/fields.js';
import type { CollectionPaneContext } from './database-explorer-page.js';
import { DataTable, Loading, Notice } from './parts.js';

/** The Fields pane: what the Collection declares, as the resolver reports it. */
export default function CollectionFieldsPane(): ReactElement {
  const { t } = useTranslation();
  const { detail } = useOutletContext<CollectionPaneContext>();

  if (detail.error) {
    return (
      <div className='p-4'>
        <Notice tone='destructive'>
          {explorerErrorMessage(detail.error, t)}
        </Notice>
      </div>
    );
  }
  if (!detail.value) {
    return (
      <div className='p-4'>
        <Loading label={t('databaseExplorer.states.loading')} />
      </div>
    );
  }

  const fields = describeFields(detail.value.collection.collection);
  const warnings = detail.value.collection.warnings;

  return (
    <>
      {warnings.length > 0 ? (
        <div className='p-4 pb-0'>
          <Notice tone='warning'>
            <span className='flex items-center gap-2 font-medium'>
              <TriangleAlert aria-hidden className='size-4' />
              {t('databaseExplorer.labels.warnings')}
            </span>
            <ul className='mt-1 list-disc pl-5'>
              {warnings.map((warning) => (
                <li key={`${warning.code}:${warning.message}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
      <DataTable
        caption={t('databaseExplorer.tabs.fields')}
        headers={[
          t('databaseExplorer.fields.name'),
          t('databaseExplorer.fields.type'),
          t('databaseExplorer.fields.nullable'),
          t('databaseExplorer.fields.key'),
          t('databaseExplorer.fields.default'),
          t('databaseExplorer.fields.target'),
        ]}
        rows={fields.map((field) => [
          field.name,
          field.type,
          field.nullable
            ? t('databaseExplorer.labels.yes')
            : t('databaseExplorer.labels.no'),
          keyLabel(field, t),
          field.defaultValue ?? '',
          describeTarget(field),
        ])}
        empty={t('databaseExplorer.empty.fields')}
      />
    </>
  );
}

/** Names the strongest key a Field participates in, so one column covers both. */
function keyLabel(field: FieldRow, t: (key: string) => string): string {
  if (field.primaryKey) return t('databaseExplorer.labels.primaryKey');
  if (field.unique) return t('databaseExplorer.labels.unique');
  return '';
}
