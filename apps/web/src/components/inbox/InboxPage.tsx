import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { inOrganisationScope, useOrganisationLabel, useOrganisationScope } from "../../state/organisation";
import { inboxRequest, refreshInbox, useInboxFeeds, type EnvironmentInbox, type InboxItem } from "../../state/inbox";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

interface Row extends InboxItem {
  readonly environmentId: EnvironmentId;
  readonly base: string;
  readonly organisation: string;
}
type Act = (row: Row, action: string, body?: unknown) => Promise<boolean>;

const LIVE_TASK = (row: InboxItem) => Boolean(row.task && row.task.status !== "discarded");
const CAN_REPLY = (row: InboxItem) => Boolean(row.reply_to) || typeof row.context.task_id === "string";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const KIND_LABEL: Record<string, string> = {
  mention: "tagged you", "comment-assigned": "assigned to you", assigned: "task assigned", direct: "direct message",
  "chat-mention": "tagged you", channel: "watched channel", task: "task", note: "note",
};

export function InboxPage() {
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const labelFor = useCallback(
    (environmentId: EnvironmentId) =>
      organisationLabel(environmentId, environments.find((e) => e.environmentId === environmentId)?.label ?? environmentId),
    [environments, organisationLabel],
  );
  const inScope = useMemo(() => feeds.filter((feed) => inOrganisationScope(scope, feed.environmentId)), [feeds, scope]);
  const rows = useMemo<Row[]>(
    () =>
      inScope
        .flatMap((feed) => feed.items.map((item) => ({ ...item, environmentId: feed.environmentId, base: feed.base, organisation: labelFor(feed.environmentId) })))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [inScope, labelFor],
  );
  const tasks = rows.filter(LIVE_TASK);
  const replies = rows.filter((row) => !LIVE_TASK(row) && row.next_action === "Reply" && row.draft.kind !== "fyi");
  const rest = rows.filter((row) => !tasks.includes(row) && !replies.includes(row));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback<Act>(async (row, action, body) => {
    setBusy(row.id);
    setError(null);
    try {
      await inboxRequest(row.base, `/items/${encodeURIComponent(row.id)}/${action}`, { method: "POST", body: body ?? {} });
      await refreshInbox(row.environmentId);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  const showOrganisation = scope === "all";
  const render = (row: Row) => (
    <InboxRow key={`${row.environmentId}:${row.id}`} row={row} busy={busy === row.id} showOrganisation={showOrganisation} onAct={act} />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">Inbox</h1>
        <span className="truncate text-sm text-muted-foreground">{scope === "all" ? "All organisations" : labelFor(scope)}</span>
        <Badge variant="secondary" size="sm">{rows.length}</Badge>
        <div className="min-w-0 flex-1" />
        <Button variant="ghost" size="sm" onClick={() => void refreshInbox()}>
          <RefreshCwIcon className="size-4" />
          Refresh
        </Button>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded" className="min-h-full gap-6 py-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {inScope.map((feed) => (
            <FeedNotice key={feed.environmentId} feed={feed} label={labelFor(feed.environmentId)} />
          ))}
          {inScope.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connected organisation in view.</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing waits on you.</p>
          ) : null}
          {tasks.length > 0 ? <Section title="Tasks" count={tasks.length}>{tasks.map(render)}</Section> : null}
          {replies.length > 0 ? <Section title="Needs a reply" count={replies.length}>{replies.map(render)}</Section> : null}
          {rest.length > 0 ? <Section title="Have a look" count={rest.length}>{rest.map(render)}</Section> : null}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

function FeedNotice({ feed, label }: { feed: EnvironmentInbox; label: string }) {
  const message = feed.error
    ? `${label}: the inbox service is not answering at ${feed.base}.`
    : feed.health && !feed.health.configured
      ? `${label}: ClickUp is not connected. Connect it under Settings, Integrations, Inbox.`
      : feed.health?.last_error
        ? `${label}: ${feed.health.last_error}`
        : null;
  if (!message) return null;
  return <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{message}</p>;
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
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

function InboxRow({ row, busy, showOrganisation, onAct }: { row: Row; busy: boolean; showOrganisation: boolean; onAct: Act }) {
  const [composing, setComposing] = useState(false);
  const liveTask = LIVE_TASK(row);
  const replyable = CAN_REPLY(row) && !liveTask;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" size="sm">{row.source}</Badge>
        {showOrganisation ? <span className="font-medium text-foreground/80">{row.organisation}</span> : null}
        <span className="font-medium text-foreground/80">{row.who || "someone"}</span>
        <span aria-hidden>·</span>
        <time dateTime={row.created_at}>{timeAgo(row.created_at)}</time>
        <div className="flex-1" />
        <span>{KIND_LABEL[row.kind] ?? row.kind}</span>
      </header>
      <h3 className="text-sm font-medium">
        {row.url ? (
          <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {row.title}
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
          </a>
        ) : row.title}
      </h3>
      {row.body ? <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap text-foreground/90">{row.body}</p> : null}
      {liveTask ? <TaskPanel row={row} busy={busy} onAct={onAct} onRetry={() => setComposing(true)} /> : null}
      {composing ? (
        <TaskComposer row={row} busy={busy} onAct={onAct} onClose={() => setComposing(false)} />
      ) : replyable ? (
        <ReplyBox row={row} busy={busy} onAct={onAct} />
      ) : null}
      <footer className="flex flex-wrap items-center gap-2">
        {!liveTask && !composing && row.source !== "chief" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setComposing(true)}>
            Make this a task
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAct(row, "snooze", { hours: 24 })}>Snooze a day</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onAct(row, "done")}>Done</Button>
      </footer>
    </article>
  );
}

function ReplyBox({ row, busy, onAct }: { row: Row; busy: boolean; onAct: Act }) {
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
  const drafting = row.draft.state === "pending";
  const hasDraft = row.draft.state === "ready" || row.draft.state === "failed";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Your reply</span>
        {drafting ? (<><Spinner className="size-3" /><span>drafting from the code</span></>) : null}
        {row.draft.state === "ready" && row.draft.confidence ? <span>· confidence {row.draft.confidence}</span> : null}
        {row.draft.state === "ready" && row.draft.edited ? <span>· edited</span> : null}
        {row.draft.state === "failed" ? <span className="text-destructive">· the draft failed: {row.draft.error}</span> : null}
      </div>
      {row.draft.needs && row.draft.needs.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-foreground/80">
          {row.draft.needs.map((need) => (<li key={need}>Needs you: {need}</li>))}
        </ul>
      ) : null}
      <Textarea
        value={text}
        rows={4}
        placeholder={drafting ? "Drafting a reply from the code" : "Write a reply, or draft one from the code"}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
        onBlur={saveDraft}
      />
      {row.draft.checked && row.draft.checked.length > 0 ? (
        <p className="text-xs text-muted-foreground">Checked: {row.draft.checked.join(", ")}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || drafting || text.trim().length === 0} onClick={() => void onAct(row, "send", { text })}>
          Send reply
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || drafting} onClick={() => void onAct(row, "redraft")}>
          {hasDraft ? "Redraft" : "Draft a reply"}
        </Button>
      </div>
    </div>
  );
}

function goalFrom(row: Row): string {
  const ctx = row.context as { where?: unknown; thread?: unknown };
  const where = typeof ctx.where === "string" ? ctx.where : row.title;
  const lines = [`${row.who || "A colleague"} wrote in ${where}${row.url ? ` (${row.url})` : ""}:`, "", row.body.trim()];
  // earlier messages only: the message itself is already above
  const thread = Array.isArray(ctx.thread)
    ? (ctx.thread as { who?: string; text?: string }[]).filter((x) => x.text && !row.body.includes(x.text)).slice(-4)
    : [];
  if (thread.length > 0) lines.push("", "Earlier messages:", ...thread.map((x) => `- ${x.who ?? "someone"}: ${x.text ?? ""}`));
  lines.push("", "Build what this asks for, and keep the change as small as the request allows.");
  return lines.join("\n");
}

function TaskComposer({ row, busy, onAct, onClose }: { row: Row; busy: boolean; onAct: Act; onClose: () => void }) {
  const projects = useProjects();
  const repos = useMemo(
    () => projects.filter((p) => p.environmentId === row.environmentId && p.workspaceRoot).map((p) => ({ path: p.workspaceRoot, name: p.title })),
    [projects, row.environmentId],
  );
  const [goal, setGoal] = useState(() => goalFrom(row));
  const [repo, setRepo] = useState<string>(() => repos[0]?.path ?? "");
  useEffect(() => {
    if (!repo && repos[0]) setRepo(repos[0].path);
  }, [repo, repos]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        The spec-writer reads the repository and proposes a spec with acceptance checks. You approve it before anything is built.
      </p>
      <Textarea value={goal} rows={7} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setGoal(event.target.value)} aria-label="What should be built" />
      <div className="flex flex-wrap items-center gap-2">
        {repos.length === 0 ? (
          <span className="text-xs text-muted-foreground">Add the repository as a project in Chief first.</span>
        ) : (
          <Select value={repo} onValueChange={(value) => typeof value === "string" && setRepo(value)}>
            <SelectTrigger size="sm" className="w-full sm:w-64" aria-label="Repository">
              <SelectValue>{repos.find((r) => r.path === repo)?.name ?? "Choose a repository"}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {repos.map((r) => (
                <SelectItem hideIndicator key={r.path} value={r.path}>{r.name}</SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={busy || !repo || goal.trim().length < 10}
          onClick={() => void onAct(row, "task", { goal, repo, title: row.title }).then((ok) => ok && onClose())}
        >
          Write the spec
        </Button>
      </div>
    </div>
  );
}

function TaskPanel({ row, busy, onAct, onRetry }: { row: Row; busy: boolean; onAct: Act; onRetry: () => void }) {
  const task = row.task!;
  const waiting = (text: string) => (
    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />{text}</p>
  );
  let body: ReactNode = null;
  let actions: ReactNode = null;
  switch (task.status) {
    case "speccing":
      body = waiting("The spec-writer is reading the code and writing the spec.");
      break;
    case "proposed":
      body = (
        <>
          <p className="text-sm">Spec ready, with {task.acceptance_cases ?? 0} acceptance checks. Nothing is built until you approve.</p>
          {task.spec ? <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap">{task.spec}</div> : null}
        </>
      );
      actions = (
        <>
          <Button size="sm" disabled={busy} onClick={() => void onAct(row, "approve")}>Approve and build</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAct(row, "discard")}>Discard</Button>
        </>
      );
      break;
    case "spec_failed":
      body = <p className="text-sm text-destructive">The spec-writer stopped: {task.error ?? "no reason given"}</p>;
      actions = (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>Try again</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAct(row, "discard")}>Discard</Button>
        </>
      );
      break;
    case "approved":
    case "running":
    case "failed_rung":
      body = waiting("Building: implementer, done-gate, reviewer. This takes a while.");
      break;
    case "green":
      body = task.pr_url ? (
        <p className="text-sm">
          Built and reviewed.{" "}
          <a href={task.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
            Open the draft pull request <ExternalLinkIcon className="size-3.5" />
          </a>
        </p>
      ) : (
        <p className="text-sm">Built and reviewed. {task.reasons ? `The pull request did not open: ${task.reasons}` : ""}</p>
      );
      break;
    case "needs_owner":
      body = (
        <>
          <p className="text-sm">The build stopped and needs you.</p>
          {task.reasons ? <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background p-3 text-xs whitespace-pre-wrap">{task.reasons}</div> : null}
        </>
      );
      actions = <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAct(row, "discard")}>Discard</Button>;
      break;
    default:
      body = <p className="text-sm text-muted-foreground">Task status: {task.status}</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Task {task.title ? `"${task.title}"` : task.id}</p>
      {body}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
