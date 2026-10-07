// @vitest-environment node

// V3-08 新岗位自动起草: 每项注明出自说明书哪一条. The job description and duties are numbered clause by clause,
// the model's clause references are checked against them, the rule-based fallback matches competencies to clauses,
// and migration 202610240001 adds and removes the column the references are stored in.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SOLUTION_MANAGER_JD,
  WORKSHOP_LEAD_JD,
} from '../../database/seed-data/demo-competency.ts';
import {
  clauseKey,
  clauseListing,
  describeSourceClauses,
  matchClauses,
  numberClauses,
  positionClauses,
  readSourceClauses,
  resolveSourceClauses,
} from '../../server/providers/hr/jd-clauses.ts';

describe('numberClauses', () => {
  it('numbers the clauses of a job description, skipping headings and keeping the section and item', () => {
    const clauses = numberClauses(SOLUTION_MANAGER_JD.join('\n'), 'jd');
    // The title and the 一、二、三、 headings are not clauses.
    expect(clauses.map((c) => c.text)).not.toContain(
      '销售解决方案经理岗位说明书',
    );
    expect(clauses.some((c) => c.text.includes('岗位职责'))).toBe(false);
    expect(clauses.map((c) => c.number)).toEqual(clauses.map((_, i) => i + 1));
    const quote = clauses.find((c) => c.text.startsWith('方案设计与报价'));
    expect(quote).toMatchObject({
      source: 'jd',
      section: '岗位职责',
      item: '2',
    });
    const requirement = clauses.find((c) =>
      c.text.includes('熟悉制动系统产品'),
    );
    expect(requirement).toMatchObject({ section: '任职要求', item: '2' });
    expect(clauseKey(quote!)).toBe(`J${quote!.number}`);
    expect(clauseListing(clauses)).toContain(
      `J${quote!.number}. 【岗位职责 2】方案设计与报价`,
    );
  });

  it('breaks an inline numbered list into clauses', () => {
    const clauses = numberClauses(WORKSHOP_LEAD_JD, 'duties');
    expect(clauses).toHaveLength(6);
    expect(clauses[0]).toMatchObject({
      number: 1,
      item: '1',
      section: '车间主任岗位职责',
    });
    expect(clauses[5].text).toContain('每周向工厂负责人汇报');
  });

  it('keeps a one-line duty as a clause', () => {
    expect(numberClauses('负责首件检验与巡检', 'duties')).toEqual([
      {
        source: 'duties',
        number: 1,
        section: null,
        item: null,
        text: '负责首件检验与巡检',
      },
    ]);
    expect(numberClauses('', 'jd')).toEqual([]);
  });

  it('numbers the job description and the duties separately', () => {
    const clauses = positionClauses({
      jdText: '1. 甲。\n2. 乙。',
      responsibilities: '丙。',
    });
    expect(clauses.map(clauseKey)).toEqual(['J1', 'J2', 'D1']);
  });
});

describe('resolveSourceClauses', () => {
  const clauses = positionClauses({
    jdText:
      '一、岗位职责\n1. 方案设计与报价：完成成本测算与报价。\n2. 跨部门协调。',
    responsibilities: '维护重点客户关系。',
  });

  it('keeps known numbers, takes quotes from the clause and drops the rest', () => {
    const resolved = resolveSourceClauses(
      [
        { clause: 'J1', quote: '完成成本测算' },
        { clause: 'J9', quote: '不存在' },
        { clause: 'D1', quote: '一段原文里没有的话' },
        { clause: 'J1', quote: null },
        { clause: 'nonsense' },
      ],
      clauses,
    );
    expect(resolved).toEqual([
      {
        source: 'jd',
        number: 1,
        section: '岗位职责',
        item: '1',
        quote: '完成成本测算',
      },
      // A quote the clause does not contain is replaced by the clause's own words.
      {
        source: 'duties',
        number: 1,
        section: null,
        item: null,
        quote: '维护重点客户关系。',
      },
    ]);
  });

  it('understands 说明书第 N 条 and a bare number, and keeps at most three', () => {
    expect(
      resolveSourceClauses(
        [{ clause: '说明书第 2 条' }, { clause: '1' }, { clause: '职责 1' }],
        clauses,
      ).map(clauseKey),
    ).toEqual(['J2', 'J1', 'D1']);
    const many = positionClauses({ jdText: 'a。\nb。\nc。\nd。' });
    expect(
      resolveSourceClauses(
        ['J1', 'J2', 'J3', 'J4'].map((clause) => ({ clause })),
        many,
      ),
    ).toHaveLength(3);
    expect(resolveSourceClauses(null, clauses)).toEqual([]);
    expect(resolveSourceClauses([{ clause: 'J1' }], [])).toEqual([]);
  });

  it('describes the references for a competency description', () => {
    const [first] = resolveSourceClauses([{ clause: 'J2' }], clauses);
    expect(describeSourceClauses([first])).toBe(
      '依据：说明书第 2 条「跨部门协调。」',
    );
  });

  it('reads a stored value back and ignores malformed entries', () => {
    const stored = resolveSourceClauses([{ clause: 'J1' }], clauses);
    expect(readSourceClauses(JSON.stringify(stored))).toEqual(stored);
    expect(readSourceClauses(stored)).toEqual(stored);
    expect(readSourceClauses(null)).toBeNull();
    expect(readSourceClauses('not json')).toBeNull();
    expect(readSourceClauses([{ source: 'x', number: 1 }])).toBeNull();
  });
});

describe('matchClauses', () => {
  const clauses = numberClauses(SOLUTION_MANAGER_JD.join('\n'), 'jd');

  it('matches a competency title or a four-character span of it', () => {
    expect(
      matchClauses('制动系统产品知识', clauses).map((c) => c.item),
    ).toContain('2');
    expect(
      matchClauses('客户关系管理', clauses).some((c) =>
        c.text.includes('重点客户关系维护'),
      ),
    ).toBe(true);
    expect(matchClauses('焊接工艺', clauses)).toEqual([]);
    expect(matchClauses('', clauses)).toEqual([]);
  });
});

describe('migration 202610240001_position_requirement_source_clauses', () => {
  it('adds sourceClauses to positionRequirements and removes it again', async () => {
    const { createDatabaseManager, InMemoryCollectionMetadataStore } =
      await import('@nocobase/db');
    const { sqlite } = await import('@nocobase/db-sqlite');
    const migrations = path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    );
    const name = '202610240001_position_requirement_source_clauses';
    const names = readdirSync(migrations)
      .filter((file) => /^\d{12}_.+\.ts$/u.test(file))
      .map((file) => file.replace(/\.ts$/u, ''))
      .sort();
    const previous = names[names.indexOf(name) - 1];
    const folder = mkdtempSync(path.join(tmpdir(), 'hr-source-clauses-'));
    const database = createDatabaseManager({
      default: 'main',
      connections: {
        main: sqlite({
          filename: path.join(folder, 'test.sqlite'),
          schemaManagement: 'managed',
        }),
      },
      metadataStore: new InMemoryCollectionMetadataStore(),
    });
    try {
      const migrator = database.createMigrator({
        directory: migrations,
        packageName: 'hr',
      });
      await migrator.upTo(previous);
      const fields = async () =>
        (
          (await database.collections().get('positionRequirements'))?.fields ??
          []
        ).map((f) => f.name);
      expect(await fields()).not.toContain('sourceClauses');
      expect((await migrator.upTo(name)).executed).toEqual([name]);
      expect(await fields()).toContain('sourceClauses');
      expect((await migrator.rollback()).rolledBack).toEqual([name]);
      expect(await fields()).not.toContain('sourceClauses');
      expect(await fields()).toContain('customFields');
    } finally {
      await database.destroy();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
