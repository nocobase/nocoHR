import type {
  ProcessDefinition,
  ProcessHandler,
} from '../providers/processes/engine.js';

/** Register application-owned, reviewed handlers here. Never import a module named by database content. */
export const processHandlers: ReadonlyMap<string, ProcessHandler> = new Map();
export const processDefinitions: readonly Omit<ProcessDefinition, 'hash'>[] =
  [];
/** Explicit old module specifier -> reviewed application handler. No implicit aliases. */
export const legacyProcessModules: ReadonlyMap<string, string> = new Map();
