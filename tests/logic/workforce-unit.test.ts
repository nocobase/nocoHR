// @vitest-environment node
// 用工计划 without a factory's unit (docs/industry-generality-review.md): the quantities of a workforce plan count
// in 招聘设置's `workforce.unitLabel`. A new install has none and reads as the neutral 单位; the 启衡精密 demo gets
// 件 from the gated seed 202610220101, which fills only an unset unit. The HR assistant's rule text and its prompt
// use the configured unit and never a hard-coded 件.
import type { SeedContext } from '@nocobase/db';
import { afterEach, describe, expect, it } from 'vitest';

import demoUnitSeed from '../../database/main/seeds/202610220101_demo_workforce_unit.ts';
import {
  workforceRuleNotes,
  workforceUnitsPrompt,
} from '../../server/providers/hr/recruiting/assistant.ts';
import {
  DEFAULT_WORKFORCE_UNIT,
  RECRUITING_SETTINGS_DEFAULTS,
  recruitingSettingsSchema,
  workforceUnit,
} from '../../server/providers/hr/recruiting/config.ts';
import { INTEGRATION_KEY_DEFAULT_NAME } from '../../server/providers/hr/recruiting/index.ts';

type Plan = Parameters<typeof workforceRuleNotes>[0];

const plan = (transferRisks: string[] = ['partialCover']): Plan =>
  ({
    month: '2026-11',
    departmentTitle: '外卖配送站',
    positionTitle: '骑手',
    calculation: {
      headcount: 18,
      outputPerShift: 100,
      shiftsPerMonth: 22,
      hoursPerShift: 8,
      capacity: 39600,
      plannedOutput: 61600,
      currentOutput: 40000,
      gapOutput: 22000,
      gapHeadcount: 10,
      shortfall: 22000,
      absorbedOvertimeHours: null,
      overtimeLimitHours: 36,
      recruitingCycleDays: 14,
      onboardingDays: 14,
      sources: {
        parameters: 'dep',
        headcount: 'employees',
        overtimeLimit: 'attendanceRule',
        onboarding: 'settings',
        onboardingPathId: null,
      },
    },
    options: [
      {
        type: 'overtime',
        feasible: false,
        detail: { hoursPerPerson: 98, limitHours: 36 },
        risks: ['overLimit'],
        costNote: '',
      },
      {
        type: 'transfer',
        feasible: true,
        detail: { maxHeadcount: 4, covers: false },
        risks: transferRisks,
        costNote: '',
      },
      {
        type: 'hire',
        feasible: true,
        detail: {
          recruitingCycleDays: 14,
          onboardingDays: 14,
          readyInWeeks: 4,
        },
        risks: ['gapBeforeReady'],
        costNote: '',
      },
    ],
  }) as unknown as Plan;

describe('the unit of a workforce plan', () => {
  it('is neutral for a new install', () => {
    expect(RECRUITING_SETTINGS_DEFAULTS.workforce.unitLabel).toBeUndefined();
    expect(workforceUnit(RECRUITING_SETTINGS_DEFAULTS.workforce)).toBe(
      DEFAULT_WORKFORCE_UNIT,
    );
    expect(DEFAULT_WORKFORCE_UNIT).toBe('单位');
    expect(workforceUnit({ unitLabel: '  ' })).toBe('单位');
    expect(workforceUnit({ unitLabel: '单' })).toBe('单');
  });

  it('is accepted by 招聘设置 up to 16 characters', () => {
    const stored = structuredClone(RECRUITING_SETTINGS_DEFAULTS);
    expect(recruitingSettingsSchema.safeParse(stored).success).toBe(true);
    stored.workforce.unitLabel = '床日';
    const parsed = recruitingSettingsSchema.safeParse(stored);
    expect(parsed.success && parsed.data.workforce.unitLabel).toBe('床日');
    stored.workforce.unitLabel = '工'.repeat(17);
    const tooLong = recruitingSettingsSchema.safeParse(stored);
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'workforce.unitLabel',
    ]);
    stored.workforce.unitLabel = '';
    expect(recruitingSettingsSchema.safeParse(stored).success).toBe(false);
  });

  it('names a new integration key without a factory system', () => {
    expect(INTEGRATION_KEY_DEFAULT_NAME).not.toMatch(/ERP|MES|排产/u);
  });
});

describe('the HR assistant’s workforce text', () => {
  it('writes the rule text in the configured unit', () => {
    const notes = workforceRuleNotes(plan(), '单');
    expect(notes.summary).toContain('计划业务量 61,600 单');
    expect(notes.summary).toContain('比本月的 40,000 单增加 21,600 单');
    expect(notes.summary).toContain('人均每班 100 单');
    expect(notes.summary).toContain('可承接 39,600 单');
    expect(notes.summary).toContain('缺口 10 人');
    const all = Object.values(notes).join('');
    expect(all).not.toMatch(/件|产量|可产出/u);
    // Without the housing risk the loan note says nothing about accommodation.
    expect(notes.transfer).not.toContain('住宿');
  });

  it('mentions accommodation only when the loan option carries the housing risk', () => {
    expect(
      workforceRuleNotes(plan(['partialCover', 'housing']), '件').transfer,
    ).toContain('住宿');
  });

  it('tells the model the configured unit', () => {
    const prompt = workforceUnitsPrompt('床日');
    expect(prompt).toContain('床日/班');
    expect(prompt).not.toContain('件');
  });
});

/** A personnelSettings table of one row behind the few query-builder calls the seed makes. */
function fakeQuery(initial: { value: unknown; revision: number } | undefined) {
  const state = { row: initial ? structuredClone(initial) : undefined };
  const query = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ executeTakeFirst: async () => state.row }),
      }),
    }),
    updateTable: () => ({
      set: (values: { value: unknown; revision: number }) => ({
        where: () => ({
          execute: async () => {
            state.row = { value: values.value, revision: values.revision };
          },
        }),
      }),
    }),
  };
  return { state, context: { query } as unknown as SeedContext };
}

const demoRow = (workforce: Record<string, unknown>) => ({
  value: JSON.stringify({
    ...RECRUITING_SETTINGS_DEFAULTS,
    workforce: {
      ...RECRUITING_SETTINGS_DEFAULTS.workforce,
      capacity: [
        {
          departmentId: 'cd-mc',
          positionId: 'pos-cnc-operator',
          outputPerShift: 100,
          shiftsPerMonth: 22,
          hoursPerShift: 8,
        },
      ],
      ...workforce,
    },
  }),
  revision: 1,
});

describe('demo seed 202610220101', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    HR_DEMO_SEED: process.env.HR_DEMO_SEED,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const unitOf = (row: { value: unknown } | undefined) =>
    (row?.value as { workforce?: { unitLabel?: string } } | undefined)
      ?.workforce?.unitLabel;

  it('gives the demo row 件 while its unit was never saved', async () => {
    delete process.env.HR_DEMO_SEED;
    process.env.NODE_ENV = 'test';
    const { state, context } = fakeQuery(demoRow({}));
    await demoUnitSeed.run(context);
    expect(unitOf(state.row)).toBe('件');
    expect(state.row?.revision).toBe(2);
    // A second run changes nothing.
    await demoUnitSeed.run(context);
    expect(state.row?.revision).toBe(2);
  });

  it('keeps a unit already chosen and leaves other rows alone', async () => {
    process.env.NODE_ENV = 'test';
    const chosen = fakeQuery(demoRow({ unitLabel: '台' }));
    await demoUnitSeed.run(chosen.context);
    expect(
      JSON.parse(String(chosen.state.row?.value)).workforce.unitLabel,
    ).toBe('台');
    const other = fakeQuery(demoRow({ capacity: [] }));
    await demoUnitSeed.run(other.context);
    expect(other.state.row?.revision).toBe(1);
    const none = fakeQuery(undefined);
    await demoUnitSeed.run(none.context);
    expect(none.state.row).toBeUndefined();
  });

  it('is skipped in production and with HR_DEMO_SEED=false', async () => {
    process.env.NODE_ENV = 'production';
    const production = fakeQuery(demoRow({}));
    await demoUnitSeed.run(production.context);
    expect(production.state.row?.revision).toBe(1);
    process.env.NODE_ENV = 'test';
    process.env.HR_DEMO_SEED = 'false';
    const off = fakeQuery(demoRow({}));
    await demoUnitSeed.run(off.context);
    expect(off.state.row?.revision).toBe(1);
  });
});
