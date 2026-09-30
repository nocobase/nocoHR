/**
 * 入职生效 (V2-07, 第二步 jobEvents onboard whose actionId is an offer's
 * onboarding action). Registered as the job-event handler
 * `recruiting.onboard`, so each event is handled once (the processor stamps
 * it, and `preboarding.onboardedEventId` guards a retry):
 *
 * - the resume and a consent record become employee attachments (resume /
 *   consent); the candidate's uploads become idCard / other attachments, and
 *   what the HR assistant read from them becomes a pending `source=ai`
 *   change request for HR to confirm (第二步 附件识别 · 待确认);
 * - hr.payroll is told that 待建档 holds a salary file pre-filled from the
 *   offer (source=offer), written only when a payroll specialist confirms;
 * - the requisition's hiredCount grows, and it is filled at headcount;
 * - the offer's link stops working.
 *
 * Leave balances (V2-05) and the onboarding path (V3-09) have their own
 * handlers on the same event.
 */
import { scopeForUser } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { JobEvent } from '../job-events.js';
import { HrError, newId, str } from '../shared.js';
import { authorizeAction } from '../authorize.js';
import { iso, localDateTime } from './common.js';
import type { RecruitingContext } from './context.js';
import type { OfferService, OfferView } from './offers.js';
import type { RequisitionService } from './requisitions.js';
import { COMPOSITE } from './resources.js';

const UPLOAD_CATEGORY: Record<string, string> = {
  idCard: 'idCard',
  bankCard: 'other',
  diploma: 'diploma',
};

export function createOnboarding(
  ctx: RecruitingContext,
  deps: { offers: OfferService; requisitions: RequisitionService },
) {
  const { database, platform } = ctx;

  async function offerForAction(actionId: string): Promise<OfferView | undefined> {
    const row = await database
      .query()
      .selectFrom('offers')
      .select(['id'])
      .where('onboardActionId', '=', actionId)
      .executeTakeFirst();
    return row ? deps.offers.get(str(row.id)) : undefined;
  }

  async function attach(
    employeeId: string,
    fileId: string,
    category: string,
    title: string,
  ) {
    const now = new Date();
    await database
      .query()
      .insertInto('employeeAttachments')
      .values({
        id: newId(),
        employeeId,
        fileId,
        category,
        title: title.slice(0, 250),
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  const service = {
    async handle(event: JobEvent): Promise<void> {
      if (event.eventType !== 'onboard' || !event.actionId) return;
      const offer = await offerForAction(event.actionId);
      if (!offer || offer.preboarding.onboardedEventId) return;
      const { candidate, requisition } = await deps.offers.context(offer);
      const t = await ctx.translate();
      // 简历与授权记录转入员工档案附件.
      if (candidate.resumeFileId)
        await attach(
          event.employeeId,
          candidate.resumeFileId,
          'resume',
          t('recruiting.onboard.resumeTitle'),
        );
      const consent = [
        t('recruiting.onboard.consentTitle'),
        `${t('recruiting.onboard.consentAt')}: ${candidate.consentAt ? localDateTime(candidate.consentAt, platform.timeZone) : '—'}`,
        `${t('recruiting.onboard.consentBy')}: ${t(`recruiting.consentBy.${candidate.consentBy || 'page'}`)}`,
        `${t('recruiting.onboard.consentChannel')}: ${candidate.sourceChannel}`,
      ].join('\n');
      const consentFile = await ctx.storeFile({
        name: 'consent.txt',
        bytes: new TextEncoder().encode(consent),
        mimeType: 'text/plain',
        folder: 'consents',
      });
      await attach(
        event.employeeId,
        consentFile,
        'consent',
        t('recruiting.onboard.consentTitle'),
      );
      for (const upload of offer.preboarding.uploads)
        await attach(
          event.employeeId,
          upload.fileId,
          UPLOAD_CATEGORY[upload.kind] ?? 'other',
          t(`recruiting.uploads.${upload.kind}`),
        );
      // 识别结果写入待确认信息, confirmed by HR in 信息修改审核.
      const suggestionIds: string[] = [];
      const owner =
        (await ctx.ownerOf('hrAssistant.preboarding')) ??
        (await ctx.hrAdministrators())[0];
      if (owner) {
        const actor: ActorContext = {
          userId: owner,
          authz: await scopeForUser(platform.authz, owner),
        };
        for (const s of offer.preboarding.suggestions) {
          if (s.status !== 'pending' || !Object.keys(s.fields).length) continue;
          const fields = Object.fromEntries(
            Object.entries(s.fields)
              .filter(([name]) => ['idNumber', 'birthDate', 'gender', 'address'].includes(name))
              .map(([name, f]) => [name, f]),
          );
          if (!Object.keys(fields).length) continue;
          const created = await ctx
            .core()
            .createAiSuggestion(actor, {
              employeeId: event.employeeId,
              attachmentFileId: s.fileId,
              fields,
            })
            .catch((error: unknown) => {
              ctx.log({ error, offerId: offer.id }, 'Onboarding suggestion failed');
              return null;
            });
          if (created) suggestionIds.push(created.id);
        }
      }
      const now = new Date();
      await database
        .query()
        .updateTable('offers')
        .set({
          preboarding: {
            ...offer.preboarding,
            suggestionIds: [...offer.preboarding.suggestionIds, ...suggestionIds],
            onboardedAt: now.toISOString(),
            onboardedEventId: event.id,
          },
          tokenHash: null,
          linkToken: null,
          updatedAt: now,
        })
        .where('id', '=', offer.id)
        .execute();
      // 第六步“待建档”中按 Offer 预填薪资档案，通知 hr.payroll 确认.
      await platform.notify({
        key: `recruitingPayrollPrefill:${event.id}`,
        userIds: await ctx.holdersOf('hr.payroll'),
        message: 'recruitingPayrollPrefill',
        params: { date: event.effectiveDate.slice(0, 10) },
        path: `/talent/salaries?tab=pending&employee=${event.employeeId}`,
      });
      await deps.requisitions.countHire(requisition.id);
    },

    /** 待建档 · 按 Offer 预填: the salary the offer promised, for a payroll specialist. */
    async salaryPrefill(actor: ActorContext, employeeId: string) {
      await authorizeAction(actor.authz, 'talent.salary', 'manage');
      await authorizeAction(actor.authz, COMPOSITE.offer, 'viewSalary');
      const offer = await offerForEmployee(employeeId);
      if (!offer?.salaryOffer) return null;
      const existing = await database
        .query()
        .selectFrom('employeeSalaries')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .executeTakeFirst();
      return {
        offerId: offer.id,
        employeeId,
        effectiveMonth: offer.startDate.slice(0, 7),
        baseSalary: offer.salaryOffer.baseSalary,
        fixedAllowances: offer.salaryOffer.allowances,
        salaryStructureId: offer.salaryOffer.salaryStructureId,
        startDate: offer.startDate,
        onboardedAt: iso(offer.preboarding.onboardedAt),
        filed: Boolean(existing),
      };
    },

    /** 确认后写入: payroll's own file creation, with source=offer. */
    async confirmSalaryPrefill(actor: ActorContext, employeeId: string, input: unknown) {
      const prefill = await service.salaryPrefill(actor, employeeId);
      if (!prefill) throw new HrError('OFFER_NOT_FOUND', 404);
      if (prefill.filed) throw new HrError('SALARY_MONTH_TAKEN', 409);
      const body =
        input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      return ctx.payroll().salaries.createFile(actor, {
        employeeId,
        effectiveMonth: prefill.effectiveMonth,
        baseSalary:
          typeof body.baseSalary === 'number' ? body.baseSalary : prefill.baseSalary,
        fixedAllowances: prefill.fixedAllowances,
        salaryStructureId: prefill.salaryStructureId,
        ...(body.bankAccount ? { bankAccount: body.bankAccount } : {}),
        source: 'offer',
      });
    },
  };
  return service;

  async function offerForEmployee(employeeId: string) {
    const events = await database
      .query()
      .selectFrom('jobEvents')
      .select(['actionId'])
      .where('employeeId', '=', employeeId)
      .where('eventType', '=', 'onboard')
      .execute();
    for (const e of events) {
      if (!e.actionId) continue;
      const offer = await offerForAction(str(e.actionId));
      if (offer) return offer;
    }
    return undefined;
  }
}

export type Onboarding = ReturnType<typeof createOnboarding>;
