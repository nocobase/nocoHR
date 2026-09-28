import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

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
  /** The company name printed on certificates. */
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

const talent: AppConfigFactory<TalentConfig> = defineAppConfig({
  defaults: () => ({
    timeZone: 'Asia/Shanghai',
    dailyCron: '0 9 * * *',
    companyName: '启衡精密科技',
    examCompetency: { minWeight: 0.2, fullRate: 0.9, partialRate: 0.7 },
  }),
});

export default talent;
