/**
 * Translations of the seeded department titles, so the authorization picker
 * and exports can search and print them in every shipped language. They
 * mirror the `departments.seed.*` keys in `client/locales/`.
 */
export const departmentTitleTranslations: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  'zh-CN': {
    'departments.seed.root': '启衡精密',
    'departments.seed.hr': '人力资源部',
    'departments.seed.quality': '质量部',
    'departments.seed.tech': '技术中心',
    'departments.seed.ops': '生产运营部',
    'departments.seed.sz': '苏州工厂',
    'departments.seed.szMc': '机加工车间',
    'departments.seed.szAs': '装配车间',
    'departments.seed.cd': '成都工厂',
    'departments.seed.cdMc': '成都机加工车间',
  },
  'en-US': {
    'departments.seed.root': 'Qiheng Precision',
    'departments.seed.hr': 'Human Resources',
    'departments.seed.quality': 'Quality',
    'departments.seed.tech': 'Technology Center',
    'departments.seed.ops': 'Production Operations',
    'departments.seed.sz': 'Suzhou Plant',
    'departments.seed.szMc': 'Machining Workshop',
    'departments.seed.szAs': 'Assembly Workshop',
    'departments.seed.cd': 'Chengdu Plant',
    'departments.seed.cdMc': 'Chengdu Machining Workshop',
  },
};
