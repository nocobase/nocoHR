import type { useApiClient } from '@nocobase/app-client';
import type { FileRecord } from '@nocobase/app-plugin-file/client';

/** What an `hrFiles` upload is for; mirrors `server/providers/hr/hr-files.ts`. */
export type HrFilePurpose =
  | 'courseVideo'
  | 'profileAttachment'
  | 'contract'
  | 'kbDocument'
  | 'jobDescription';

/**
 * Uploads a file to `hrFiles` for one purpose. The server checks the purpose's
 * permission, size and formats and records the uploader, and a record accepts
 * only a file its editor uploaded for it. The file plugin's client repository
 * sends no purpose, so this posts the same multipart request with `?purpose=`.
 */
export async function uploadHrFile(
  api: ReturnType<typeof useApiClient>,
  file: File,
  purpose: HrFilePurpose,
): Promise<FileRecord> {
  const body = new FormData();
  body.append('file', file);
  const { data } = await api.request<{ data: { record: FileRecord } }>({
    path: '/hrFiles:uploadOne',
    method: 'POST',
    query: { purpose },
    body,
  });
  return data.record;
}
