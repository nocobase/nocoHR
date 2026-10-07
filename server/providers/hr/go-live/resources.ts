/**
 * 上线准备 (go-live checklist): who sees which steps.
 *
 * - `talent.goLive` · view: the HR steps (公司信息与系统配置, 部门, 岗位, 员工,
 *   劳动合同, 期初假期余额, 员工账号开通) — hr.admin.
 * - `talent.goLive` · viewPayroll: the payroll steps (薪资档案, 社保参保,
 *   专项附加扣除, 本年个税累计期初, 试算一期工资) as counts only, never an
 *   amount — hr.admin and hr.payroll.
 * - `talent.goLive` · skip / skipPayroll: mark a step of that kind as not
 *   needed (stored in the personnelSettings row `goLive`) — hr.admin and
 *   hr.payroll respectively.
 *
 * The page itself is the page resource `talent.goLive` (granted to both sets
 * by seed 202610270121). Account activation reuses `talent.employee` ·
 * linkUser: the HR who may link and reset employee accounts.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from '../shared.js';

export const GO_LIVE = 'talent.goLive';
export const GO_LIVE_PAGE = 'talent.goLive';

const SETTINGS_FIELDS = [
  'id',
  'value',
  'revision',
  'updatedBy',
  'createdAt',
  'updatedAt',
];

const read = defineDatabasePermission((p) =>
  p
    .collection('personnelSettings')
    .title(label('goLive.authz.settings'))
    .read(SETTINGS_FIELDS),
);
const write = defineDatabasePermission((p) =>
  p
    .collection('personnelSettings')
    .title(label('goLive.authz.settings'))
    .read(SETTINGS_FIELDS)
    .create(SETTINGS_FIELDS)
    .update(['value', 'revision', 'updatedBy', 'updatedAt']),
);

export const goLiveResource = defineCompositeResource(GO_LIVE, (r) =>
  r
    .title(label('goLive.authz.title'))
    .action('view', (a) =>
      a.title(label('goLive.authz.view')).grant('personnelSettings', read),
    )
    .action('viewPayroll', (a) =>
      a
        .title(label('goLive.authz.viewPayroll'))
        .grant('personnelSettings', read),
    )
    .action('skip', (a) =>
      a.title(label('goLive.authz.skip')).grant('personnelSettings', write),
    )
    .action('skipPayroll', (a) =>
      a
        .title(label('goLive.authz.skipPayroll'))
        .grant('personnelSettings', write),
    ),
);
