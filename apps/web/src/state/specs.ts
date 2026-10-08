/** Chief specs, as the company service returns them: PRD, requirements, design, steps with evidence. */
export interface SpecRequirement {
  readonly id: string;
  readonly statement: string;
  readonly kind: string;
  readonly rationale?: string;
  readonly state?: "uncovered" | "planned" | "in_progress" | "done";
  readonly steps?: ReadonlyArray<string>;
}
export interface SpecStepEvidence {
  readonly task_status: string;
  readonly review: string | null;
  readonly pr_url: string | null;
  readonly attempts: number | null;
  readonly spec: string | null;
  readonly acceptance_cases: number;
  readonly reasons: string | null;
  /** The T3 thread the step's build runs in. */
  readonly thread_id?: string | null;
}
export interface SpecStep {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly repo: string;
  readonly requirements: ReadonlyArray<string>;
  readonly acceptance: ReadonlyArray<string>;
  readonly depends_on: ReadonlyArray<string>;
  readonly size: string;
  readonly chief_task_id?: string | null;
  readonly state?: string;
  readonly merged_at?: string | null;
  readonly evidence?: SpecStepEvidence | null;
}
export type SpecStatus =
  | "prd"
  | "drafting"
  | "requirements_to_approve"
  | "design_to_approve"
  | "building"
  | "done";
export interface Spec {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly prd: string;
  readonly requirements: ReadonlyArray<SpecRequirement>;
  readonly design: string;
  readonly steps: ReadonlyArray<SpecStep>;
  readonly open_questions: ReadonlyArray<string>;
  readonly approvals: { readonly requirements?: string | null; readonly design?: string | null };
  readonly drafting: {
    readonly state: "idle" | "pending" | "failed";
    readonly at?: string;
    readonly error?: string;
    readonly cost_usd?: number | null;
  };
  readonly status: SpecStatus;
  readonly progress: { readonly merged: number; readonly total: number };
}
export interface SpecSummary {
  readonly id: string;
  readonly title: string;
  readonly status: SpecStatus;
  readonly progress: { readonly merged: number; readonly total: number };
  readonly updated_at: string;
  readonly repo: string;
}
export interface Constitution {
  readonly text: string;
  readonly updated_at: string | null;
  readonly draft: {
    readonly state: "idle" | "pending" | "ready" | "failed";
    readonly text?: string;
    readonly error?: string;
    readonly at?: string;
  };
}
