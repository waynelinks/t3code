import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/**
 * Chief inbox: each company's inbox service answers next to its T3 server, 100 ports up
 * (3737 -> 3837). The page and the sidebar count read one store that the feeds keep fresh.
 */
export const INBOX_PORT_OFFSET = 100;
export const INBOX_REFRESH_MS = 30_000;

export interface InboxDraft {
  readonly state: "none" | "pending" | "ready" | "failed";
  readonly text: string;
  readonly kind?: string;
  readonly confidence?: string;
  readonly checked?: ReadonlyArray<string>;
  readonly needs?: ReadonlyArray<string>;
  readonly error?: string;
  readonly generated_at?: string;
  readonly edited?: boolean;
}
export interface InboxItem {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly snooze_until?: string | null;
  readonly who: string;
  /** The sender's ClickUp profile picture, when they have one. */
  readonly who_avatar?: string | null;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly next_action: string;
  readonly context: Record<string, unknown>;
  readonly draft: InboxDraft;
  readonly reply: { readonly sent_at: string; readonly text: string } | null;
  readonly reply_to?: {
    readonly kind: "task-comment" | "comment-thread" | "channel" | "thread";
  } | null;
  readonly task?: InboxTask | null;
}
/** A chief-task started from (or found by) the inbox: spec, approval, run, draft pull request. */
export interface InboxTask {
  readonly id: string;
  readonly status: string;
  readonly repo: string;
  readonly title?: string;
  readonly spec?: string | null;
  readonly acceptance_cases?: number;
  readonly pr_url?: string | null;
  readonly reasons?: string | null;
  readonly error?: string | null;
}
export interface InboxConfig {
  readonly configured: boolean;
  readonly team_id_configured: boolean;
  readonly team_id: string | null;
  readonly workspaces: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly user: { readonly id: number; readonly username: string } | null;
  readonly watch_channels: ReadonlyArray<string>;
  readonly last_error: string | null;
  readonly last_poll_at: string | null;
}
export interface InboxHealth {
  readonly configured: boolean;
  readonly last_error: string | null;
  readonly last_poll_at: string | null;
  readonly drafting: string | null;
  readonly telegram: boolean;
}
export interface EnvironmentInbox {
  readonly environmentId: EnvironmentId;
  readonly base: string;
  /** The company name the inbox service was started with; the default organisation name. */
  readonly companyLabel: string | null;
  readonly items: ReadonlyArray<InboxItem>;
  readonly health: InboxHealth | null;
  readonly error: string | null;
  readonly loadedAt: number | null;
}

export function inboxBaseFor(httpBaseUrl: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(httpBaseUrl || window.location.origin, window.location.origin);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return `${url.protocol}//${url.hostname}:${port + INBOX_PORT_OFFSET}`;
  } catch {
    return null;
  }
}

const feeds = new Map<EnvironmentId, EnvironmentInbox>();
let snapshot: ReadonlyArray<EnvironmentInbox> = [];
const listeners = new Set<() => void>();
function emit() {
  snapshot = [...feeds.values()];
  for (const listener of listeners) listener();
}
export function publishInboxFeed(feed: EnvironmentInbox): void {
  feeds.set(feed.environmentId, feed);
  emit();
}
export function removeInboxFeed(environmentId: EnvironmentId): void {
  if (feeds.delete(environmentId)) emit();
}
export function getInboxFeed(environmentId: EnvironmentId): EnvironmentInbox | undefined {
  return feeds.get(environmentId);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useInboxFeeds(): ReadonlyArray<EnvironmentInbox> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

const refreshers = new Map<EnvironmentId, () => Promise<void>>();
export function registerInboxRefresher(
  environmentId: EnvironmentId,
  refresh: () => Promise<void>,
): () => void {
  refreshers.set(environmentId, refresh);
  return () => {
    if (refreshers.get(environmentId) === refresh) refreshers.delete(environmentId);
  };
}
export async function refreshInbox(environmentId?: EnvironmentId): Promise<void> {
  const list = environmentId
    ? [refreshers.get(environmentId)].filter((r): r is () => Promise<void> => r !== undefined)
    : [...refreshers.values()];
  await Promise.all(list.map((refresh) => refresh()));
}

export async function inboxRequest<T = unknown>(
  base: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const hasBody = init?.body !== undefined;
  const response = await fetch(base + path, {
    method: init?.method ?? "GET",
    ...(hasBody
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}
