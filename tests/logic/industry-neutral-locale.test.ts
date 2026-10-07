// @vitest-environment node

// NocoHR is meant for every industry; the 启衡精密 manufacturing case is only its demo
// (docs/industry-generality-review.md, section 5). Placeholders, hints, examples and empty states every
// customer reads must not speak one industry's language. Only the demo's own data labels and the
// manufacturing pack's demo pages may: they are listed below, and anything new that matches fails here.
import { describe, expect, it } from 'vitest';

import enUS from '../../client/locales/en-US.ts';
import zhCN from '../../client/locales/zh-CN.ts';
import { itemText } from '../../server/providers/hr/hr-assistant-changes.ts';

const ZH_FACTORY_WORDS =
  /工厂|厂长|车间|产线|班组|CNC|数控|首件|叉车|工单|机加工|整车厂|8D/u;
const EN_FACTORY_WORDS =
  /\b(?:plant|factory|workshop|shop floor|CNC|forklift|work[- ]order|machining|first[- ]article|production line|team leader|8D)s?\b/iu;

/** Keys allowed to name factory things: the demo's data and the manufacturing pack's demo pages. */
const ALLOWED: readonly RegExp[] = [
  // The 启衡精密 departments, as the demo seeds them.
  /^departments\.seed\./u,
  // 设备开工登记 / 叉车出库登记 (/demo/batch-record, /demo/forklift-dispatch): the pack's demo pages, their
  // permission set and the development-only action that prepares the demo's certificates.
  /^demo\.batch\./u,
  /^licensed\.forklift\./u,
  /^licensed\.authz\.forklift$/u,
  /^licensed\.settings\.prepareDescription$/u,
  /^navigation\.demoForkliftDispatch$/u,
  /^permissionSets\.forkliftOperator$/u,
  // 工单 here is a service ticket (质量 / 工单 / 项目 signals, the ticketing integration), not a work order.
  /^talent\.insights\.signals\.(?:description|sources\.ticket|types\.ticket[A-Za-z]+)$/u,
  /^talent\.insights\.teamDashboard\.trendHint$/u,
  /^permissionSets\.hrTicketIntegration$/u,
];

function leaves(
  resource: Record<string, unknown>,
  prefix = '',
): [string, string][] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object')
      return leaves(value as Record<string, unknown>, path);
    return typeof value === 'string' ? [[path, value] as [string, string]] : [];
  });
}

function factoryWording(
  resource: Record<string, unknown>,
  words: RegExp,
): string[] {
  return leaves(resource)
    .filter(([, text]) => words.test(text))
    .filter(([path]) => !ALLOWED.some((allowed) => allowed.test(path)))
    .map(([path, text]) => `${path}: ${text}`);
}

describe('industry-neutral interface wording', () => {
  it('the Chinese interface names no factory things outside the demo', () => {
    expect(
      factoryWording(
        zhCN as unknown as Record<string, unknown>,
        ZH_FACTORY_WORDS,
      ),
    ).toEqual([]);
  });

  it('the English interface names no factory things outside the demo', () => {
    const resource = enUS as unknown as Record<string, unknown>;
    expect([
      ...factoryWording(resource, EN_FACTORY_WORDS),
      // English strings may quote Chinese names (department names, examples).
      ...factoryWording(resource, ZH_FACTORY_WORDS),
    ]).toEqual([]);
  });
});

describe('the external account item names the directory in use', () => {
  const disable = (params: Record<string, string>) =>
    itemText({ code: 'externalAccountDisable', params });

  it('names the directory the account was synchronized from', () => {
    expect(disable({ date: '2026-10-31', provider: 'dingtalk' })).toBe(
      '钉钉账号需在离职日 2026-10-31 停用',
    );
    expect(disable({ date: '2026-10-31', provider: 'wecom' })).toBe(
      '企业微信账号需在离职日 2026-10-31 停用',
    );
  });

  it('keeps Feishu for items written before the directory was recorded', () => {
    expect(disable({ date: '2026-10-31' })).toBe(
      '飞书账号需在离职日 2026-10-31 停用',
    );
  });

  it('names no vendor for an unknown directory', () => {
    expect(disable({ date: '2026-10-31', provider: '' })).toBe(
      '办公软件账号需在离职日 2026-10-31 停用',
    );
  });
});
