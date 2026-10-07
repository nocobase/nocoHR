/**
 * Whether the 启衡精密 demo is on: outside production and unless `HR_DEMO_SEED=false`, the same gate every demo seed
 * uses. Configuration defaults that only the demo needs (its company name, its `@qiheng.test` mailbox addresses)
 * follow it, so a production installation starts from neutral values and the demo keeps its own.
 */
export function isDemoEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.NODE_ENV !== 'production' && env.HR_DEMO_SEED !== 'false';
}
