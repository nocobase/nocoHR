/**
 * In-app notifications are delivered on the notification queue after the send
 * returns (notification plugin 1.0.0-beta.21), so a test reading
 * `notificationInAppItems` right after the step that sent them may find
 * nothing yet. This reads until the rows appear, and returns what the last
 * read found once the time is up, so the assertion that follows reports it.
 */
export async function eventually<T>(
  read: () => Promise<readonly T[]>,
  timeoutMs = 8000,
): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await read();
    if (rows.length > 0 || Date.now() >= deadline) return [...rows];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
