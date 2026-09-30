import { useCan } from '@nocobase/app-plugin-authorization/client';

import { useRemote } from '../use-remote.js';
import type {
  Adjustment,
  MyAttendance,
  ScheduleBoard,
  SwapPeer,
} from './types.js';

export interface SwapInfo {
  readonly loading: boolean;
  readonly counterpartName: string | null;
  /** The requester's shift on the request date; `null` is a rest day, `undefined` unknown. */
  readonly myShift: string | null | undefined;
  /** The counterpart's shift on the counterpart date. */
  readonly theirShift: string | null | undefined;
}

/**
 * Names and shift titles for a 调班 request. The request stores ids only, and
 * no single endpoint names them for every reader: a scheduler reads the
 * department's grid (`talent/schedules`, which carries every shift and every
 * colleague); an employee — the requester or the colleague asked to agree —
 * reads their own published month (`attendance/me`) and the colleagues'
 * published shifts on that day (`adjustments/swap-peers`, which covers the
 * same department). What neither can see stays unknown rather than guessed.
 */
export function useSwapInfo(row: Adjustment | undefined): SwapInfo {
  const swap = row?.type === 'shiftSwap' ? row : undefined;
  const counterpartId = swap?.details.counterpartEmployeeId;
  const counterpartDate = swap?.details.counterpartDate ?? swap?.date;
  const scheduler = useCan(
    { resource: { type: 'composite', id: 'talent.schedule' }, action: 'view' },
    { enabled: Boolean(swap?.departmentId) },
  );
  const useBoard = Boolean(swap?.departmentId && scheduler.can);
  const [from, to] = swap
    ? [swap.date, counterpartDate ?? swap.date].sort()
    : ['', ''];
  const board = useRemote<ScheduleBoard>(useBoard ? 'talent/schedules' : null, {
    departmentId: swap?.departmentId,
    from,
    to,
  });
  const peerMode = Boolean(swap) && !scheduler.isPending && !useBoard;
  const mine = useRemote<MyAttendance>(
    peerMode ? 'talent/attendance/me' : null,
    { month: swap?.date.slice(0, 7) },
  );
  const otherMonth =
    counterpartDate && counterpartDate.slice(0, 7) !== swap?.date.slice(0, 7);
  const mineOther = useRemote<MyAttendance>(
    peerMode && otherMonth ? 'talent/attendance/me' : null,
    { month: counterpartDate?.slice(0, 7) },
  );
  const peersOnDate = useRemote<SwapPeer[]>(
    peerMode ? 'talent/adjustments/swap-peers' : null,
    { date: swap?.date },
  );
  const peersOnOther = useRemote<SwapPeer[]>(
    peerMode && counterpartDate !== swap?.date
      ? 'talent/adjustments/swap-peers'
      : null,
    { date: counterpartDate },
  );
  if (!swap)
    return {
      loading: false,
      counterpartName: null,
      myShift: undefined,
      theirShift: undefined,
    };
  if (useBoard) {
    const shifts = new Map(
      (board.data?.shifts ?? []).map((s) => [s.id, s.title]),
    );
    const titleOf = (id: string | null | undefined) =>
      id === null ? null : id ? shifts.get(id) : undefined;
    return {
      loading: board.loading,
      counterpartName:
        board.data?.employees.find((e) => e.id === counterpartId)?.name ?? null,
      myShift: board.data ? titleOf(swap.details.myShiftId) : undefined,
      theirShift: board.data ? titleOf(swap.details.theirShiftId) : undefined,
    };
  }
  const ownId = mine.data?.employee.id;
  const ownSchedules = [
    ...(mine.data?.schedules ?? []),
    ...(mineOther.data?.schedules ?? []),
  ];
  const shiftFor = (
    employeeId: string | undefined,
    date: string | undefined,
    peers: SwapPeer[] | undefined,
  ): string | null | undefined => {
    if (!employeeId || !date) return undefined;
    if (employeeId === ownId) {
      const cell = ownSchedules.find((s) => s.date === date);
      return cell ? (cell.shiftId ? cell.title : null) : undefined;
    }
    const peer = peers?.find((p) => p.employeeId === employeeId);
    if (!peer?.scheduled) return undefined;
    return peer.shiftTitle;
  };
  const otherPeers =
    counterpartDate === swap.date ? peersOnDate.data : peersOnOther.data;
  return {
    loading: mine.loading || peersOnDate.loading,
    counterpartName:
      counterpartId === ownId
        ? (mine.data?.employee.name ?? null)
        : ((otherPeers ?? peersOnDate.data)?.find(
            (p) => p.employeeId === counterpartId,
          )?.name ?? null),
    myShift: shiftFor(swap.employeeId, swap.date, peersOnDate.data),
    theirShift: shiftFor(counterpartId, counterpartDate, otherPeers),
  };
}
