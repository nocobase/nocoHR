/**
 * 公开页面 (V2-07): the careers page, the conversational application and
 * self-booking, and the offer page. No sign-in; every call carries only
 * what it needs:
 *
 * - the careers page lists published postings when 招聘设置 enables it, and
 *   never reads any other data; applying can only create a candidate and an
 *   application; the resume is checked for type and size;
 * - the conversation is a fixed flow (knockout questions, then the form) —
 *   no model is called here;
 * - one address may apply ipLimitPerHour times an hour; beyond that a
 *   verification question must be answered;
 * - an application to a self-booking posting gets a booking link for its own
 *   interview, which it may reschedule or cancel once;
 * - an offer link shows that offer's letter and takes the answer before its
 *   deadline; after acceptance it serves 待入职跟进 until the onboarding
 *   takes effect.
 */
import { createHash, randomInt } from 'node:crypto';

import { HrError, newId, str } from '../shared.js';
import type { CandidateService, UploadedFile } from './candidates.js';
import { fill, localDateTime, sha256 } from './common.js';
import type { RecruitingContext } from './context.js';
import type { InterviewService } from './interviews.js';
import type { OfferService } from './offers.js';
import type { PostingService, PostingView } from './postings.js';
import type { RequisitionService } from './requisitions.js';

const HOUR = 3_600_000;
const UPLOAD_KINDS = ['idCard', 'bankCard', 'diploma'] as const;

export function createPublicService(
  ctx: RecruitingContext,
  deps: {
    postings: PostingService;
    requisitions: RequisitionService;
    candidates: CandidateService;
    interviews: InterviewService;
    offers: OfferService;
    onUpload: (offerId: string, fileId: string) => void;
  },
) {
  const { database, platform } = ctx;
  const attempts = new Map<string, number[]>();
  const challenges = new Map<string, { answer: string; expires: number }>();

  async function enabled() {
    const settings = await ctx.settings();
    if (!settings.publicPage.enabled)
      throw new HrError('PUBLIC_PAGE_DISABLED', 404);
    return settings;
  }

  async function publishedBySlug(slug: string): Promise<PostingView> {
    if (!/^[\w-]{4,64}$/u.test(slug))
      throw new HrError('POSTING_NOT_FOUND', 404);
    const row = await database
      .query()
      .selectFrom('jobPostings')
      .select(['id'])
      .where('publicSlug', '=', slug)
      .where('status', '=', 'published')
      .executeTakeFirst();
    if (!row) throw new HrError('POSTING_NOT_FOUND', 404);
    return deps.postings.get(str(row.id));
  }

  async function openSlots(posting: PostingView) {
    const counts = await deps.postings.bookedCounts(posting.id);
    const now = Date.now();
    return posting.interviewSlots
      .filter((s) => new Date(s.start).getTime() > now + HOUR)
      .filter((s) => (counts.get(s.start) ?? 0) < s.capacity)
      .map((s) => ({
        start: s.start,
        end: s.end,
        location: s.location,
        label: localDateTime(s.start, platform.timeZone),
      }));
  }

  /** 同一 IP 每小时最多投递 N 次: beyond it the caller must answer a question. */
  function throttle(
    ip: string,
    limit: number,
    challenge?: { id?: string; answer?: string },
  ) {
    const key = createHash('sha256').update(ip).digest('hex').slice(0, 32);
    const now = Date.now();
    const recent = (attempts.get(key) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= limit) {
      const solved =
        challenge?.id &&
        challenges.get(challenge.id) &&
        challenges.get(challenge.id)!.expires > now &&
        challenges.get(challenge.id)!.answer ===
          String(challenge.answer ?? '').trim();
      if (!solved) {
        const a = randomInt(1, 10);
        const b = randomInt(1, 10);
        const id = newId();
        challenges.set(id, {
          answer: String(a + b),
          expires: now + 10 * 60_000,
        });
        for (const [k, v] of challenges)
          if (v.expires < now) challenges.delete(k);
        throw new HrError('PUBLIC_VERIFY_REQUIRED', 409, {
          challengeId: id,
          question: `${a} + ${b} = ?`,
        });
      }
      challenges.delete(challenge.id!);
    }
    recent.push(now);
    attempts.set(key, recent);
  }

  async function bookingContext(token: string) {
    if (!/^[\w-]{20,64}$/u.test(token))
      throw new HrError('BOOKING_LINK_INVALID', 404);
    const row = await database
      .query()
      .selectFrom('applications')
      .select(['id'])
      .where('bookingTokenHash', '=', sha256(token))
      .executeTakeFirst();
    if (!row) throw new HrError('BOOKING_LINK_INVALID', 404);
    const application = await deps.candidates.applicationRow(str(row.id));
    const posting = await deps.postings.get(application.postingId);
    if (!posting.selfBookingEnabled || posting.status !== 'published')
      throw new HrError('BOOKING_CLOSED', 409);
    const interview = await database
      .query()
      .selectFrom('interviews')
      .select(['id'])
      .where('applicationId', '=', application.id)
      .where('selfBooked', '=', true)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return {
      application,
      posting,
      interview: interview
        ? await deps.interviews.get(str(interview.id))
        : null,
    };
  }

  async function confirmBooking(
    posting: PostingView,
    applicationId: string,
    interviewId: string,
    token: string,
  ) {
    const application = await deps.candidates.applicationRow(applicationId);
    const candidate = await deps.candidates.candidateRow(
      application.candidateId,
    );
    const interview = await deps.interviews.get(interviewId);
    const template = posting.bookingTemplate;
    if (!candidate.email || !template) return 'skipped';
    // 自助约面的确认: the template the recruiter confirmed; time, place and the reschedule link only.
    const t = await ctx.translate();
    const values = {
      name: candidate.name,
      position: posting.title,
      time: localDateTime(interview.scheduledAt, platform.timeZone),
      location: interview.locationOrLink ?? '',
      link: ctx.publicUrl(`/jobs/booking/${token}`),
    };
    return ctx.sendEmail({
      key: `booking:${interviewId}`,
      to: candidate.email,
      subject: fill(
        t('recruiting.templates.bookingConfirmation.subject'),
        values,
      ),
      body: `${fill(template.body, values)}\n\n${fill(t('recruiting.templates.bookingConfirmation.footer'), values)}`,
    });
  }

  const service = {
    async jobs() {
      await enabled();
      const rows = await database
        .query()
        .selectFrom('jobPostings')
        .select([
          'id',
          'title',
          'location',
          'publicSlug',
          'publishedAt',
          'requisitionId',
        ])
        .where('status', '=', 'published')
        .orderBy('publishedAt', 'desc')
        .execute();
      return {
        items: await Promise.all(
          rows.map(async (r) => ({
            slug: str(r.publicSlug),
            title: str(r.title),
            location: str(r.location),
          })),
        ),
      };
    },

    async job(slug: string) {
      const settings = await enabled();
      const posting = await publishedBySlug(slug);
      const definitions = await deps.candidates.customFieldDefinitions();
      const t = await ctx.translate();
      return {
        slug,
        title: posting.title,
        description: posting.description,
        location: posting.location,
        requirements: posting.requirements.map((r) => ({
          text: r.text,
          mustHave: r.mustHave,
        })),
        questions: posting.knockoutQuestions.map((q) => ({
          key: q.key,
          question: q.question,
          answerType: q.answerType,
          options: q.options ?? [],
        })),
        selfBooking: posting.selfBookingEnabled,
        maxResumeMb: settings.publicPage.maxResumeMb,
        consentText: t('recruiting.public.consent', {
          company: ctx.companyName(),
          months: String(settings.retention.months),
        }),
        // Added candidate fields marked for the careers page (追加字段 · 公开投递).
        fields: ctx
          .customFields()
          .visible(definitions, { sensitive: false, placement: 'publicApply' })
          .map((d) => ({
            key: d.key,
            label: d.label,
            type: d.type,
            options: d.options,
            required: d.required,
          })),
      };
    },

    async apply(
      slug: string,
      input: {
        ip: string;
        name: string;
        phone: string;
        email: string;
        consent: boolean;
        answers: Record<string, string>;
        customFields: Record<string, unknown>;
        file: UploadedFile | null;
        challengeId?: string;
        challengeAnswer?: string;
      },
    ) {
      const settings = await enabled();
      const posting = await publishedBySlug(slug);
      if (!input.consent) throw new HrError('CANDIDATE_CONSENT_REQUIRED', 400);
      if (!input.name.trim()) throw new HrError('CANDIDATE_NAME_REQUIRED', 400);
      if (!input.file) throw new HrError('RESUME_REQUIRED', 400);
      for (const q of posting.knockoutQuestions)
        if (!input.answers[q.key]?.trim())
          throw new HrError('KNOCKOUT_ANSWER_REQUIRED', 400, { key: q.key });
      throttle(input.ip, settings.publicPage.ipLimitPerHour, {
        id: input.challengeId,
        answer: input.challengeAnswer,
      });
      const mimeType = await deps.candidates.validateResume(input.file, true);
      const definitions = ctx
        .customFields()
        .visible(await deps.candidates.customFieldDefinitions(), {
          sensitive: false,
          placement: 'publicApply',
        });
      const customFields = definitions.length
        ? ctx
            .customFields()
            .prepare(
              definitions,
              input.customFields,
              {},
              { enforceRequired: true },
            )
        : {};
      const outcome = await deps.candidates.intake({
        posting,
        name: input.name,
        phone: input.phone,
        email: input.email,
        file: { ...input.file, mimeType },
        sourceChannel: 'careersPage',
        consentBy: 'page',
        knockoutAnswers: Object.entries(input.answers).map(([key, answer]) => ({
          key,
          answer,
        })),
        customFields,
        by: 'candidate',
      });
      let bookingToken: string | null = null;
      if (posting.selfBookingEnabled)
        bookingToken = await deps.candidates.issueBookingToken(
          outcome.applicationId,
        );
      return {
        received: true,
        merged: !outcome.created,
        bookingToken,
        slots: bookingToken ? await openSlots(posting) : [],
      };
    },

    async booking(token: string) {
      const { posting, interview } = await bookingContext(token);
      return {
        title: posting.title,
        booked: interview
          ? {
              start: interview.scheduledAt,
              label: localDateTime(interview.scheduledAt, platform.timeZone),
              location: interview.locationOrLink,
              canChange:
                interview.changesUsed < 1 &&
                new Date(interview.scheduledAt).getTime() > Date.now(),
            }
          : null,
        slots: await openSlots(posting),
      };
    },

    /** 候选人自选面试时段: the choice is the interview; a full slot is no longer offered. */
    async book(token: string, start: string) {
      const { application, posting, interview } = await bookingContext(token);
      if (interview) throw new HrError('BOOKING_EXISTS', 409);
      return service.bookSlot(application.id, posting, start, token, 0);
    },

    async bookSlot(
      applicationId: string,
      posting: PostingView,
      start: string,
      token: string,
      changesUsed: number,
    ) {
      const slot = posting.interviewSlots.find(
        (s) => s.start === new Date(start).toISOString(),
      );
      if (!slot) throw new HrError('BOOKING_SLOT_UNKNOWN', 400);
      if (!(await openSlots(posting)).some((s) => s.start === slot.start))
        throw new HrError('BOOKING_SLOT_FULL', 409);
      const requisition = await deps.requisitions.get(posting.requisitionId);
      const id = await deps.interviews.createTrusted({
        applicationId,
        mode: 'onsite',
        scheduledAt: slot.start,
        durationMinutes: Math.max(
          10,
          Math.round(
            (new Date(slot.end).getTime() - new Date(slot.start).getTime()) /
              60_000,
          ),
        ),
        locationOrLink: slot.location,
        interviewerUserIds: slot.interviewerUserIds,
        slotKey: slot.start,
        selfBooked: true,
        by: requisition.recruiterUserId ?? 'candidate',
      });
      // Two candidates took the last seat at once: the later one is undone.
      const counts = await deps.postings.bookedCounts(posting.id);
      if ((counts.get(slot.start) ?? 0) > slot.capacity) {
        await database
          .query()
          .deleteFrom('interviews')
          .where('id', '=', id)
          .execute();
        throw new HrError('BOOKING_SLOT_FULL', 409);
      }
      if (changesUsed)
        await database
          .query()
          .updateTable('interviews')
          .set({ changesUsed })
          .where('id', '=', id)
          .execute();
      const delivery = await confirmBooking(posting, applicationId, id, token);
      return {
        booked: true,
        start: slot.start,
        label: localDateTime(slot.start, platform.timeZone),
        delivery,
      };
    },

    /** 改期或取消一次, before the interview starts. */
    async change(token: string, input: { cancel?: boolean; start?: string }) {
      const { application, posting, interview } = await bookingContext(token);
      if (!interview) throw new HrError('BOOKING_NOT_FOUND', 404);
      if (
        interview.changesUsed >= 1 ||
        new Date(interview.scheduledAt).getTime() <= Date.now()
      )
        throw new HrError('BOOKING_CHANGE_USED', 409);
      await database
        .query()
        .updateTable('interviews')
        .set({ status: 'cancelled', changesUsed: 1, updatedAt: new Date() })
        .where('id', '=', interview.id)
        .execute();
      if (input.cancel || !input.start) return { cancelled: true };
      return service.bookSlot(application.id, posting, input.start, token, 1);
    },

    // ---------- Offer 回复与待入职跟进 ----------

    async offer(token: string) {
      const offer = await deps.offers.byToken(token);
      const c = await deps.offers.context(offer);
      const settings = await ctx.settings();
      return {
        name: c.candidate.name,
        position: (await ctx.position(offer.positionId))?.title ?? '',
        department: await ctx.departmentTitle(offer.departmentId),
        company: ctx.companyName(),
        startDate: offer.startDate,
        probationMonths: offer.probationMonths,
        status: offer.status,
        respondBy: offer.respondBy,
        expired:
          offer.status === 'sent' &&
          Boolean(offer.respondBy) &&
          new Date(offer.respondBy!) < new Date(),
        hasLetter: Boolean(offer.offerLetterFileId),
        preboarding:
          offer.status === 'accepted'
            ? {
                arrivalConfirmedAt: offer.preboarding.arrivalConfirmedAt,
                uploads: offer.preboarding.uploads.map((u) => ({
                  kind: u.kind,
                  uploadedAt: u.uploadedAt,
                })),
                kinds: UPLOAD_KINDS,
                maxMb: settings.publicPage.maxResumeMb,
              }
            : null,
      };
    },

    async offerLetter(token: string) {
      const offer = await deps.offers.byToken(token);
      if (!offer.offerLetterFileId) throw new HrError('OFFER_NOT_FOUND', 404);
      const file = await ctx.readFile(offer.offerLetterFileId);
      if (!file) throw new HrError('OFFER_NOT_FOUND', 404);
      return file;
    },

    async respond(
      token: string,
      input: { accept: boolean; reason?: string | null },
    ) {
      const offer = await deps.offers.byToken(token);
      await deps.offers.respondTrusted(
        offer,
        input.accept,
        'link',
        input.reason ?? null,
        'candidate',
      );
      return service
        .offer(token)
        .catch(() => ({ status: input.accept ? 'accepted' : 'declined' }));
    },

    async confirmArrival(token: string) {
      const offer = await deps.offers.byToken(token);
      if (offer.status !== 'accepted')
        throw new HrError('OFFER_NOT_ACCEPTED', 409);
      if (!offer.preboarding.arrivalConfirmedAt)
        await database
          .query()
          .updateTable('offers')
          .set({
            preboarding: {
              ...offer.preboarding,
              arrivalConfirmedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where('id', '=', offer.id)
          .execute();
      return service.offer(token);
    },

    /** 候选人通过专属链接上传证件与银行卡照片 (本人材料 only). */
    async upload(token: string, kind: string, file: UploadedFile) {
      const offer = await deps.offers.byToken(token);
      if (offer.status !== 'accepted')
        throw new HrError('OFFER_NOT_ACCEPTED', 409);
      if (!(UPLOAD_KINDS as readonly string[]).includes(kind))
        throw new HrError('INVALID_INPUT', 400);
      const settings = await ctx.settings();
      if (file.bytes.byteLength > settings.publicPage.maxResumeMb * 1024 * 1024)
        throw new HrError('RESUME_TOO_LARGE', 400);
      const ext = file.name.toLowerCase().split('.').pop() ?? '';
      const types: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      if (!types[ext]) throw new HrError('UPLOAD_TYPE_INVALID', 400);
      const fileId = await ctx.storeFile({
        name: file.name,
        bytes: file.bytes,
        mimeType: types[ext],
        folder: 'preboarding',
      });
      await database
        .query()
        .updateTable('offers')
        .set({
          preboarding: {
            ...offer.preboarding,
            uploads: [
              ...offer.preboarding.uploads,
              {
                kind: kind as (typeof UPLOAD_KINDS)[number],
                fileId,
                uploadedAt: new Date().toISOString(),
              },
            ],
          },
          updatedAt: new Date(),
        })
        .where('id', '=', offer.id)
        .execute();
      deps.onUpload(offer.id, fileId);
      return service.offer(token);
    },
  };
  return service;
}

export type PublicService = ReturnType<typeof createPublicService>;
