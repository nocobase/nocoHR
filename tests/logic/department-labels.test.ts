import { describe, expect, it } from 'vitest';

import * as client from '../../client/components/talent/department-labels.ts';
import * as server from '../../server/providers/hr/department-labels.ts';

const tree = [
  { id: 'sz', title: '苏州工厂', parentId: null },
  { id: 'sz-mc', title: '机加工车间', parentId: 'sz' },
  { id: 'cd', title: '成都工厂', parentId: null },
  { id: 'cd-mc', title: '机加工车间', parentId: 'cd' },
  { id: 'cd-asm', title: '成都装配车间', parentId: 'cd' },
  { id: 'east', title: '东院区', parentId: null },
  { id: 'east-er', title: '急诊科', parentId: 'east' },
  { id: 'west', title: '西院区', parentId: null },
  { id: 'west-er', title: '急诊科', parentId: 'west' },
  { id: 'west-icu', title: '重症医学科', parentId: 'west' },
  { id: 'store', title: '南京西路店', parentId: null },
  { id: 'store-cash', title: '收银组', parentId: 'store' },
];
const label = (id: string, separator?: string) =>
  server.qualifiedDepartmentTitle(
    tree.find((d) => d.id === id)!,
    tree,
    separator,
  );

describe('department labels', () => {
  it('qualifies a name shared by several units with its parent, in any industry', () => {
    expect(label('sz-mc')).toBe('苏州工厂机加工车间');
    expect(label('cd-mc', ' · ')).toBe('成都工厂 · 机加工车间');
    expect(label('east-er')).toBe('东院区急诊科');
    expect(label('west-er')).toBe('西院区急诊科');
  });

  it('leaves a unique name, and a name already carrying its unit, as it is', () => {
    expect(label('west-icu')).toBe('重症医学科');
    expect(label('store-cash')).toBe('收银组');
    expect(label('cd-asm')).toBe('成都装配车间');
    expect(label('sz')).toBe('苏州工厂');
  });

  it('strips the unit word for the short name', () => {
    expect(server.unitShortName('苏州工厂')).toBe('苏州');
    expect(server.unitShortName('东院区')).toBe('东');
    expect(server.unitShortName('南京西路店')).toBe('南京西路');
    expect(server.unitShortName('华东大区')).toBe('华东');
    expect(server.unitShortName('上海分公司')).toBe('上海');
    expect(server.unitShortName('工厂')).toBe('工厂');
  });

  it('keeps the client copy the same as the server rule', () => {
    for (const d of tree)
      expect(client.qualifiedDepartmentTitle(d, tree, ' · ')).toBe(
        label(d.id, ' · '),
      );
  });
});
