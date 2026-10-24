import { AppCommand } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
import path from 'node:path';
import { writeProcessArtifacts } from '../../server/providers/processes/catalog.js';
import {
  processDefinitions,
  processHandlers,
} from '../../server/processes/index.js';
export default class BuildProcesses extends AppCommand {
  static override description =
    'Compile registered application processes into a source-free artifact manifest.';
  static override flags = {
    out: Flags.string({ default: 'server/processes/artifacts' }),
  };
  public override async run() {
    const { flags } = await this.parse(BuildProcesses);
    await writeProcessArtifacts(
      path.resolve(flags.out),
      processDefinitions,
      processHandlers,
    );
    return { compiled: processDefinitions.length };
  }
}
