import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, HammerIcon, MessageSquareIcon, PencilRulerIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { useProjects } from "../../state/entities";
import { inboxRequest, refreshInbox, type TaskStatus } from "../../state/inbox";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { ago } from "./shared";

/** A thread or a Chief build started from a ClickUp task or an Inbox row, as the company service reports it. */
interface WorkLink {
  readonly kind: "thread" | "build";
  readonly id: string;
  readonly repo: string;
  readonly created_at: string;
  readonly title?: string;
  readonly state?: {
    readonly title: string;
    readonly status: string;
    readonly mode: string;
    readonly deleted: boolean;
  } | null;
  readonly task?: {
    readonly status: string;
    readonly title: string;
    readonly pr_url: string | null;
    readonly review: string | null;
    readonly spec: string | null;
  };
}

const BUILD_LABEL: Record<string, string> = {
  speccing: "Writing the spec",
  proposed: "Spec to approve",
  spec_failed: "Spec failed",
  approved: "Building",
  running: "Building",
  failed_rung: "Building",
  needs_owner: "Needs you",
  green: "Pull request ready",
  discarded: "Discarded",
};
const THREAD_LABEL: Record<string, string> = {
  running: "Working",
  starting: "Starting",
  ready: "Waiting for you",
  idle: "Waiting for you",
  error: "Stopped on an error",
  deleted: "Deleted",
};

/**
 * "Work on it": start a Plan-mode thread primed with the task, or let Chief build it, and see what was
 * started from here. `source` picks the service routes: a ClickUp task or an Inbox row.
 */
export function WorkPanel({
  base,
  environmentId,
  source,
  id,
  allowBuild,
  statuses,
}: {
  base: string;
  environmentId: EnvironmentId;
  source: "mytask" | "item";
  id: string;
  allowBuild: boolean;
  /** The ClickUp list's statuses, for "post the pull request and move the task". */
  statuses?: ReadonlyArray<TaskStatus>;
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const repos = useMemo(
    () =>
      projects
        .filter((p) => p.environmentId === environmentId && p.workspaceRoot)
        .map((p) => ({ path: p.workspaceRoot, name: p.title })),
    [projects, environmentId],
  );
  const [repo, setRepo] = useState("");
  useEffect(() => {
    if (!repo || !repos.some((r) => r.path === repo)) setRepo(repos[0]?.path ?? "");
  }, [repos, repo]);
  const prefix =
    source === "mytask" ? `/mytasks/${encodeURIComponent(id)}` : `/items/${encodeURIComponent(id)}`;
  const [links, setLinks] = useState<ReadonlyArray<WorkLink> | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [goal, setGoal] = useState("");
  const load = useCallback(async () => {
    try {
      setLinks((await inboxRequest<{ links: WorkLink[] }>(base, `${prefix}/links`)).links);
    } catch {
      setLinks([]);
    }
  }, [base, prefix]);
  useEffect(() => {
    void load();
  }, [load]);
  const moving = (links ?? []).some(
    (l) =>
      (l.kind === "build" &&
        ["speccing", "approved", "running", "failed_rung"].includes(l.task?.status ?? "")) ||
      (l.kind === "thread" && l.state?.status === "running"),
  );
  useEffect(() => {
    const t = setInterval(() => void load(), moving ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [moving, load]);
  const fail = (title: string, e: unknown) =>
    toastManager.add({
      type: "error",
      title,
      description: e instanceof Error ? e.message : String(e),
    });
  const startThread = async () => {
    setBusy(true);
    try {
      const r = await inboxRequest<{ thread_id: string; links: WorkLink[] }>(
        base,
        `${prefix}/thread`,
        { method: "POST", body: { repo, mode: "plan" } },
      );
      setLinks(r.links);
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: r.thread_id },
      });
    } catch (e) {
      fail("The thread did not start", e);
    } finally {
      setBusy(false);
    }
  };
  const startBuild = async () => {
    setBusy(true);
    try {
      setLinks(
        (
          await inboxRequest<{ links: WorkLink[] }>(base, `${prefix}/build`, {
            method: "POST",
            body: { repo, ...(goal.trim() ? { goal } : {}) },
          })
        ).links,
      );
      setComposing(false);
      setGoal("");
      void refreshInbox(environmentId);
    } catch (e) {
      fail("The build did not start", e);
    } finally {
      setBusy(false);
    }
  };
  const buildAction = async (buildId: string, action: "approve" | "discard") => {
    setBusy(true);
    try {
      setLinks(
        (
          await inboxRequest<{ links: WorkLink[] }>(
            base,
            `${prefix}/build/${encodeURIComponent(buildId)}/${action}`,
            { method: "POST", body: {} },
          )
        ).links,
      );
      void refreshInbox(environmentId);
    } catch (e) {
      fail("That did not work", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-sm">
        <HammerIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">Work on it</span>
        <span className="flex-1" />
        {repos.length > 1 ? (
          <Select value={repo} onValueChange={(v) => typeof v === "string" && setRepo(v)}>
            <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Repository">
              <SelectValue>
                {repos.find((r) => r.path === repo)?.name ?? "Choose a repository"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {repos.map((r) => (
                <SelectItem hideIndicator key={r.path} value={r.path}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : repos[0] ? (
          <span className="text-xs text-muted-foreground">{repos[0].name}</span>
        ) : null}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {repos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add the repository as a project in Chief first.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !repo}
              onClick={() => void startThread()}
            >
              <PencilRulerIcon className="size-3.5" />
              Start a thread
            </Button>
            {allowBuild ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !repo}
                onClick={() => setComposing((v) => !v)}
              >
                <HammerIcon className="size-3.5" />
                Let Chief build it
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              A thread opens in Plan mode with the task in it. A build writes a spec for you to
              approve first.
            </span>
          </div>
        )}
        {composing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              unstyled
              value={goal}
              placeholder="What should be built. Leave it empty to use the task as written."
              className="block w-full rounded-lg border border-border/60 bg-background/60 [&_textarea]:min-h-24 [&_textarea]:resize-y [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setGoal(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy || !repo} onClick={() => void startBuild()}>
                Write the spec
              </Button>
            </div>
          </div>
        ) : null}
        {links === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Loading linked work
          </p>
        ) : links.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border/50">
            {links.map((l) => (
              <LinkRow
                key={`${l.kind}:${l.id}`}
                link={l}
                busy={busy}
                environmentId={environmentId}
                statuses={statuses}
                base={base}
                taskId={source === "mytask" ? id : null}
                onOpenThread={(threadId) =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId, threadId },
                  })
                }
                onBuild={(buildId, action) => void buildAction(buildId, action)}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function LinkRow({
  link,
  busy,
  statuses,
  base,
  taskId,
  onOpenThread,
  onBuild,
}: {
  link: WorkLink;
  busy: boolean;
  environmentId: EnvironmentId;
  statuses: ReadonlyArray<TaskStatus> | undefined;
  base: string;
  taskId: string | null;
  onOpenThread: (threadId: string) => void;
  onBuild: (buildId: string, action: "approve" | "discard") => void;
}) {
  const [showSpec, setShowSpec] = useState(false);
  if (link.kind === "thread") {
    const status = link.state?.status ?? "unknown";
    return (
      <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {link.state?.title || link.title || "Thread"}
        </span>
        {link.state?.mode === "plan" ? (
          <Badge variant="info" size="sm">
            Plan
          </Badge>
        ) : null}
        <Badge
          variant={status === "error" ? "error" : status === "running" ? "info" : "secondary"}
          size="sm"
        >
          {THREAD_LABEL[status] ?? status}
        </Badge>
        <span className="text-xs text-muted-foreground">{ago(link.created_at)}</span>
        {link.state?.deleted ? null : (
          <Button size="xs" variant="outline" onClick={() => onOpenThread(link.id)}>
            Open
          </Button>
        )}
      </li>
    );
  }
  const status = link.task?.status ?? "speccing";
  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <HammerIcon className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => setShowSpec((v) => !v)}
        >
          Chief build{link.task?.title ? `: ${link.task.title}` : ""}
        </button>
        <Badge
          variant={
            status === "green"
              ? "success"
              : ["spec_failed", "needs_owner"].includes(status)
                ? "error"
                : "info"
          }
          size="sm"
        >
          {BUILD_LABEL[status] ?? status}
        </Badge>
        {status === "proposed" ? (
          <>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => onBuild(link.id, "discard")}
            >
              Discard
            </Button>
            <Button size="xs" disabled={busy} onClick={() => onBuild(link.id, "approve")}>
              Approve and build
            </Button>
          </>
        ) : null}
        {link.task?.pr_url ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={link.task.pr_url} target="_blank" rel="noreferrer" />}
          >
            Pull request
            <ExternalLinkIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      {(showSpec || status === "proposed") && link.task?.spec ? (
        <div className="ml-6 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-3 text-sm whitespace-pre-wrap">
          {link.task.spec}
        </div>
      ) : null}
      {status === "green" && link.task?.pr_url && taskId ? (
        <PostBack base={base} taskId={taskId} prUrl={link.task.pr_url} statuses={statuses ?? []} />
      ) : null}
    </li>
  );
}

/** Offer to post the pull request on the ClickUp task and move it, only when the owner presses it. */
function PostBack({
  base,
  taskId,
  prUrl,
  statuses,
}: {
  base: string;
  taskId: string;
  prUrl: string;
  statuses: ReadonlyArray<TaskStatus>;
}) {
  const review = statuses.find((s) => /review|qa|testing/i.test(s.status));
  const [status, setStatus] = useState(review?.status ?? "");
  const [comment, setComment] = useState(`The change is ready for review: ${prUrl}`);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done)
    return <p className="ml-6 text-xs text-muted-foreground">Posted on the ClickUp task.</p>;
  return (
    <div className="ml-6 flex flex-col gap-2 rounded-lg border border-border/60 bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">Tell the team on ClickUp?</p>
      <Textarea
        unstyled
        value={comment}
        className="block w-full [&_textarea]:min-h-14 [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:text-sm"
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">and move it to</span>
        <Select
          value={status || "__keep"}
          onValueChange={(v) => typeof v === "string" && setStatus(v === "__keep" ? "" : v)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Move the task to">
            <SelectValue>{status || "Keep the status"}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="__keep">
              Keep the status
            </SelectItem>
            {statuses.map((s) => (
              <SelectItem hideIndicator key={s.status} value={s.status}>
                <span className="capitalize">{s.status}</span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="sm"
          disabled={busy || (!comment.trim() && !status)}
          onClick={() => {
            setBusy(true);
            void inboxRequest(base, `/mytasks/${encodeURIComponent(taskId)}/apply`, {
              method: "POST",
              body: { status, comment },
            })
              .then(() => setDone(true))
              .catch((e) =>
                toastManager.add({
                  type: "error",
                  title: "Not posted",
                  description: e instanceof Error ? e.message : String(e),
                }),
              )
              .finally(() => setBusy(false));
          }}
        >
          Post on the task
        </Button>
      </div>
    </div>
  );
}
