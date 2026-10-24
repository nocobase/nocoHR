import { createHash } from 'node:crypto';

/** Preserve database values without losing bigint precision or confusing dates with objects. */
export function capabilityRecordDigest(value: unknown): string {
  const active = new Set<object>();
  const encode = (item: unknown): unknown => {
    if (item === null) return ['null'];
    if (item === undefined) return ['undefined'];
    if (typeof item === 'string') return ['string', item];
    if (typeof item === 'boolean') return ['boolean', item];
    if (typeof item === 'number' && Number.isFinite(item))
      return ['number', Object.is(item, -0) ? '-0' : String(item)];
    if (typeof item === 'bigint') return ['bigint', item.toString()];
    if (item instanceof Date && Number.isFinite(item.getTime()))
      return ['date', item.toISOString()];
    if (typeof item !== 'object' || active.has(item))
      throw new Error('UNSUPPORTED_CAPABILITY_RECORD');
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('UNSUPPORTED_CAPABILITY_RECORD');
    active.add(item);
    const result = Array.isArray(item)
      ? ['array', item.map(encode)]
      : [
          'object',
          Object.keys(item)
            .sort()
            .map((key) => [
              key,
              encode((item as Record<string, unknown>)[key]),
            ]),
        ];
    active.delete(item);
    return result;
  };
  return createHash('sha256')
    .update(JSON.stringify(encode(value)))
    .digest('hex');
}
