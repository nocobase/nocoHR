import type { AntiCheat } from '@/components/talent/exam-types';

/** The server's defaults (V3-10 规格): shuffled options, no copying, 3 blurs then a flag, one device. */
export const DEFAULT_ANTI_CHEAT: AntiCheat = {
  shuffleOptions: true,
  disableCopy: true,
  maxBlurCount: 3,
  blurAction: 'flag',
  singleDevice: true,
};
