// @vitest-environment node
// Recruiting without a factory's assumptions (docs/industry-generality-review.md): the talent-pool search
// uses only the requisition's own words, the loan option's housing risk follows 招聘设置, and new-hire
// check-ins sort replies into industry-neutral topics while check-ins and routing rules recorded with the
// legacy housing / shuttle topics still read.
import { describe, expect, it } from 'vitest';

import { poolSearchWords } from '../../server/providers/hr/recruiting/assistant.ts';
import { classifyReply } from '../../server/providers/hr/recruiting/checkins.ts';
import {
  CHECK_IN_TOPICS,
  checkInRouteFor,
  RECRUITING_SETTINGS_DEFAULTS,
  recruitingSettingsSchema,
} from '../../server/providers/hr/recruiting/config.ts';
import { transferRisks } from '../../server/providers/hr/recruiting/workforce.ts';

// A machining resume as the parser stores it (the shape of parsedProfile).
const CNC_RESUME = JSON.stringify({
  education: [{ level: 'vocational', school: '某技工学校', major: '数控技术' }],
  experiences: [
    {
      summary: '某机械厂 CNC 加工中心操作工 3 年，熟悉数控机床',
      keywords: ['数控车床', 'CNC', '加工中心', '机床'],
    },
  ],
  skills: ['数控车床', '看图纸'],
});

describe('talent-pool search words', () => {
  it('adds no machining words to a requisition that has none', () => {
    const words = poolSearchWords(
      [
        { text: '大专及以上' },
        { text: '1 年以上客服或电话销售经验' },
        { text: '普通话标准，会使用办公软件' },
      ],
      '客户服务专员',
    );
    for (const w of ['数控', 'CNC', '加工中心', '机床'])
      expect(words).not.toContain(w);
    expect(words.filter((w) => CNC_RESUME.includes(w))).toEqual([]);
    expect(words).toContain('客户服务专员');
    expect(words).toContain('客服');
  });

  it('still finds a machining resume from a machining requisition’s own words', () => {
    const words = poolSearchWords(
      [{ text: '1 年以上数控车床或加工中心操作经验' }],
      'CNC 操作工',
    );
    expect(words).toEqual(
      expect.arrayContaining(['数控车床', 'CNC', '操作工']),
    );
    expect(words.filter((w) => CNC_RESUME.includes(w)).length).toBeGreaterThan(
      0,
    );
  });
});

describe('loan option risks', () => {
  it('carries no housing risk by default', () => {
    expect(
      transferRisks(4, 10, RECRUITING_SETTINGS_DEFAULTS.workforce),
    ).toEqual(['partialCover']);
    expect(transferRisks(12, 10, {})).toEqual([]);
  });

  it('carries the housing risk when 招聘设置 turns it on', () => {
    expect(transferRisks(4, 10, { transferHousingRisk: true })).toEqual([
      'partialCover',
      'housing',
    ]);
    // No department can lend: nothing to house.
    expect(transferRisks(0, 10, { transferHousingRisk: true })).toEqual([
      'noSource',
    ]);
  });

  it('reads a settings row saved before the setting existed', () => {
    const stored = structuredClone(RECRUITING_SETTINGS_DEFAULTS);
    expect(recruitingSettingsSchema.safeParse(stored).success).toBe(true);
    stored.workforce.transferHousingRisk = true;
    expect(recruitingSettingsSchema.safeParse(stored).success).toBe(true);
  });
});

describe('new-hire check-in topics', () => {
  it('asks industry-neutral questions by default', () => {
    const questions = RECRUITING_SETTINGS_DEFAULTS.checkIns.questions.join('');
    expect(questions).not.toMatch(/宿舍|车间|班车|师傅/u);
    expect(CHECK_IN_TOPICS).not.toContain('housing');
    expect(CHECK_IN_TOPICS).not.toContain('shuttle');
  });

  it('sorts a reply into the neutral topics', () => {
    const { answers, issues } = classifyReply(
      '地铁通勤要一个半小时太远了；带教的同事很耐心；工作内容和面试时说的不一样；工位的电脑太慢；最近加班太多',
    );
    expect(answers.map((a) => a.topic)).toEqual([
      'commute',
      'mentoring',
      'expectations',
      'environment',
      'workload',
    ]);
    expect(issues.map((i) => i.topic)).toEqual([
      'commute',
      'expectations',
      'environment',
      'workload',
    ]);
  });

  it('puts what used to be housing and the shuttle under commute', () => {
    const { answers } = classifyReply('宿舍离公司很远，下夜班没有班车');
    expect(answers.map((a) => a.topic)).toEqual(['commute', 'commute']);
    expect(classifyReply('排班太乱，周末也要上班').answers[0]?.topic).toBe(
      'schedule',
    );
  });

  it('keeps settings rows and routing rules written with the legacy topics', () => {
    const stored = structuredClone(RECRUITING_SETTINGS_DEFAULTS);
    const legacyRouting = {
      housing: 'user:hr-dorm',
      shuttle: 'hrOwner',
      mentoring: 'departmentHead',
    } as const;
    stored.checkIns.routing = legacyRouting;
    expect(recruitingSettingsSchema.safeParse(stored).success).toBe(true);
    // A new commute issue follows the rule the row kept for housing.
    expect(checkInRouteFor(legacyRouting, 'commute')).toBe('user:hr-dorm');
    // A legacy issue keeps its own rule.
    expect(checkInRouteFor(legacyRouting, 'shuttle')).toBe('hrOwner');
    expect(checkInRouteFor(legacyRouting, 'mentoring')).toBe('departmentHead');
    expect(checkInRouteFor(legacyRouting, 'environment')).toBe('hrOwner');
    expect(
      checkInRouteFor(RECRUITING_SETTINGS_DEFAULTS.checkIns.routing, 'commute'),
    ).toBe('hrOwner');
  });
});
