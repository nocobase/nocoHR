/**
 * V3-10 单设备作答: the token the server issued to this browser for an
 * attempt, kept per attempt (and per exam, for "start" returning to an open
 * attempt) so a refresh returns to the same attempt on the same device.
 * Another device opening the attempt gets its own token, after which this
 * one's saves and submission are refused.
 */
const attemptKey = (attemptId: string) => `hr-exam-device:${attemptId}`;
const examKey = (examId: string) => `hr-exam-device:exam:${examId}`;

export function rememberDevice(attempt: {
  id: string;
  examId?: string;
  deviceToken?: string | null;
}): void {
  if (!attempt.deviceToken) return;
  try {
    window.localStorage.setItem(attemptKey(attempt.id), attempt.deviceToken);
    if (attempt.examId)
      window.localStorage.setItem(examKey(attempt.examId), attempt.deviceToken);
  } catch {
    // Storage may be unavailable (private mode); the server then treats each load as a new device.
  }
}

function header(storageKey: string): Record<string, string> | undefined {
  try {
    const token = window.localStorage.getItem(storageKey);
    return token ? { 'x-exam-device': token } : undefined;
  } catch {
    return undefined;
  }
}

/** Headers for the requests of one attempt. */
export const deviceHeaders = (attemptId: string) =>
  header(attemptKey(attemptId));
/** Headers for starting an exam, which may return to an attempt already open on this device. */
export const examDeviceHeaders = (examId: string) => header(examKey(examId));
