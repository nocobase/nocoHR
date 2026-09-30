/**
 * 自助 cards (V1-04), shared by the 自助 page and its order / visibility
 * settings in 设置 / AI 入口.
 */
import {
  ArrowLeftRight,
  CalendarPlus,
  Clock,
  Fingerprint,
  FileSignature,
  GitBranch,
  History,
  MessageCircleQuestion,
  UserPen,
  type LucideIcon,
} from 'lucide-react';

interface Requirement {
  readonly resource: {
    readonly type: 'page' | 'composite';
    readonly id: string;
  };
  readonly action: string;
}

const page = (id: string): Requirement => ({
  resource: { type: 'page', id },
  action: 'access',
});
const composite = (id: string, action: string): Requirement => ({
  resource: { type: 'composite', id },
  action,
});

export interface ServiceEntry {
  readonly key: string;
  readonly to: string;
  readonly icon: LucideIcon;
  /** The target page's grant; a card shows only when the user may open it. */
  readonly page: Requirement;
  /** A business action the target also needs, such as requesting leave. */
  readonly action?: Requirement;
}

/**
 * The self-service cards, in their default order. An administrator reorders
 * or hides them in 设置 / AI 入口 (V1-04 “卡片的顺序和显隐是管理员可调整的应用
 * 配置”, stored by `talent/ai-entry/self-service`); see `arrange`. Later steps
 * add 工资条 here.
 */
export const SERVICES: readonly ServiceEntry[] = [
  {
    key: 'profileChange',
    to: '/talent/me?change=1',
    icon: UserPen,
    page: page('talent.me'),
    action: composite('talent.profileChange', 'request'),
  },
  {
    key: 'contracts',
    to: '/talent/me#contracts',
    icon: FileSignature,
    page: page('talent.me'),
  },
  {
    key: 'events',
    to: '/talent/me#events',
    icon: History,
    page: page('talent.me'),
  },
  {
    key: 'orgChart',
    to: '/talent/org-chart',
    icon: GitBranch,
    page: page('talent.orgChart'),
  },
  {
    key: 'assistant',
    to: '/talent/me/assistant',
    icon: MessageCircleQuestion,
    page: page('talent.me'),
    action: composite('talent.hrAssistant', 'use'),
  },
  // V2-05: 请假、补卡、加班、调班 open their dialog on 我的档案 · 考勤与假期.
  {
    key: 'leave',
    to: '/talent/me?action=leave#attendance',
    icon: CalendarPlus,
    page: page('talent.me'),
    action: composite('talent.leaveRequest', 'request'),
  },
  {
    key: 'missingPunch',
    to: '/talent/me?action=missingPunch#attendance',
    icon: Fingerprint,
    page: page('talent.me'),
    action: composite('talent.adjustment', 'request'),
  },
  {
    key: 'overtime',
    to: '/talent/me?action=overtime#attendance',
    icon: Clock,
    page: page('talent.me'),
    action: composite('talent.adjustment', 'request'),
  },
  {
    key: 'shiftSwap',
    to: '/talent/me?action=shiftSwap#attendance',
    icon: ArrowLeftRight,
    page: page('talent.me'),
    action: composite('talent.adjustment', 'request'),
  },
];

/** The stored order and visibility (`GET talent/ai-entry/self-service`). */
export interface SelfServiceCardsConfig {
  readonly cards: readonly {
    readonly key: string;
    readonly visible: boolean;
  }[];
}

/**
 * Applies the configured order and hides the hidden cards. Keys the config
 * does not name — a card a later step added — follow in their default order;
 * keys no card has any more are ignored.
 */
export function arrange(
  entries: readonly ServiceEntry[],
  config: SelfServiceCardsConfig | undefined,
): ServiceEntry[] {
  const rows = config?.cards ?? [];
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const named = rows.flatMap((row) => {
    const entry = byKey.get(row.key);
    return entry && row.visible ? [entry] : [];
  });
  const mentioned = new Set(rows.map((row) => row.key));
  return [...named, ...entries.filter((entry) => !mentioned.has(entry.key))];
}
