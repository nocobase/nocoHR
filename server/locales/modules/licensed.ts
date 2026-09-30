/**
 * V4-14 行业方案 · 持证上岗: the server-produced wording — notices and the new
 * permission-set title. Office-suite pushes of these notices carry names,
 * certification titles and a link only: never a certificate number, an ID
 * number or a mobile number. Merged into server/locales/{en-US,zh-CN}.ts.
 */

const n = (title: string, body: string) => ({ title, body });

export const licensedServerEn = {
  permissionSets: {
    forkliftOperator: 'Forklift dispatch',
  },
  notifications: {
    certificateIssuedWithSets: n(
      'Certificate issued',
      '{{name}} is now certified: {{title}} ({{no}}), valid until {{date}}. It now allows: {{sets}}.',
    ),
    certificateExpiringWithSets: n(
      'Certificate expiring soon',
      "{{name}}'s {{title}} expires on {{date}}. After it expires, these can no longer be used: {{sets}}.",
    ),
    externalCertificateVerifiedWithSets: n(
      'External certificate verified',
      'Your {{title}} was verified and now counts as a valid certificate. It now allows: {{sets}}.',
    ),
    licensedTransferCheck: n(
      'Qualification check after a job change: {{name}}',
      '{{content}}',
    ),
    scheduleQualificationConflict: n(
      'A scheduled shift needs a certificate: {{name}} {{date}}',
      '{{name}} is scheduled on {{date}} but holds no valid {{certifications}} through the end of the shift (certificate expiry: {{expiresAt}}). The HR assistant is suggesting certified cover; the schedule has not been changed.',
    ),
  },
};

export const licensedServerZh: typeof licensedServerEn = {
  permissionSets: {
    forkliftOperator: '叉车出库登记',
  },
  notifications: {
    certificateIssuedWithSets: n(
      '证书已发放',
      '{{name}} 已取得《{{title}}》（{{no}}），有效期至 {{date}}。现在可以使用：{{sets}}。',
    ),
    certificateExpiringWithSets: n(
      '证书即将到期',
      '{{name}} 的《{{title}}》将于 {{date}} 到期。到期后将不能使用：{{sets}}。',
    ),
    externalCertificateVerifiedWithSets: n(
      '外部证书已核验',
      '你的《{{title}}》已核验通过，计入有效持证。现在可以使用：{{sets}}。',
    ),
    licensedTransferCheck: n('调岗资质检查：{{name}}', '{{content}}'),
    scheduleQualificationConflict: n(
      '排班缺少有效证书：{{name}} {{date}}',
      '{{name}} 排在 {{date}} 的班次要求{{certifications}}，但到班次结束时没有有效证书（证书到期日：{{expiresAt}}）。人事助理正在推荐持证的顶班人选，排班本身没有被修改。',
    ),
  },
};
