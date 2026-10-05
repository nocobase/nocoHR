/**
 * 待入职跟进 (V2-07, 人事助理). Between an accepted offer and the start date:
 *
 * - on the configured days before the start (default 3 and 1) the
 *   candidate gets the reminder email — time, place, materials and their own
 *   link only — once the recruiter confirmed the template when sending the
 *   offer; each day's reminder is sent once;
 * - an arrival still unconfirmed on the escalation day (default the day
 *   before) tells the recruiter, with a link to the candidate;
 * - an uploaded document (ID card, bank card, diploma) is read by the HR
 *   assistant into fields waiting for HR (shown on the onboarding draft,
 *   written to the record only when HR confirms after the onboarding takes
 *   effect). Text documents only: an image needs a model that reads images,
 *   which is recorded as the reason.
 */
import { z } from 'zod';

import { AIUnavailableError } from '../ai-runner.js';
import type { AutomationRunContext } from '../automation.js';
import { daysBetween, newId, str } from '../shared.js';
import { fill } from './common.js';
import type { RecruitingContext } from './context.js';
import type { OfferService, Preboarding } from './offers.js';
import { extractResumeText } from './resume-text.js';
import type { Templates } from './templates.js';

export const PREBOARDING_TASK = 'hrAssistant.preboarding';
export const PREBOARDING_EXTRACT = 'hrAssistant.preboardingExtract';

const fieldSchema = z.object({
  value: z.string().max(200),
  confidence: z.number().min(0).max(1),
  snippet: z.string().max(200),
});

function ruleRead(kind: string, text: string) {
  const fields: Record<string, { value: string; confidence: number; snippet: string }> = {};
  const line = (pattern: RegExp) =>
    text.split('\n').find((l) => pattern.test(l))?.trim() ?? '';
  if (kind === 'idCard') {
    const id = /(?<!\d)(\d{6})(\d{4})(\d{2})(\d{2})\d{2}(\d)[\dXx](?!\d)/u.exec(text);
    const name = /姓\s*名\s*[:：]?\s*([一-龥·]{2,20})/u.exec(text);
    if (name) fields.name = { value: name[1], confidence: 0.8, snippet: name[0].slice(0, 60) };
    if (id) {
      fields.idNumber = { value: id[0], confidence: 0.9, snippet: line(/\d{17}[\dXx]/u).slice(0, 60) };
      fields.birthDate = { value: `${id[2]}-${id[3]}-${id[4]}`, confidence: 0.85, snippet: '由证件号推算' };
      fields.gender = { value: Number(id[5]) % 2 ? 'male' : 'female', confidence: 0.8, snippet: '由证件号推算' };
    }
    const address = /住\s*址\s*[:：]?\s*(.{4,80})/u.exec(text);
    if (address) fields.address = { value: address[1].trim(), confidence: 0.7, snippet: address[0].slice(0, 80) };
  } else if (kind === 'bankCard') {
    const account = /(?<!\d)(\d{4}\s?\d{4}\s?\d{4}\s?\d{4}(?:\s?\d{1,3})?)(?!\d)/u.exec(text);
    const bank = /([一-龥]{2,12}银行)/u.exec(text);
    if (account)
      fields.bankAccountNo = { value: account[1].replace(/\s/gu, ''), confidence: 0.8, snippet: '卡号' };
    if (bank) fields.bankName = { value: bank[1], confidence: 0.8, snippet: bank[0] };
  } else if (kind === 'diploma') {
    const school = /([一-龥]{2,30}(?:学校|学院|大学))/u.exec(text);
    if (school) fields.school = { value: school[1], confidence: 0.7, snippet: school[0] };
  }
  return fields;
}

export function createPreboarding(
  ctx: RecruitingContext,
  deps: { offers: OfferService; templates: Templates },
) {
  const { database, platform } = ctx;

  async function write(offerId: string, patch: (p: Preboarding) => Preboarding) {
    const offer = await deps.offers.get(offerId);
    await database
      .query()
      .updateTable('offers')
      .set({ preboarding: patch(offer.preboarding), updatedAt: new Date() })
      .where('id', '=', offerId)
      .execute();
  }

  return {
    write,

    /** The daily scan; returns ids only for the run record. */
    async runDaily(run: AutomationRunContext | null, asOf: string) {
      const settings = await ctx.settings();
      const rows = await database
        .query()
        .selectFrom('offers')
        .select(['id'])
        .where('status', '=', 'accepted')
        .execute();
      const reminded: string[] = [];
      const escalated: string[] = [];
      for (const r of rows) {
        const offer = await deps.offers.get(str(r.id));
        if (offer.preboarding.onboardedAt) continue;
        const days = daysBetween(asOf, offer.startDate);
        if (days < 0) continue;
        const c = await deps.offers.context(offer);
        if (settings.reminders.preboardingDays.includes(days)) {
          const already = offer.preboarding.remindersSent.some((s) => s.day === days);
          if (!already && offer.preboarding.templateConfirmedAt && c.candidate.email) {
            const template = await deps.templates.get('preboarding');
            const token = await deps.offers.linkToken(offer.id);
            const values = {
              name: c.candidate.name,
              date: offer.startDate,
              days: String(days),
              location: await ctx.departmentTitle(offer.departmentId),
              position: (await ctx.position(offer.positionId))?.title ?? '',
              link: token ? ctx.publicUrl(`/offer/${token}`) : '',
            };
            const delivery = await ctx.sendEmail({
              key: `preboarding:${offer.id}:${days}`,
              applicationId: offer.applicationId,
              to: c.candidate.email,
              subject: fill(template.subject, values),
              body: fill(template.body, values),
            });
            await write(offer.id, (p) => ({
              ...p,
              remindersSent: [...p.remindersSent, { day: days, sentAt: new Date().toISOString(), delivery }],
            }));
            reminded.push(offer.id);
          } else if (!already && !offer.preboarding.templateConfirmedAt && c.requisition.recruiterUserId)
            await platform.notify({
              key: `preboardingTemplate:${offer.id}`,
              userIds: [c.requisition.recruiterUserId],
              message: 'recruitingPreboardingTemplate',
              params: { name: c.candidate.name },
              path: `/talent/offers/${offer.id}`,
            });
        }
        // 报到前一天未确认到岗的提醒招聘负责人.
        if (
          days <= settings.reminders.escalateDaysBefore &&
          !offer.preboarding.arrivalConfirmedAt &&
          !offer.preboarding.escalatedAt &&
          c.requisition.recruiterUserId
        ) {
          await platform.notify({
            key: `arrivalUnconfirmed:${offer.id}`,
            userIds: [c.requisition.recruiterUserId],
            message: 'recruitingArrivalUnconfirmed',
            params: { name: c.candidate.name, date: offer.startDate },
            path: `/talent/candidates/${offer.applicationId}`,
          });
          await write(offer.id, (p) => ({ ...p, escalatedAt: new Date().toISOString() }));
          escalated.push(offer.id);
        }
      }
      run?.summarize(`${asOf}: ${reminded.length} reminders, ${escalated.length} escalations`);
      return { reminded, escalated };
    },

    /** 人事助理识别 one uploaded document into fields waiting for HR. */
    async extract(run: AutomationRunContext, offerId: string, fileId: string) {
      const offer = await deps.offers.get(offerId);
      const upload = offer.preboarding.uploads.find((u) => u.fileId === fileId);
      if (!upload) return { status: 'skipped' as const, output: { reason: 'NO_UPLOAD' } };
      if (offer.preboarding.suggestions.some((s) => s.fileId === fileId))
        return { status: 'skipped' as const, output: { reason: 'DONE' } };
      const file = await ctx.readFile(fileId);
      const text = file ? await extractResumeText(file.bytes, file.filename, file.mimeType) : null;
      let fields: Record<string, { value: string; confidence: number; snippet: string }> = {};
      let status: 'pending' | 'failed' = 'pending';
      let reason: string | null = null;
      if (!text) {
        status = 'failed';
        reason = file?.mimeType.startsWith('image/') ? 'IMAGE_NEEDS_VISION_MODEL' : 'UNREADABLE';
      } else {
        fields = ruleRead(upload.kind, text);
        try {
          const shape = upload.kind === 'idCard'
            ? { name: fieldSchema, idNumber: fieldSchema, birthDate: fieldSchema, gender: fieldSchema, address: fieldSchema }
            : upload.kind === 'bankCard'
              ? { bankName: fieldSchema, bankAccountNo: fieldSchema }
              : { school: fieldSchema, degree: fieldSchema };
          const { data } = await ctx.ai.structured({
            employee: 'hrAssistant',
            userId: run.owner.userId,
            title: '入职材料识别',
            prompt: `只提取材料上明确可见的字段，看不清或有歧义的不填（value 为空字符串，confidence 为 0）。gender 取 male/female。\n材料文本：\n${text.slice(0, 4000)}`,
            schema: z.object(shape).partial(),
            timeZone: platform.timeZone,
          });
          for (const [name, value] of Object.entries(data as Record<string, z.infer<typeof fieldSchema> | undefined>))
            if (value?.value && value.confidence > 0) fields[name] = value;
        } catch (error) {
          if (!(error instanceof AIUnavailableError)) throw error;
          run.markFallback();
        }
        if (!Object.keys(fields).length) {
          status = 'failed';
          reason = 'NOTHING_FOUND';
        }
      }
      const suggestion = { id: newId(), fileId, kind: upload.kind, fields, status, reason };
      await write(offerId, (p) => ({ ...p, suggestions: [...p.suggestions, suggestion] }));
      // Fields and values stay off the run record: the offer id and the kind only.
      run.summarize(`offer ${offerId}: ${upload.kind}`);
      const hr = await ctx.hrAdministrators();
      if (status === 'pending')
        await platform.notify({
          key: `preboardingExtract:${offerId}:${fileId}`,
          userIds: hr,
          message: 'recruitingPreboardingExtracted',
          params: { date: offer.startDate },
          path: `/talent/offers/${offerId}/onboard`,
        });
      return { output: { offerId, kind: upload.kind, status } };
    },
  };
}

export type PreboardingService = ReturnType<typeof createPreboarding>;
