import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorCode, errorMessage } from '@/components/talent/errors';
import type { MailPurpose } from '@/components/talent/mail-model';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

interface MailboxSettings {
  enabled: boolean;
  /** The Mail plugin account serving this purpose, and its owner. */
  accountId: string;
  ownerUserId: string;
  allowedSenderDomains: string[];
  retentionDays: number;
  vendors: { domain: string; vendorName: string }[];
}

interface MailSettings {
  channel: string;
  senderName: string;
  redirectTo: string;
  pollMinutes: number;
  allowedAttachmentTypes: string[];
  maxAttachmentMb: number;
  mailboxes: Record<MailPurpose, MailboxSettings>;
}

interface Loaded {
  value: MailSettings;
  revision: number;
  connections: {
    purpose: MailPurpose;
    address: string;
    /** The Mail plugin provider type of the bound account, or none. */
    adapter: 'local-files' | 'imap-smtp' | 'gmail' | 'microsoft' | 'none';
    configured: boolean;
  }[];
}

const list = (text: string): string[] =>
  text
    .split(/[,，\s]+/u)
    .map((s) => s.trim())
    .filter(Boolean);

const vendorsText = (vendors: MailboxSettings['vendors']): string =>
  vendors.map((v) => `${v.domain} = ${v.vendorName}`).join('\n');

const parseVendors = (text: string): MailboxSettings['vendors'] =>
  text
    .split('\n')
    .map((line) => line.split('='))
    .filter((parts) => parts.length >= 2)
    .map(([domain, ...name]) => ({
      domain: domain.trim().toLowerCase(),
      vendorName: name.join('=').trim(),
    }))
    .filter((v) => v.domain && v.vendorName);

/**
 * Route `/settings/mail` (V2-06 设置 / 邮件, HR administrators): what the
 * business mailboxes are used for — the sending channel, the test address
 * outside production, attachment rules and, per mailbox, the sender domains,
 * retention and (billing) which domain is which 派遣公司. Connection details and
 * passwords are application configuration and never shown here.
 */
export default function MailSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<Loaded>('talent/mail/settings');
  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('mailSettings.title')}
        description={t('mailSettings.description')}
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !remote.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        // Mounted again for each revision, so the form starts from what was saved.
        <MailSettingsForm
          key={remote.data.revision}
          loaded={remote.data}
          onSaved={remote.reload}
        />
      )}
    </PageContainer>
  );
}

function textsOf(value: MailSettings): Record<string, string> {
  return {
    types: value.allowedAttachmentTypes.join(', '),
    ...Object.fromEntries(
      Object.entries(value.mailboxes).flatMap(([purpose, m]) => [
        [`domains.${purpose}`, m.allowedSenderDomains.join(', ')],
        [`vendors.${purpose}`, vendorsText(m.vendors)],
      ]),
    ),
  };
}

interface MailAccountOption {
  id: string;
  address: string;
  ownerUserId: string;
  ownerName: string | null;
  provider: string;
  status: string;
}

function MailSettingsForm({
  loaded,
  onSaved,
}: {
  loaded: Loaded;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  // Every connected Mail account (HR administrators): one is bound to each purpose.
  const accounts = useRemote<MailAccountOption[]>('talent/mail/accounts');
  const api = useApiClient();
  const [draft, setDraft] = useState<MailSettings>(loaded.value);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    textsOf(loaded.value),
  );
  const [saving, setSaving] = useState(false);

  function setMailbox(purpose: MailPurpose, patch: Partial<MailboxSettings>) {
    setDraft((d) => ({
      ...d,
      mailboxes: {
        ...d.mailboxes,
        [purpose]: { ...d.mailboxes[purpose], ...patch },
      },
    }));
  }

  async function save(): Promise<void> {
    const value: MailSettings = {
      ...draft,
      allowedAttachmentTypes: list(texts.types ?? '').map((s) =>
        s.toLowerCase(),
      ),
      mailboxes: Object.fromEntries(
        Object.entries(draft.mailboxes).map(([purpose, m]) => [
          purpose,
          {
            ...m,
            allowedSenderDomains: list(texts[`domains.${purpose}`] ?? '').map(
              (s) => s.toLowerCase(),
            ),
            vendors: parseVendors(texts[`vendors.${purpose}`] ?? ''),
          },
        ]),
      ) as MailSettings['mailboxes'],
    };
    setSaving(true);
    try {
      await api.request({
        path: 'talent/mail/settings',
        method: 'PUT',
        json: { revision: loaded.revision, value },
      });
      toast.add({ type: 'success', title: t('mailSettings.saved') });
      onSaved();
    } catch (error) {
      toast.add({
        type: 'error',
        title:
          errorCode(error) === 'SETTINGS_CONFLICT'
            ? t('mailSettings.conflict')
            : errorMessage(error, t),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('mailSettings.sending')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='mail-channel'>
                {t('mailSettings.channel')}
              </FieldLabel>
              <Input
                id='mail-channel'
                value={draft.channel}
                onChange={(e) =>
                  setDraft({ ...draft, channel: e.target.value })
                }
              />
              <FieldDescription>
                {t('mailSettings.channelHint')}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='mail-sender'>
                {t('mailSettings.senderName')}
              </FieldLabel>
              <Input
                id='mail-sender'
                value={draft.senderName}
                onChange={(e) =>
                  setDraft({ ...draft, senderName: e.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='mail-redirect'>
                {t('mailSettings.redirectTo')}
              </FieldLabel>
              <Input
                id='mail-redirect'
                type='email'
                value={draft.redirectTo}
                onChange={(e) =>
                  setDraft({ ...draft, redirectTo: e.target.value })
                }
              />
              <FieldDescription>
                {t('mailSettings.redirectToHint')}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='mail-poll'>
                {t('mailSettings.pollMinutes')}
              </FieldLabel>
              <Input
                id='mail-poll'
                type='number'
                min={1}
                max={1440}
                value={draft.pollMinutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    pollMinutes: Number(e.target.value),
                  })
                }
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('mailSettings.attachments')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='mail-types'>
                {t('mailSettings.attachmentTypes')}
              </FieldLabel>
              <Input
                id='mail-types'
                value={texts.types ?? ''}
                onChange={(e) => setTexts({ ...texts, types: e.target.value })}
              />
              <FieldDescription>
                {t('mailSettings.attachmentTypesHint')}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='mail-max'>
                {t('mailSettings.maxAttachmentMb')}
              </FieldLabel>
              <Input
                id='mail-max'
                type='number'
                min={1}
                max={50}
                value={draft.maxAttachmentMb}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxAttachmentMb: Number(e.target.value),
                  })
                }
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      {loaded.connections.map((connection) => {
        const purpose = connection.purpose;
        const mailbox = draft.mailboxes[purpose];
        return (
          <Card key={purpose}>
            <CardHeader>
              <CardTitle className='flex flex-wrap items-center gap-2'>
                {t(`mail.purposes.${purpose}`)}
                <Badge variant='outline'>
                  {t(`mailSettings.adapters.${connection.adapter}`)}
                </Badge>
              </CardTitle>
              <CardDescription>{connection.address}</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`mail-account-${purpose}`}>
                    {t('mailSettings.account')}
                  </FieldLabel>
                  <NativeSelect
                    id={`mail-account-${purpose}`}
                    value={mailbox.accountId}
                    onChange={(e) => {
                      const account = accounts.data?.find(
                        (a) => a.id === e.target.value,
                      );
                      setMailbox(purpose, {
                        accountId: account?.id ?? '',
                        ownerUserId: account?.ownerUserId ?? '',
                      });
                    }}
                  >
                    <NativeSelectOption value=''>
                      {t('mailSettings.noAccount')}
                    </NativeSelectOption>
                    {(accounts.data ?? []).map((a) => (
                      <NativeSelectOption key={a.id} value={a.id}>
                        {`${a.address}（${a.ownerName ?? a.ownerUserId}）`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {t('mailSettings.accountHint')}
                  </FieldDescription>
                </Field>
                <Field orientation='horizontal'>
                  <Switch
                    id={`mail-enabled-${purpose}`}
                    checked={mailbox.enabled}
                    onCheckedChange={(checked) =>
                      setMailbox(purpose, { enabled: checked })
                    }
                  />
                  <FieldLabel htmlFor={`mail-enabled-${purpose}`}>
                    {t('mailSettings.enabled')}
                  </FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`mail-domains-${purpose}`}>
                    {t('mailSettings.senderDomains')}
                  </FieldLabel>
                  <Input
                    id={`mail-domains-${purpose}`}
                    value={texts[`domains.${purpose}`] ?? ''}
                    onChange={(e) =>
                      setTexts({
                        ...texts,
                        [`domains.${purpose}`]: e.target.value,
                      })
                    }
                  />
                  <FieldDescription>
                    {t('mailSettings.senderDomainsHint')}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`mail-retention-${purpose}`}>
                    {t('mailSettings.retentionDays')}
                  </FieldLabel>
                  <Input
                    id={`mail-retention-${purpose}`}
                    type='number'
                    min={7}
                    max={3650}
                    value={mailbox.retentionDays}
                    onChange={(e) =>
                      setMailbox(purpose, {
                        retentionDays: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                {/* billing: 派遣公司 by sender domain; audit (V3-11): 客户 by sender domain. */}
                {purpose === 'billing' || purpose === 'audit' ? (
                  <Field>
                    <FieldLabel htmlFor={`mail-vendors-${purpose}`}>
                      {purpose === 'billing'
                        ? t('mailSettings.vendors')
                        : t('mailSettings.customers')}
                    </FieldLabel>
                    <Textarea
                      id={`mail-vendors-${purpose}`}
                      rows={3}
                      value={texts[`vendors.${purpose}`] ?? ''}
                      onChange={(e) =>
                        setTexts({
                          ...texts,
                          [`vendors.${purpose}`]: e.target.value,
                        })
                      }
                    />
                    <FieldDescription>
                      {purpose === 'billing'
                        ? t('mailSettings.vendorsHint')
                        : t('mailSettings.customersHint')}
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
        );
      })}
      <div>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner data-icon='inline-start' /> : null}
          {t('mailSettings.save')}
        </Button>
      </div>
    </>
  );
}
