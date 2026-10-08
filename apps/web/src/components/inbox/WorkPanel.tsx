import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  FileTextIcon,
  HammerIcon,
  ScrollTextIcon,
  MessageSquareIcon,
  PencilRulerIcon,
} from "lucide-react";
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
import { SpecSheet } from "./SpecSheet";

/** A thread or a Chief build started from a ClickUp task or an Inbox row, as the company service reports it. */
interface WorkLink {
  readonly kind: "thread" | "build" | "spec";
  readonly id: string;
  readonly repo: string;
  readonly created_at: string;
  readonly title?: string;
  /** When the owner posted this build's pull request back to the ClickUp task. */
  readonly posted_at?: string;
  readonly state?: {
    readonly title: string;
    readonly status: string;
    readonly mode: string;
    readonly deleted: boolean;
  } | null;
  readonly spec?: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly needs_you: boolean;
    readonly progress: { readonly merged: number; readonly total: number };
  } | null;
  readonly task?: {
    readonly status: string;
    readonly title: string;
    readonly pr_url: string | null;
    readonly staging_pr_url?: string | null;
    readonly pair_error?: string | null;
    readonly review: string | null;
    readonly spec: string | null;
    readonly checks?: ReadonlyArray<{ readonly id: string; readonly what: string }>;
    readonly thread_id?: string | null;
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
  stopped: "Stopped",
  interrupted: "Stopped",
  deleted: "Deleted",
};

/** The company's base folder and repositories, as the company service lists them (its app/repos). */
export interface CompanyRepos {
  readonly base: string | null;
  readonly repos: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}
const companyReposCache = new Map<string, CompanyRepos>();
export function useCompanyRepos(base: string): CompanyRepos {
  const [state, setState] = useState<CompanyRepos>(
    () => companyReposCache.get(base) ?? { base: null, repos: [] },
  );
  useEffect(() => {
    let live = true;
    void inboxRequest<{ base: string; repos: { name: string; path: string }[] }>(base, "/repos")
      .then((d) => {
        const next = { base: d.base, repos: d.repos };
        companyReposCache.set(base, next);
        if (live) setState(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);
  return state;
}

/**
 * "Work on it": start a Plan-mode thread primed with the task, or let Chief build it, and see what was
 * started from here. `source` picks the service routes: a ClickUp task or an Inbox row. A thread opens
 * at the company's base folder by default, so it sees every repository and decides; a build needs one
 * repository, the one named in the text when there is one.
 */
export function WorkPanel({
  base,
  environmentId,
  source,
  id,
  allowBuild,
  statuses,
  onBuildClick,
  hint,
  compact = false,
}: {
  base: string;
  environmentId: EnvironmentId;
  source: "mytask" | "item";
  id: string;
  allowBuild: boolean;
  /** The ClickUp list's statuses, for "post the pull request and move the task". */
  statuses?: ReadonlyArray<TaskStatus>;
  /** When given, "Let Chief build it" calls this instead of opening the panel's own composer. */
  onBuildClick?: () => void;
  /** Text the work is about: a repository named in it is the build's default. */
  hint?: string;
  /** One row of buttons; the linked work below only when there is any. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const company = useCompanyRepos(base);
  const projectRoots = useMemo(
    () =>
      new Set(
        projects
          .filter((p) => p.environmentId === environmentId && p.workspaceRoot)
          .map((p) => p.workspaceRoot),
      ),
    [projects, environmentId],
  );
  // what a thread can open in: the whole company first, then each repository the console knows
  const repos = useMemo(() => {
    const list: { path: string; name: string }[] = [];
    if (company.base && projectRoots.has(company.base))
      list.push({ path: company.base, name: "Whole company" });
    for (const r of company.repos) if (projectRoots.has(r.path)) list.push(r);
    if (list.length === 0)
      for (const p of projects)
        if (p.environmentId === environmentId && p.workspaceRoot)
          list.push({ path: p.workspaceRoot, name: p.title });
    return list;
  }, [company, projectRoots, projects, environmentId]);
  const buildRepos = useMemo(
    () => repos.filter((r) => r.path !== company.base),
    [repos, company.base],
  );
  const [repo, setRepo] = useState("");
  useEffect(() => {
    if (!repo || !repos.some((r) => r.path === repo)) setRepo(repos[0]?.path ?? "");
  }, [repos, repo]);
  const [buildRepo, setBuildRepo] = useState("");
  useEffect(() => {
    if (buildRepo && buildRepos.some((r) => r.path === buildRepo)) return;
    const text = (hint ?? "").toLowerCase();
    const named = buildRepos.find((r) => text.includes(r.name.toLowerCase()));
    setBuildRepo((named ?? (buildRepos.length === 1 ? buildRepos[0] : undefined))?.path ?? "");
  }, [buildRepos, buildRepo, hint]);
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
  const [wholeCompany, setWholeCompany] = useState(true);
  const startBuild = async () => {
    setBusy(true);
    try {
      setLinks(
        (
          await inboxRequest<{ links: WorkLink[] }>(
            base,
            wholeCompany ? `${prefix}/spec` : `${prefix}/build`,
            {
              method: "POST",
              body: wholeCompany
                ? { ...(goal.trim() ? { goal } : {}) }
                : { repo: buildRepo, ...(goal.trim() ? { goal } : {}) },
            },
          )
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
            {company.repos.length > 0
              ? "Chief is adding the company's repositories to the console. A moment."
              : "No repositories found for this company: put them under its app/repos folder."}
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
                disabled={busy}
                onClick={() => (onBuildClick ? onBuildClick() : setComposing((v) => !v))}
              >
                <HammerIcon className="size-3.5" />
                Let Chief build it
              </Button>
            ) : null}
            {compact ? null : (
              <span className="text-xs text-muted-foreground">
                {allowBuild
                  ? "A thread opens with the whole company in view. A build writes a spec for you to approve first."
                  : "A thread opens in Plan mode with the message in it, to plan or answer it with the code."}
              </span>
            )}
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select
                value={wholeCompany ? "__company" : buildRepo || "__none"}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  setWholeCompany(v === "__company");
                  if (v !== "__company" && v !== "__none") setBuildRepo(v);
                }}
              >
                <SelectTrigger size="sm" className="w-auto min-w-44" aria-label="Where to build">
                  <SelectValue>
                    {wholeCompany
                      ? "Whole company"
                      : buildRepo
                        ? `Only ${buildRepos.find((r) => r.path === buildRepo)?.name ?? ""}`
                        : "Choose a repository"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="__company">
                    Whole company
                  </SelectItem>
                  {buildRepos.map((r) => (
                    <SelectItem hideIndicator key={r.path} value={r.path}>
                      Only {r.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || (!wholeCompany && !buildRepo)}
                onClick={() => void startBuild()}
              >
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
                onPosted={() => void load()}
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
  environmentId,
  busy,
  statuses,
  base,
  taskId,
  onOpenThread,
  onBuild,
  onPosted,
}: {
  link: WorkLink;
  busy: boolean;
  environmentId: EnvironmentId;
  statuses: ReadonlyArray<TaskStatus> | undefined;
  base: string;
  taskId: string | null;
  onOpenThread: (threadId: string) => void;
  onBuild: (buildId: string, action: "approve" | "discard") => void;
  onPosted: () => void;
}) {
  const [showSpec, setShowSpec] = useState(false);
  const navigate = useNavigate();
  if (link.kind === "spec") {
    const sp = link.spec;
    const label = sp
      ? ({
          prd: "PRD written",
          drafting: "Reading the repositories",
          requirements_to_approve: "Requirements to approve",
          design_to_approve: "Design to approve",
          building: `Building, ${sp.progress.merged} of ${sp.progress.total} merged`,
          done: "Done",
        }[sp.status] ?? sp.status)
      : "Spec";
    return (
      <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <ScrollTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Spec: {sp?.title || link.title || link.id}</span>
        <Badge variant={sp?.needs_you ? "warning" : "info"} size="sm">
          {label}
        </Badge>
        <span className="text-xs text-muted-foreground">{ago(link.created_at)}</span>
        <Button
          size="xs"
          variant={sp?.needs_you ? "default" : "outline"}
          onClick={() => void navigate({ to: "/specs", search: { spec: link.id } })}
        >
          Open the spec
        </Button>
      </li>
    );
  }
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
            <Button size="xs" variant="outline" onClick={() => setShowSpec(true)}>
              <FileTextIcon className="size-3" />
              Read the spec
            </Button>
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
        {link.task?.thread_id ? (
          <Button size="xs" variant="outline" onClick={() => onOpenThread(link.task!.thread_id!)}>
            Watch
          </Button>
        ) : null}
        {link.task?.pr_url ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={link.task.pr_url} target="_blank" rel="noreferrer" />}
          >
            main PR
            <ExternalLinkIcon className="size-3" />
          </Button>
        ) : null}
        {link.task?.staging_pr_url ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={link.task.staging_pr_url} target="_blank" rel="noreferrer" />}
          >
            staging PR
            <ExternalLinkIcon className="size-3" />
          </Button>
        ) : link.task?.pr_url ? (
          <Badge variant="warning" size="sm" title={link.task.pair_error ?? undefined}>
            no staging pair
          </Badge>
        ) : null}
      </div>
      {link.task?.spec ? (
        <SpecSheet
          open={showSpec}
          onOpenChange={setShowSpec}
          title={link.task.title || "Chief build"}
          spec={link.task.spec}
          checks={link.task.checks ?? []}
          environmentId={environmentId}
          footer={
            status === "proposed" ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onBuild(link.id, "discard")}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setShowSpec(false);
                    onBuild(link.id, "approve");
                  }}
                >
                  Approve and build
                </Button>
              </>
            ) : null
          }
        />
      ) : null}
      {status === "green" && link.task?.pr_url && taskId ? (
        link.posted_at ? (
          <p className="ml-6 text-xs text-muted-foreground">
            Posted on the ClickUp task {ago(link.posted_at)}.
          </p>
        ) : (
          <PostBack
            base={base}
            taskId={taskId}
            buildId={link.id}
            prUrl={link.task.pr_url}
            statuses={statuses ?? []}
            onPosted={onPosted}
          />
        )
      ) : null}
    </li>
  );
}

/** Offer to post the pull request on the ClickUp task and move it, only when the owner presses it. */
function PostBack({
  base,
  taskId,
  buildId,
  prUrl,
  statuses,
  onPosted,
}: {
  base: string;
  taskId: string;
  buildId: string;
  prUrl: string;
  statuses: ReadonlyArray<TaskStatus>;
  onPosted: () => void;
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
              body: { status, comment, build_id: buildId },
            })
              .then(() => {
                setDone(true);
                onPosted();
              })
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
