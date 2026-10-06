// @vitest-environment node

// A new installation gets industry-neutral defaults in talent development: no manufacturing glossary, synonym
// groups, excluded quality categories or sample questions. The 启衡精密 demo writes its own values through gated
// demo seeds (202610210131, 202610210132); its behaviour is covered by the V4 acceptance tests.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { AUTOMATIONS } from '../../server/providers/hr/automation.ts';
import { POSITION_ISSUE_DEFAULTS } from '../../server/providers/hr/competency-issues.ts';
import { createExamService } from '../../server/providers/hr/exam-service.ts';
import { DEFAULT_QUALITY_RULES } from '../../server/providers/hr/performance/common.ts';
import {
  TALENT_REVIEW_DEFAULTS,
  talentReviewSettingsSchema,
} from '../../server/providers/hr/talent-review/config.ts';
import { topicByRule } from '../../server/providers/hr/talent-review/knowledge.ts';

const FACTORY_WORDS = /CNC|数控|首件|点检|工序|设备故障|作业指导书|上岗证/u;

describe('industry-neutral talent defaults', () => {
  it('the talent review settings carry no glossary and neutral checklist words', () => {
    expect(TALENT_REVIEW_DEFAULTS.glossary).toEqual([]);
    expect(TALENT_REVIEW_DEFAULTS.practicalSectionKeywords).toEqual([
      '操作',
      '步骤',
      '检查',
      '核对',
      '记录',
      '安全',
    ]);
    expect(TALENT_REVIEW_DEFAULTS.practicalCriticalKeywords).toEqual([
      '安全',
      '须',
      '必须',
      '禁止',
      '不得',
      '严禁',
    ]);
    expect(JSON.stringify(TALENT_REVIEW_DEFAULTS)).not.toMatch(FACTORY_WORDS);
  });

  it('a saved row with the demo words still parses (the settings are strict)', () => {
    const parsed = talentReviewSettingsSchema.safeParse({
      glossary: [{ zh: '首件检验', en: 'first article inspection' }],
      practicalSectionKeywords: ['检验', '点检'],
      practicalCriticalKeywords: ['首件'],
    });
    expect(parsed.success).toBe(true);
  });

  it('the alarm topic rule names no machine type', () => {
    expect(topicByRule({ title: 'CNC 报警 E17 后如何复位', content: '' })).toBe(
      '报警 E17 处理',
    );
    expect(topicByRule({ title: 'E205 alarm on the POS', content: '' })).toBe(
      '报警 E205 处理',
    );
    expect(topicByRule({ title: '报销单被退回怎么办？', content: '' })).toBe(
      '报销单被退回怎么办',
    );
  });

  it('no quality category is excluded by default', () => {
    expect(DEFAULT_QUALITY_RULES.excludeCategories).toEqual([]);
  });

  it('every synonym group default is empty', () => {
    const synonyms = AUTOMATIONS.flatMap((task) =>
      Object.entries(task.defaults.params ?? {})
        .filter(([name]) => name === 'synonyms')
        .map(([, value]) => value),
    );
    expect(synonyms.length).toBeGreaterThanOrEqual(3);
    expect(synonyms.every((value) => value === '')).toBe(true);
    expect(POSITION_ISSUE_DEFAULTS.synonyms).toBe('');
  });

  it('the question import template shows neutral sample questions without competency codes', () => {
    const service = createExamService({
      platform: { database: {}, notify: {} },
      learning: {},
    } as never);
    const book = XLSX.read(service.importTemplate(), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      book.Sheets[book.SheetNames[0]],
      { header: 1 },
    );
    expect(rows[0]).toEqual([
      '题型',
      '题干',
      '选项',
      '答案',
      '解析',
      '难度',
      '能力项编码',
    ]);
    expect(rows.slice(1).map((row) => row[0])).toEqual([
      '单选',
      '多选',
      '判断',
      '填空',
      '简答',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(FACTORY_WORDS);
    expect(rows.slice(1).every((row) => !row[6])).toBe(true);
  });
});
