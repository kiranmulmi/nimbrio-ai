export const APPROVAL_MODES = ['ask', 'auto', 'deny'] as const;

export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** How the API runs the agent, shown in the UI. Models are listed by `GET /v1/models`. */
export interface AppInfo {
  approval: ApprovalMode;
}
