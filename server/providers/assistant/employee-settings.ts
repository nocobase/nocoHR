import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';
import type { AIEmployeeOptions } from '../../ai/contracts.js';
import { capabilityRecordDigest } from '../upgrade/digest.js';
import { record, legacyId } from './legacy-contract.js';

export const preferenceId = (userId: string, employee: string) =>
  capabilityRecordDigest([userId, employee]);
export interface EmployeeProfile extends AIEmployeeOptions {
  enabled: boolean;
}

/** Non-secret application copies; ownership comes from the caller, never a posted userId. */
export class AssistantEmployeeSettings {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly declarations: ReadonlyMap<string, AIEmployeeOptions>,
  ) {}
  public async rows(userId: string) {
    return Promise.all([
      this.db.repository('assistantEmployees').findMany({ limit: 1000 }),
      this.db
        .repository('assistantEmployeePreferences')
        .findMany({ filter: { userId }, limit: 1000 }),
    ]);
  }
  public async profile(username: string): Promise<EmployeeProfile> {
    const base = this.declarations.get(username);
    if (!base) throw new Error('EMPLOYEE_NOT_FOUND');
    const row = await this.db
      .repository('assistantEmployees')
      .findOne({ filter: { id: username } });
    return row
      ? (record(row.profile) as unknown as EmployeeProfile)
      : { ...base, enabled: true };
  }
  public async employee(
    username: string,
    userId: string,
  ): Promise<AIEmployeeOptions> {
    const base = this.declarations.get(username);
    if (!base) throw new Error('EMPLOYEE_NOT_FOUND');
    const [row, preference] = await Promise.all([
      this.db
        .repository('assistantEmployees')
        .findOne({ filter: { id: username } }),
      this.db
        .repository('assistantEmployeePreferences')
        .findOne({ filter: { userId, employee: username } }),
    ]);
    const profile = row
      ? (record(row.profile) as unknown as EmployeeProfile)
      : { ...base, enabled: true };
    if (profile.enabled === false) throw new Error('EMPLOYEE_DISABLED');
    const mode = profile.chatSettings?.systemPromptMode;
    const prompt =
      mode === 'none' ? '' : (profile.systemPrompt ?? base.systemPrompt ?? '');
    return {
      ...base,
      ...profile,
      systemPrompt:
        mode !== 'raw' && mode !== 'none' && preference?.prompt
          ? `${prompt}\n\n<personal>\n${z.string().parse(preference.prompt)}\n</personal>`
          : prompt,
    };
  }
  public async roster(userId: string) {
    const [profiles, preferences] = await this.rows(userId);
    const byName = new Map(
      profiles.map((row) => [
        legacyId(row.id),
        record(row.profile) as unknown as EmployeeProfile,
      ]),
    );
    const byEmployee = new Map(
      preferences.map((row) => [legacyId(row.employee), row]),
    );
    return [...this.declarations.values()]
      .map((base) => ({
        ...base,
        ...byName.get(base.username),
        userConfig: { prompt: byEmployee.get(base.username)?.prompt ?? '' },
      }))
      .filter(
        (employee) => !('enabled' in employee) || employee.enabled !== false,
      )
      .sort(
        (a, b) =>
          Number(byEmployee.get(a.username)?.sort ?? a.sort ?? 0) -
          Number(byEmployee.get(b.username)?.sort ?? b.sort ?? 0),
      );
  }
  public async defaultModel() {
    const row = await this.db
      .repository('assistantModelServices')
      .findOne({ filter: { id: '#defaults' } });
    if (!row) return;
    const settings = record(row.settings);
    return settings.defaultModel && settings.defaultLlmService
      ? {
          model: z.string().parse(settings.defaultModel),
          llmService: z.string().parse(settings.defaultLlmService),
        }
      : undefined;
  }
  public async setPrompt(userId: string, employee: string, prompt: string) {
    if (!this.declarations.has(employee)) throw new Error('EMPLOYEE_NOT_FOUND');
    await this.db.repository('assistantEmployeePreferences').upsertOne({
      filter: { id: preferenceId(userId, employee) },
      create: {
        id: preferenceId(userId, employee),
        userId,
        employee,
        prompt,
        sort: null,
      },
      update: { prompt },
    });
  }
}

/** Preserve the existing employee allow-list and its order, intersected with currently enabled models. */
export function employeeModelChoices(
  employee: AIEmployeeOptions,
  catalog: readonly {
    llmService: string;
    enabledModels: { value: string }[];
  }[],
) {
  const enabled = catalog.flatMap((service) =>
    service.enabledModels.map((model) => ({
      llmService: service.llmService,
      model: model.value,
    })),
  );
  const settings = employee.modelSettings;
  if (!settings?.enabled) return enabled;
  const candidates = (settings.models ?? []).filter(
    (entry): entry is { llmService: string; model: string } =>
      Boolean(entry.llmService && entry.model),
  );
  if (!candidates.length && settings.llmService && settings.model)
    candidates.push({ llmService: settings.llmService, model: settings.model });
  return candidates.filter((entry) =>
    enabled.some(
      (model) =>
        model.llmService === entry.llmService && model.model === entry.model,
    ),
  );
}
