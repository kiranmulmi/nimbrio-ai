export const STEP_STATUSES = ['pending', 'in_progress', 'done', 'skipped', 'failed'] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

export interface PlanStep {
  text: string;
  status: StepStatus;
  note: string;
}

export interface Plan {
  goal: string;
  doneWhen: string;
  steps: PlanStep[];
  /** When the plan was made (ISO). Missing on plans saved before it was recorded. */
  createdAt?: string;
}

/** A step that is still pending or in progress, with its 1-based number in the plan. */
export interface NumberedPlanStep extends PlanStep {
  number: number;
}
