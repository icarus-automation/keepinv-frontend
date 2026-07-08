export type ToolId = 'scan-receipt' | 'barcode-sheet';

/** Copy shown by the upgrade dialog when a tool is visible but the plan does not unlock it. */
export interface ToolUpgradePitch {
  readonly headline: string;
  readonly pitch: string;
}

/**
 * A utility that sits outside the daily counter flow. Tools live under `/tools` rather than in
 * the sidebar: the rail is reserved for the work an operator does every hour.
 */
export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** PrimeIcons class, e.g. `pi pi-receipt`. */
  readonly icon: string;
  /** Absolute route path, e.g. `/tools/scan-receipt`. */
  readonly path: string;
  /** One line, shown under the label on the tools index. */
  readonly blurb: string;
  /** Present only on tools that can render `locked`; drives the upgrade dialog. */
  readonly upgrade?: ToolUpgradePitch;
}

/**
 * A tool the current user is allowed to *see*. `locked` means their role permits it but their plan
 * does not: the row opens the upgrade dialog instead of navigating. Tools they may not see at all
 * are absent from the list entirely.
 */
export interface ToolListing {
  readonly tool: ToolDefinition;
  readonly state: 'available' | 'locked';
}
