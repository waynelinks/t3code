/** PR reviews from a company's Release Request channel, as the company service returns them (inbox/release.ts). */
export interface ReleaseConfig {
  readonly enabled: boolean;
  readonly interval_min: number;
  readonly channel: string;
  readonly kit_source: string;
  readonly window_days: number;
  readonly review: boolean;
  readonly post: boolean;
  readonly reply: boolean;
  readonly merger: string;
  readonly repos: Readonly<Record<string, string>>;
}
export interface ReleasePr {
  readonly repo?: string;
  readonly github: string;
  readonly number: number;
  readonly title?: string;
  readonly url?: string;
  readonly verdict?: string;
}
export interface ReleaseResult {
  readonly repo: string;
  readonly number: number;
  readonly verdict: string;
  readonly posted: boolean;
  readonly why: string;
  readonly clickup: string;
}
export interface ReleaseCard {
  readonly thread: string;
  /** One card per pull request: the thread plus the pull request it shows. */
  readonly card?: string;
  readonly link: string;
  readonly stage: "requested" | "reviewing" | "reviewed" | "replied";
  readonly asked_by_name?: string;
  readonly prs: ReadonlyArray<ReleasePr>;
  readonly at: number;
  readonly t3_thread?: string | null;
  /** While it is being reviewed: from the review thread's activity. */
  readonly progress?: {
    readonly minutes: number;
    readonly steps: number;
    readonly now: string;
    readonly refused: number;
  };
  readonly review?: {
    readonly results: ReadonlyArray<ReleaseResult>;
    readonly error: string | null;
    readonly post: boolean;
    readonly deferred: boolean;
    readonly t3_thread: string | null;
    readonly summary: string;
    /** How long the review session took. */
    readonly seconds?: number | null;
  };
  readonly reply?: {
    readonly status: string;
    readonly at: number;
    readonly error: string | null;
    readonly text: string;
  } | null;
}
export interface ReleaseYou {
  readonly id: string;
  readonly kind: "pr" | "mention";
  readonly thread: string;
  readonly link: string;
  readonly repo?: string;
  readonly number?: number;
  readonly title?: string;
  readonly url?: string;
  readonly verdict?: string;
  readonly asked_by_name?: string;
  readonly by_name?: string;
  readonly summary?: string;
  readonly suggestion: string | null;
  readonly answerable: boolean;
  readonly queued: string | null;
  readonly last_ask?: number;
  readonly date?: number;
}
export interface ReleaseStuck {
  readonly key: string;
  readonly thread: string;
  readonly at: number;
  readonly asked_by_name: string;
  readonly link: string;
  readonly text: string;
  readonly reply_error: string;
  readonly prs: ReadonlyArray<string>;
}
export interface ReleaseRun {
  readonly at: number;
  readonly threads: number;
  readonly read: number;
  readonly qualified: number;
  readonly failed: number;
  readonly complete: boolean;
  readonly error: string | null;
  readonly seconds?: number;
}
export interface ReleaseBoard {
  readonly config: ReleaseConfig;
  readonly stages: Readonly<Record<ReleaseCard["stage"], ReadonlyArray<ReleaseCard>>>;
  readonly you: ReadonlyArray<ReleaseYou>;
  readonly stuck: ReadonlyArray<ReleaseStuck>;
  readonly others: ReadonlyArray<
    ReleasePr & {
      readonly thread: string;
      readonly link: string;
      readonly asked_by_name: string;
      readonly last_ask: number;
    }
  >;
  readonly runs: ReadonlyArray<ReleaseRun>;
  readonly running: boolean;
  readonly login: {
    readonly logged_in: boolean | null;
    readonly at: number | null;
    readonly error: string | null;
    readonly busy: boolean;
  };
  readonly kit: {
    readonly at: number | null;
    readonly missing: ReadonlyArray<string> | null;
    readonly source: string | null;
  };
  readonly window_open: boolean;
}
export interface ReleaseSummary {
  readonly enabled: boolean;
  readonly needs_you: number;
  readonly reviewing: boolean;
  readonly logged_in?: boolean | null;
}
