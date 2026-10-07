/**
 * A model sometimes answers a writing task by describing what it wrote — “已按要求输出不超过150字的HR合规
 * 提示，含事实、法条依据……，并以指定句子结尾” — instead of writing it. Such a reply is about the instructions,
 * not the matter, and must not reach a person as if it were the text.
 */
const FORMAT_REPORT = [
  // Reports of having followed the instructions.
  /^(?:我)?已经?(?:按|根据|依照|遵照)(?:你的|您的|上述|以上)?(?:要求|指示|指定|格式)/u,
  /^(?:我)?已经?(?:输出|写好|写出|撰写)/u,
  /^(?:以下|下面)是(?:按要求|根据要求)/u,
  // Echoes of the instruction's own wording.
  /不超过\s*\d+\s*(?:个)?字的/u,
  /以指定(?:的)?(?:句子|语句|句式)结尾/u,
  /(?:符合|满足)(?:上述|以上|全部|所有)(?:要求|格式)|(?:符合|满足)(?:格式|字数)/u,
];

/** Whether the text reports on the instructions rather than being the requested text. */
export function describesFormat(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  return FORMAT_REPORT.some((pattern) => pattern.test(value));
}

/**
 * Words from the data rather than from the language people read: field names (`gaps`, `employeeId`,
 * `development_records`), status codes (`draft`, `approved`) and empty values. A model given JSON sometimes
 * echoes them — “差距：gaps 为空”, “学习计划（draft）” — and a note that does is not shown to a person.
 */
const INTERNAL_TOKENS = [
  /\bgaps?\b/iu,
  /\b(?:draft|approved|pending|rejected|confirmed|expired|readyNow|oneToTwoYears|threePlusYears)\b/iu,
  /\b(?:null|undefined|true|false|NaN)\b/u,
  // camelCase (employeeId, latestRating) and snake_case (development_records) identifiers.
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/u,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/u,
];

/** Whether the text mentions field names, status codes or empty values from the data it was written from. */
export function mentionsInternals(text: string): boolean {
  return INTERNAL_TOKENS.some((pattern) => pattern.test(text));
}

/**
 * A model's answer, asked for at most twice while `accept` rejects it; otherwise the rule-based answer.
 * `unavailable` tells a missing model from a real failure, which is rethrown.
 */
export async function guardedAnswer<T>(
  compose: () => Promise<T>,
  fallback: () => T,
  options: {
    readonly accept: (answer: T) => boolean;
    readonly unavailable: (error: unknown) => boolean;
    readonly onFallback: () => void;
  },
): Promise<T> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await compose();
      if (options.accept(answer)) return answer;
    }
  } catch (error) {
    if (!options.unavailable(error)) throw error;
  }
  options.onFallback();
  return fallback();
}

/**
 * The model's wording, asked for at most twice when a reply only describes the instructions (or, with
 * `accept`, when the caller rejects it, e.g. through `mentionsInternals`); otherwise the rule-based text.
 * `unavailable` tells a missing model from a real failure, which is rethrown.
 */
export async function guardedWording(
  compose: () => Promise<string>,
  fallback: () => string,
  options: {
    readonly unavailable: (error: unknown) => boolean;
    readonly onFallback: () => void;
    readonly accept?: (text: string) => boolean;
  },
): Promise<string> {
  return guardedAnswer(compose, fallback, {
    unavailable: options.unavailable,
    onFallback: options.onFallback,
    accept: (text) =>
      !describesFormat(text) && (options.accept ? options.accept(text) : true),
  });
}
