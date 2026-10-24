import { expect, it } from 'vitest';

import AppAIResources from '../../server/ai/index.js';

it('collects all business employees and executable tools without the retired runtime', async () => {
  const resources = await new AppAIResources().collect();
  expect([...resources.employees.keys()].sort()).toEqual([
    'certificationSteward',
    'contentWriter',
    'examiner',
    'frameworkAdvisor',
    'hrAssistant',
    'knowledgeAssistant',
    'learningCoach',
    'performanceAssistant',
    'practiceCoach',
    'recruitingAssistant',
    'talentAnalyst',
  ]);
  for (const employee of resources.employees.values()) {
    for (const setting of employee.tools ?? []) {
      const tool = resources.tools.get(setting.name);
      expect(tool, `${employee.username}: ${setting.name}`).toBeDefined();
      expect(tool?.definition.schema).toBeDefined();
      expect(typeof tool?.execute).toBe('function');
    }
  }
  expect(resources.tools.get('submitMyProfileChange')?.defaultPermission).toBe(
    'ASK',
  );
  expect(resources.tools.get('getMyHrProfile')?.defaultPermission).toBe(
    'ALLOW',
  );
});
