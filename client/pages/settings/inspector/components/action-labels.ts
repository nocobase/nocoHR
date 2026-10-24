import type { Translate } from '../i18n.js';
/**
 * What one action on one resource reaches: every record, some of them, or
 * nothing. A set conferring unrestricted access has no grants to read, so it
 * carries its own mark rather than reading as "not granted".
 */
export type GrantMark = 'all' | 'scoped' | 'none' | 'bypass';

export function markLabel(t: Translate, mark: GrantMark): string {
  return t(`authorizationInspector.marks.labels.${mark}`);
}

/** What the mark means, for a tooltip and for the legend. */
export function markDescription(t: Translate, mark: GrantMark): string {
  return t(`authorizationInspector.marks.descriptions.${mark}`);
}
