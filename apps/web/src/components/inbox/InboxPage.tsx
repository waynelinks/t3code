import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { useEnvironments } from "../../state/environments";
import { inOrganisationScope, useOrganisationNames, useOrganisationScope } from "../../state/organisation";
import { inboxRequest, refreshInbox, useInboxFeeds, type EnvironmentInbox, type InboxItem } from "../../state/inbox";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

interface Row extends InboxItem {
  readonly environmentId: EnvironmentId;
  readonly base: string;
  readonly organisation: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function InboxPage() {
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const names = useOrganisationNames();
  const { environments } = useEnvironments();
  const labelFor = useCallback(
    (environmentId: EnvironmentId) =>
      names[environmentId] ?? environments.find((e) => e.environmentId === environmentId)?.label ?? environmentId,
    [environments, names],
  );
  const inScope = useMemo(
    () => feeds.filter((feed) => inOrganisationScope(scope, feed.environmentId)),
    [feeds, scope],
  );
  const rows = useMemo<Row[]>(
    () =>
      inScope
        .flatMap((feed) =>
          feed.items.map((item) => ({ ...item, environmentId: feed.environmentId, base: feed.base, organisation: labelFor(feed.environmentId) })),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [inScope, labelFor],
  );
  const needsReply = rows.filter((row) => row.next_action === "Reply" && row.draft.kind !== "fyi");
  const rest = rows.filter((row) => !needsReply.includes(row));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback(async (row: Row, action: string, body?: unknown) => {
    setBusy(row.id);
    setError(null);
    try {
      await inboxRequest(row.base, `/items/${encodeURIComponent(row.id)}/${action}`, { method: "POST", body: body ?? {} });
      await refreshInbox(row.environmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);
  const showOrganisation = scope === "all";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">Inbox</h1>
        <span className="truncate text-sm text-muted-foreground">
          {scope === "all" ? "All organisations" : labelFor(scope)}
        </span>
        <Badge variant="secondary" size="sm">{rows.length}</Badge>
        <div className="min-w-0 flex-1" />
        <Button variant="ghost" size="sm" onClick={() => void refreshInbox()}>
          <RefreshCwIcon className="size-4" />
          Refresh
        </Button>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="min-h-full gap-4 py-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {inScope.map((feed) => (
            <FeedNotice key={feed.environmentId} feed={feed} label={labelFor(feed.environmentId)} />
          ))}
          {inScope.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connected organisation in view.</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing waits on you.</p>
          ) : null}
          {needsReply.length > 0 ? (
            <Section title="Needs a reply" count={needsReply.length}>
              {needsReply.map((row) => (
                <InboxRow key={`${row.environmentId}:${row.id}`} row={row} busy={busy === row.id} showOrganisation={showOrganisation} onAct={act} />
              ))}
            </Section>
          ) : null}
          {rest.length > 0 ? (
            <Section title="Have a look" count={rest.length}>
              {rest.map((row) => (
                <InboxRow key={`${row.environmentId}:${row.id}`} row={row} busy={busy === row.id} showOrganisation={showOrganisation} onAct={act} />
              ))}
            </Section>
          ) : null}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

function FeedNotice({ feed, label }: { feed: EnvironmentInbox; label: string }) {
  if (feed.error) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {label}: the inbox service is not answering at {feed.base}. {feed.error}
      </p>
    );
  }
  if (feed.health && !feed.health.configured) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {label}: ClickUp is not connected yet. The steps are in OWNER-INBOX.md.
      </p>
    );
  }
  if (feed.health?.last_error) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-destructive">
        {label}: {feed.health.last_error}
      </p>
    );
  }
  return null;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        <Badge variant="secondary" size="sm">{count}</Badge>
      </h2>
      {children}
    </section>
  );
}

function InboxRow({
  row, busy, showOrganisation, onAct,
}: {
  row: Row; busy: boolean; showOrganisation: boolean;
  onAct: (row: Row, action: string, body?: unknown) => Promise<void>;
}) {
  const [text, setText] = useState(row.draft.text);
  const [serverText, setServerText] = useState(row.draft.text);
  useEffect(() => {
    // A fresh draft from the service replaces the box unless the owner has typed since.
    if (row.draft.text !== serverText) {
      setServerText(row.draft.text);
      if (text === serverText) setText(row.draft.text);
    }
  }, [row.draft.text, serverText, text]);
  const saveDraft = useCallback(() => {
    if (text === serverText) return;
    setServerText(text);
    void inboxRequest(row.base, `/items/${encodeURIComponent(row.id)}/draft`, { method: "PUT", body: { text } }).catch(() => {});
  }, [row.base, row.id, serverText, text]);
  const canReply = row.source === "clickup" && typeof row.context.task_id === "string";
  const showReply = canReply && (row.next_action === "Reply" || row.draft.state !== "none");
  const drafting = row.draft.state === "pending";

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" size="sm">{row.source}</Badge>
        {showOrganisation ? <span className="font-medium text-foreground/80">{row.organisation}</span> : null}
        <span className="font-medium text-foreground/80">{row.who || "someone"}</span>
        <span aria-hidden>·</span>
        <time dateTime={row.created_at}>{timeAgo(row.created_at)}</time>
        <div className="flex-1" />
        <span className="tracking-wide uppercase">{row.kind.replace("-", " ")}</span>
      </header>
      <h3 className="text-sm font-medium">
        {row.url ? (
          <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {row.title}
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
          </a>
        ) : row.title}
      </h3>
      {row.body ? <p className="text-sm whitespace-pre-wrap text-foreground/90">{row.body}</p> : null}
      {showReply ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Your reply</span>
            {drafting ? (<><Spinner className="size-3" /><span>drafting from the code</span></>) : null}
            {row.draft.state === "ready" && row.draft.confidence ? <span>confidence {row.draft.confidence}</span> : null}
            {row.draft.state === "ready" && row.draft.edited ? <span>edited</span> : null}
            {row.draft.state === "failed" ? <span className="text-destructive">draft failed: {row.draft.error}</span> : null}
          </div>
          {row.draft.needs && row.draft.needs.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-foreground/80">
              {row.draft.needs.map((need) => (<li key={need}>Needs you: {need}</li>))}
            </ul>
          ) : null}
          <Textarea
            value={text}
            rows={5}
            placeholder={drafting ? "Drafting a reply from the code" : "Write a reply"}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
            onBlur={saveDraft}
          />
          {row.draft.checked && row.draft.checked.length > 0 ? (
            <p className="text-xs text-muted-foreground">Checked: {row.draft.checked.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center gap-2">
        {showReply ? (
          <Button size="sm" disabled={busy || drafting || text.trim().length === 0} onClick={() => void onAct(row, "send", { text })}>
            Send reply
          </Button>
        ) : null}
        {showReply ? (
          <Button size="sm" variant="ghost" disabled={busy || drafting} onClick={() => void onAct(row, "redraft")}>
            Redraft
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onAct(row, "done")}>Done</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAct(row, "snooze", { hours: 24 })}>Snooze a day</Button>
      </footer>
    </article>
  );
}
