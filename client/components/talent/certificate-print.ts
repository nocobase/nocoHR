import { resolveAppUrl } from '@nocobase/app-client';

/** Opens the printable certificate; the browser prints it or saves it as PDF. */
export function printCertificate(id: string): void {
  window.open(
    resolveAppUrl(
      `/api/talent/certificates/${encodeURIComponent(id)}/document`,
    ),
    '_blank',
    'noopener',
  );
}
