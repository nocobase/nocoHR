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
  // V4-14 叉车出库登记, opened by the 叉车证 certification.
  'demo.forkliftDispatch': {
    path: '/demo/forklift-dispatch',
    title: 'navigation.demoForkliftDispatch',
  },
};
