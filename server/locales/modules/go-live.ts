/**
 * 上线准备 · 激活链接: the message that carries an employee's activation link
 * (office-suite bot or work email). It names the login and the link only:
 * never a password, an ID number or a mobile number. The stored copy of a
 * mail replaces the link with `linkRemoved`. Merged into
 * server/locales/{en-US,zh-CN}.ts as `goLive`.
 */

export const goLiveServerEn = {
  activation: {
    company: 'Your company',
    subject: '{{company}}: activate your NocoHR account',
    text: 'Hello {{name}}, {{company}} has opened a NocoHR account for you (login: {{login}}). Open this link within {{days}} days to set your password:\n{{link}}\n\nThe link works once. If this was not meant for you, ignore it and tell HR.',
    linkRemoved: '(link not kept)',
  },
};

export const goLiveServerZh: typeof goLiveServerEn = {
  activation: {
    company: '公司',
    subject: '{{company}}：请激活你的 NocoHR 账号',
    text: '{{name}}你好，{{company}}已为你开通 NocoHR 登录账号（登录名：{{login}}）。请在 {{days}} 天内打开下面的链接设置密码：\n{{link}}\n\n链接只能使用一次。如非本人，请忽略并告知 HR。',
    linkRemoved: '（链接未保存）',
  },
};
