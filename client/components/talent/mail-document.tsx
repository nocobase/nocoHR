/**
 * 人事邮箱 (V1-02 V2 增补 · 已离职员工的邮件往来): what a reply draft to a
 * departed employee will carry. The document and its link are made only when
 * a person sends the reply, so the draft shows which document it is and, for
 * an income certificate, lets payroll check the amounts it will state. The
 * preview answers 403 to everyone else (HR administrators never see amounts),
 * and then nothing about amounts is shown.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { FileTextIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage, isForbidden } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { MailMessage } from './mail-model.js';

/** The documents a reply can carry, as the server names them (server/providers/hr/departed/documents.ts). */
const DOCUMENTS = [
  'separationCertificate',
  'employmentCertificate',
  'incomeCertificate',
  'payslip',
] as const;
type DocumentKind = (typeof DOCUMENTS)[number];

interface IncomeMonth {
  readonly month: string;
  readonly gross: number;
  readonly net: number;
}

function isDocument(value: unknown): value is DocumentKind {
  return (DOCUMENTS as readonly unknown[]).includes(value);
}

/** The document a draft's proposal names, if it is a document reply. */
function documentProposal(
  message: MailMessage,
): { document: DocumentKind; employeeId: string } | null {
  const p = message.proposal;
  return p?.kind === 'document' &&
    isDocument(p.document) &&
    typeof p.employeeId === 'string'
    ? { document: p.document, employeeId: p.employeeId }
    : null;
}

function IncomePreview({
  employeeId,
}: {
  employeeId: string;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // Asked once: a 403 means the viewer may not see amounts, and nothing is shown.
  const preview = useRemote<IncomeMonth[]>(
    `talent/departed/income/${encodeURIComponent(employeeId)}`,
  );
  if (preview.error && isForbidden(preview.error)) return null;
  if (preview.error)
    return (
      <p className='text-sm text-destructive'>
        {errorMessage(preview.error, t)}
      </p>
    );
  if (!preview.data) return null;
  const money = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className='space-y-2'>
      <Button
        variant='outline'
        size='sm'
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('mail.document.hideAmounts') : t('mail.document.showAmounts')}
      </Button>
      {open ? (
        preview.data.length ? (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('mail.document.month')}</TableHead>
                  <TableHead className='text-right'>
                    {t('mail.document.gross')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('mail.document.net')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.data.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {money.format(row.gross)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {money.format(row.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.errors.DOCUMENT_NO_PAYSLIPS')}
          </p>
        )
      ) : null}
    </div>
  );
}

/** Which document a reply draft carries, and that its link is made on send. */
export function MailDocumentProposal({
  message,
}: {
  message: MailMessage;
}): ReactElement | null {
  const { t } = useTranslation();
  const proposal = documentProposal(message);
  if (!proposal) return null;
  const amounts =
    proposal.document === 'incomeCertificate' ||
    proposal.document === 'payslip';
  return (
    <section className='space-y-2 rounded-md border p-3 text-sm'>
      <p className='flex items-center gap-2 font-medium'>
        <FileTextIcon className='size-4 shrink-0 text-muted-foreground' />
        {t('mail.document.attached', {
          document: t(`mail.document.titles.${proposal.document}`),
        })}
      </p>
      <p className='text-muted-foreground'>
        {t('mail.document.linkOnSend')}{' '}
        {amounts ? t('mail.document.payrollSends') : t('mail.document.hrSends')}
      </p>
      {proposal.document === 'incomeCertificate' ? (
        <IncomePreview employeeId={proposal.employeeId} />
      ) : null}
    </section>
  );
}
