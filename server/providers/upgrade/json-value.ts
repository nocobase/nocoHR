import { z } from 'zod';

/** Persist only JSON values; diagnostics must not expose failed arguments or model output. */
export function capabilityJsonValue(
  value: unknown,
): z.infer<ReturnType<typeof z.json>> {
  const parsed = z.json().safeParse(value === undefined ? null : value);
  if (!parsed.success) throw new Error('INVALID_CAPABILITY_JSON');
  return parsed.data;
}
