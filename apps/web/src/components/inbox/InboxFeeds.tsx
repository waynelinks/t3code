import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentHttpBaseUrl, useEnvironments } from "../../state/environments";
import {
  INBOX_REFRESH_MS,
  getInboxFeed,
  inboxBaseFor,
  inboxRequest,
  publishInboxFeed,
  registerInboxRefresher,
  removeInboxFeed,
  type InboxHealth,
  type InboxItem,
} from "../../state/inbox";

/** One poller per connected environment, mounted once from the sidebar so the count is always live. */
export function InboxFeeds() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentInboxFeed
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

function EnvironmentInboxFeed({ environmentId }: { environmentId: EnvironmentId }) {
  const httpBase = useEnvironmentHttpBaseUrl(environmentId);
  const base = inboxBaseFor(httpBase);
  useEffect(() => {
    if (!base) {
      removeInboxFeed(environmentId);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await inboxRequest<{
          items?: InboxItem[];
          health?: InboxHealth;
          company_label?: string;
        }>(base, "/items?status=all");
        if (cancelled) return;
        publishInboxFeed({
          environmentId,
          base,
          companyLabel: data.company_label ?? null,
          items: data.items ?? [],
          health: data.health ?? null,
          error: null,
          loadedAt: Date.now(),
        });
      } catch (error) {
        if (cancelled) return;
        publishInboxFeed({
          environmentId,
          base,
          companyLabel: getInboxFeed(environmentId)?.companyLabel ?? null,
          items: getInboxFeed(environmentId)?.items ?? [],
          health: null,
          error: error instanceof Error ? error.message : String(error),
          loadedAt: Date.now(),
        });
      }
    };
    const unregister = registerInboxRefresher(environmentId, load);
    // Every 30 seconds; every 4 while a spec is being written or a task is building.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const busy = (getInboxFeed(environmentId)?.items ?? []).some(
        (item) =>
          ["speccing", "approved", "running", "failed_rung"].includes(item.task?.status ?? "") ||
          item.draft.state === "pending",
      );
      timer = setTimeout(
        () => void load().then(() => !cancelled && schedule()),
        busy ? 4_000 : INBOX_REFRESH_MS,
      );
    };
    void load().then(() => !cancelled && schedule());
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      unregister();
      removeInboxFeed(environmentId);
    };
  }, [base, environmentId]);
  return null;
}
