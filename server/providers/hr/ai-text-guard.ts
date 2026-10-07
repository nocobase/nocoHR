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
 * The model's wording, asked for at most twice when a reply only describes the instructions; otherwise the
 * rule-based text. `unavailable` tells a missing model from a real failure, which is rethrown.
 */
export async function guardedWording(
  compose: () => Promise<string>,
  fallback: () => string,
  options: {
    readonly unavailable: (error: unknown) => boolean;
    readonly onFallback: () => void;
  },
): Promise<string> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await compose();
      if (!describesFormat(text)) return text;
    }
  } catch (error) {
    if (!options.unavailable(error)) throw error;
  }
  options.onFallback();
  return fallback();
}
