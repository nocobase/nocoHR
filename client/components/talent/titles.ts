type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A stored title is plain text, or — for seeded records — an encoded
 * `{ key, ns }` translation descriptor. Both render in the viewer's language.
 */
export function titleText(
  title: string | null | undefined,
  t: Translate,
): string {
  if (!title) return '';
  if (title.startsWith('{')) {
    try {
      const parsed = JSON.parse(title) as { key?: unknown; ns?: unknown };
      if (typeof parsed.key === 'string')
        return t(
          parsed.key,
          typeof parsed.ns === 'string' ? { ns: parsed.ns } : undefined,
        );
    } catch {
      // Not a descriptor after all: show it as written.
    }
  }
  return title;
}
