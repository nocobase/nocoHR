/**
 * Demonstration pages have no menu entry. A certification whose permission
 * sets open one of these pages links to it, so a holder can see what the
 * certificate unlocks. Keyed by page resource id.
 */
export const DEMO_PAGES: Readonly<
  Record<string, { path: string; title: string }>
> = {
  'demo.batchRecord': {
    path: '/demo/batch-record',
    title: 'navigation.demoBatchRecord',
  },
};
