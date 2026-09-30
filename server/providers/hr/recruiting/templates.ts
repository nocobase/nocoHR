/**
 * 邮件模板 (设置 / 招聘设置): the default wording lives in the server locales
 * (`recruiting.templates.*`, application default language); an
 * administrator's template replaces it. `{{name}}`-style placeholders are
 * filled by the sender. Candidate emails carry no internal data: time,
 * place, materials and the candidate's own link only.
 */
import type { RecruitingContext } from './context.js';
import type { TemplateKey } from './config.js';

export function createTemplates(ctx: RecruitingContext) {
  return {
    async get(key: TemplateKey): Promise<{ subject: string; body: string }> {
      const settings = await ctx.settings();
      const custom = settings.templates[key];
      if (custom) return custom;
      const t = await ctx.translate();
      return {
        subject: t(`recruiting.templates.${key}.subject`),
        body: t(`recruiting.templates.${key}.body`),
      };
    },
  };
}

export type Templates = ReturnType<typeof createTemplates>;
