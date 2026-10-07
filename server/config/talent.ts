import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

import { isDemoEnvironment } from './demo.js';

/**
 * Talent platform parameters an administrator may adjust in config.yml under
 * `talent`. Changing a schedule takes effect after a restart. The AI
 * employees' proactive work has its own run times, switches and owners,
 * edited in Settings → AI 自动化.
 */
export interface TalentConfig {
  /** The time zone the daily and weekly schedules and "today" use. */
  readonly timeZone: string;
  /** Daily HR maintenance: personnel actions, reminders, learning and certificate lifecycle. */
  readonly dailyCron: string;
  /**
   * The employer's name: printed on certificates, offer letters and departed
   * employees' documents, and in the subject of the mails that carry them.
   * Required in production; empty by default except in the 启衡精密 demo.
   */
  readonly companyName: string;
  /**
   * How an exam result becomes a competency level (V1 defaults): only
   * competencies worth at least `minWeight` of the paper count; a score rate
   * of `fullRate` or more records the position's required level, `partialRate`
   * or more records one level below it, and a lower rate records nothing. An
   * exam never lowers a higher existing level.
   */
  readonly examCompetency: {
    readonly minWeight: number;
    readonly fullRate: number;
    readonly partialRate: number;
  };
}

const DEMO_COMPANY_NAME = '启衡精密科技';

const talent: AppConfigFactory<TalentConfig> = defineAppConfig<TalentConfig>({
  defaults: ({ env }) => ({
    timeZone: 'Asia/Shanghai',
    dailyCron: '0 9 * * *',
    // The demo company was once everyone's default and reached production certificates and mails.
    companyName: isDemoEnvironment(env) ? DEMO_COMPANY_NAME : '',
    examCompetency: { minWeight: 0.2, fullRate: 0.9, partialRate: 0.7 },
  }),
  env: { TALENT_COMPANY_NAME: envString('companyName') },
  validate: (value, context) => {
    if (value.companyName?.trim()) return;
    // A certificate or a separation certificate that names no employer is not a document a company can issue, so
    // production refuses to start without it; elsewhere it is only a reminder.
    const message =
      "is empty, so certificates, offer letters and departed employees' documents name no employer.";
    const options = {
      fix: 'pnpm nocobase config set talent.companyName "<company name>"',
    };
    if (process.env.NODE_ENV === 'production')
      context.error('companyName', message, options);
    else context.warning('companyName', message, options);
  },
});

export default talent;
