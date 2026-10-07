// @vitest-environment node

// NocoHR serves every industry; the 启衡精密 manufacturing case is only its demo. The AI employees' prompts,
// greetings and descriptions, the tool descriptions and the texts written when AI is off must not use one
// industry's vocabulary as their examples. The 持证上岗 industry pack (V4-14) is the exception: its tools and the
// part of the 认证管家 prompt it appends trace the demo's work orders and dispatch notes by design.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { z } from 'zod';

import AppAIResources from '../../server/ai/index.ts';
import { createSignalService } from '../../server/providers/hr/profile/signals.ts';

const FACTORY_WORDS = [
  'CNC',
  '数控',
  '车间',
  '厂长',
  '整车厂',
  '首件',
  '8D',
  '叉车',
  '机加工',
  '工单',
];

/** The industry pack's own tools (licensed-tools.ts, and the older trace kept in exam-tools.ts). */
const PACK_TOOLS = new Set([
  'traceBatchSignoffs',
  'traceStartLogs',
  'getCertificationGrants',
  'listCertificatesNotRequired',
  'sendTransferCheckNotice',
]);

/** The prompt part the 持证上岗 pack appends to the 认证管家. */
const PACK_PROMPT_MARK = '行业方案 · 持证上岗';

/**
 * Words a tool names on purpose: draftSettingsChange lists role words of several industries
 * (厂长 / 院长 / 店长 / 区域经理) so the model reads each as the head of that unit.
 */
const ALLOWED: Record<string, readonly string[]> = {
  draftSettingsChange: ['厂长'],
};

function found(text: string, allowed: readonly string[] = []): string[] {
  return FACTORY_WORDS.filter((w) => !allowed.includes(w) && text.includes(w));
}

interface EmployeeLike {
  username: string;
  nickname?: string;
  position?: string;
  description?: string;
  bio?: string;
  greeting?: string;
  systemPrompt?: unknown;
}

interface ToolLike {
  introduction?: unknown;
  definition: { name: string; description?: string; schema?: unknown };
}

async function registered() {
  const employees: EmployeeLike[] = [];
  const tools: ToolLike[] = [];
  const resources = Object.create(AppAIResources.prototype) as {
    registerAIEmployees(manager: unknown): Promise<void>;
    registerTools(manager: unknown): Promise<void>;
  };
  await resources.registerAIEmployees({
    registerEmployee: async (e: EmployeeLike) => void employees.push(e),
  });
  await resources.registerTools({
    registerTools: async (list: ToolLike[]) => void tools.push(...list),
    registerTool: async (t: ToolLike) => void tools.push(t),
  });
  return { employees, tools };
}

function schemaText(schema: unknown): string {
  if (schema && typeof schema === 'object' && '_zod' in schema)
    try {
      return JSON.stringify(z.toJSONSchema(schema as z.ZodType));
    } catch {
      return '';
    }
  return JSON.stringify(schema ?? null);
}

/** Source text without full-line and block comments. */
function code(path: string): string {
  return readFileSync(resolve(__dirname, '../..', path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('industry-neutral AI prompts', () => {
  it('the employees’ prompts, greetings and descriptions carry no factory-only words', async () => {
    const { employees } = await registered();
    expect(employees.length).toBeGreaterThanOrEqual(10);
    const hits: string[] = [];
    for (const e of employees) {
      let prompt = String(e.systemPrompt ?? '');
      const pack = prompt.indexOf(PACK_PROMPT_MARK);
      if (pack >= 0) prompt = prompt.slice(0, pack);
      const text = [
        e.nickname,
        e.position,
        e.description,
        e.bio,
        e.greeting,
        prompt,
      ].join('\n');
      for (const w of found(text)) hits.push(`${e.username}: ${w}`);
    }
    expect(hits).toEqual([]);
  });

  it('the pack keeps its work-order instructions in the part it appends', async () => {
    const { employees } = await registered();
    const steward = employees.find(
      (e) => e.username === 'certificationSteward',
    );
    const prompt = String(steward?.systemPrompt ?? '');
    expect(prompt).toContain(PACK_PROMPT_MARK);
    expect(prompt.slice(prompt.indexOf(PACK_PROMPT_MARK))).toContain(
      'traceBatchSignoffs',
    );
  });

  it('the tool descriptions and parameter hints carry no factory-only words', async () => {
    const { tools } = await registered();
    expect(tools.length).toBeGreaterThan(50);
    const hits: string[] = [];
    const texts = new Map<string, string>();
    for (const t of tools) {
      const name = t.definition.name;
      const text = [
        JSON.stringify(t.introduction ?? null),
        t.definition.description ?? '',
        schemaText(t.definition.schema),
      ].join('\n');
      texts.set(name, text);
      if (PACK_TOOLS.has(name)) continue;
      for (const w of found(text, ALLOWED[name])) hits.push(`${name}: ${w}`);
    }
    // The scan reads parameter hints (.describe) as well as descriptions.
    expect(texts.get('createAuditRequestFromMail')).toContain('上海运营中心');
    expect(hits).toEqual([]);
  });

  it('the prompts and fallback texts written outside the employees carry no factory-only words', () => {
    const files = [
      'server/ai/tools/profile-tools.ts',
      'server/ai/tools/payroll-tools.ts',
      'server/providers/hr/practice-service.ts',
      'server/providers/hr/training-automation.ts',
      'server/providers/hr/hr-assistant-attendance.ts',
      'server/providers/hr/payroll/assistant.ts',
      'server/providers/hr/ai-entry-service.ts',
      'server/providers/hr/automation-tasks.ts',
      'server/providers/hr/profile/analyst.ts',
      'server/providers/hr/profile/decisions.ts',
      'server/providers/hr/profile/audit.ts',
      'server/providers/hr/talent-review/translations.ts',
    ];
    const hits = files.flatMap((f) => found(code(f)).map((w) => `${f}: ${w}`));
    expect(hits).toEqual([]);
  });

  it('the business data import template names the corrective action generically and shows a neutral row', () => {
    const service = createSignalService(
      { platform: { database: {} } } as never,
      {} as never,
      { onQualityMatched: () => undefined },
    );
    const book = XLSX.read(service.importTemplate(), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      book.Sheets[book.SheetNames[0]],
      { header: 1 },
    );
    expect(rows[0]).toContain('纠正措施编号');
    expect(found(JSON.stringify(rows))).toEqual([]);
  });
});
