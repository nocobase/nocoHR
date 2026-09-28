import type { ApiClient } from '@nocobase/app-client';

/** Downloads a binary endpoint through the application's API client, so the session and base path apply. */
export async function downloadFile(
  api: ApiClient,
  path: string,
  filename: string,
  query?: Record<string, string | undefined>,
): Promise<void> {
  const stream = await api.stream({ path, query });
  const blob = await new Response(stream).blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
