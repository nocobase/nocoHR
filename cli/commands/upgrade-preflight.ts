import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { AppCommand, appPath, CommandError } from '@nocobase/app-cli';

import AppAIResources from '../../server/ai/index.js';
import { checkUpgradeReadiness } from '../../server/providers/upgrade/preflight.js';

export default class UpgradePreflight extends AppCommand {
  public static override description =
    'Check a metadata inventory before capability migration; does not connect to the database.';

  public static override flags = {
    inventory: appPath({
      description:
        'Metadata inventory JSON inside this application, without credentials or record contents.',
      required: true,
    }),
  };

  public override async run(): Promise<unknown> {
    const { flags } = await this.parse(UpgradePreflight);
    let input: unknown;
    try {
      const root = await realpath(this.rootDir);
      const file = await realpath(flags.inventory);
      const relative = path.relative(root, file);
      if (
        !file.endsWith('.inventory.json') ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        relative === '..'
      )
        throw new Error('outside application');
      const information = await stat(file);
      if (!information.isFile() || information.size > 1_048_576)
        throw new Error('invalid inventory size');
      input = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
      throw new CommandError(
        'Provide a metadata-only .inventory.json file inside the application (at most 1 MiB).',
        { code: 'INVALID_INVENTORY' },
      );
    }
    const resources = await new AppAIResources().collect();
    const result = checkUpgradeReadiness(input, {
      ai: {
        verified: false,
        employees: new Set(resources.employees.keys()),
        tools: new Set(resources.tools.keys()),
        providers: new Set(['openai-completions']),
        capabilities: new Set([
          'text',
          'backend-tools',
          'retained-history',
          'transcript-continuation',
          'personal-prompts',
          'text-attachments',
        ]),
        approvalTransferVerified: false,
      },
      workflows: {
        verified: false,
        nodeTypes: new Set(),
        customHandlers: new Set(),
      },
    });
    if (!result.ready)
      throw new CommandError('Capability migration is not ready for cutover.', {
        code: 'UPGRADE_NOT_READY',
        details: result,
      });
    this.setStatus('success-noop');
    return result;
  }
}
