/**
 * Pure visibility for the Pro My Work tree in the MWNN Kanban activity-bar
 * container. Mirrors the contributed view's `when: mwnn-kanban.hasProLicense`
 * so unit tests can assert the unlicensed path without an extension host.
 */

import type { ProLicenseStatus } from './portfolioButton';

/** The contributed view id for the Pro My Work queue. */
export const MY_WORK_VIEW_ID = 'mwnn-kanban.myWork';

/** The context key that gates My Work in package.json `when` clauses. */
export const MY_WORK_LICENSE_WHEN = 'mwnn-kanban.hasProLicense';

/**
 * Whether My Work should appear in the activity-bar container.
 * - `visible`: valid Pro licence or live trial — same signal as Portfolio menus.
 * - `hidden`: no licence and no live trial — only the free sidebar webview remains.
 */
export type MyWorkViewMode = 'visible' | 'hidden';

/** Map the published Pro licence signal onto My Work's container visibility. */
export function myWorkViewMode(status: ProLicenseStatus): MyWorkViewMode {
  return status.licensed ? 'visible' : 'hidden';
}
