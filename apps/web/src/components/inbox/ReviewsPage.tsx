import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleIcon,
  EyeIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  XIcon,
  LogInIcon,
  PlayIcon,
  RotateCwIcon,
  SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { inboxRequest, refreshInbox, useInboxFeeds } from "../../state/inbox";
import {
  inOrganisationScope,
  useOrganisationLabel,
  useOrganisationScope,
} from "../../state/organisation";
import type { ReleaseBoard, ReleaseCard, ReleaseStuck } from "../../state/reviews";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ago } from "./shared";

/** The board's columns, left to right: what waits on you, then a request's way through. */
const COLUMNS = [
  { id: "requested", title: "Requested", hint: "Asked in the channel, needs your review" },
  { id: "reviewing", title: "Reviewing", hint: "A review thread is working on it" },
  { id: "reviewed", title: "Reviewed", hint: "The verdict is on GitHub, or a draft" },
  { id: "replied", title: "Replied", hint: "The requester has the answer in ClickUp" },
] as const;
const agoMs = (ms: number | null | undefined) => (ms ? ago(new Date(ms).toISOString()) : "never");
const fail = (title: string, e: unknown) =>
  toastManager.add({
    type: "error",
    title,
    description: e instanceof Error ? e.message : String(e),
  });

export function ReviewsPage() {
  const navigate = useNavigate();
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const sources = useMemo(
    () => feeds.filter((f) => inOrganisationScope(scope, f.environmentId) && !f.error),
    [feeds, scope],
  );
  const labelFor = useCallback(
    (env: EnvironmentId) =>
      organisationLabel(env, environments.find((e) => e.environmentId === env)?.label ?? env),
    [environments, organisationLabel],
  );
  // One board at a time: the organisation's company, or (all organisations) the one chosen here.
  const [picked, setPicked] = useState<EnvironmentId | null>(null);
  const source =
    sources.find((f) => f.environmentId === picked) ??
    sources.find((f) => f.health?.release?.enabled) ??
    sources[0] ??
    null;
  const base = source?.base ?? null;
  const env = source?.environmentId ?? null;

  const [board, setBoard] = useState<ReleaseBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!base) return;
    try {
      setBoard(await inboxRequest<ReleaseBoard>(base, "/release"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base]);
  useEffect(() => setBoard(null), [base]);
  const live = Boolean(
    board?.running || board?.login.busy || (board?.stages.reviewing.length ?? 0) > 0,
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), live ? 4_000 : 30_000);
    return () => clearInterval(t);
  }, [load, live]);
  const call = async (path: string, method: string, body?: unknown) => {
    if (!base) return false;
    setBusy(true);
    try {
      setBoard(
        await inboxRequest<ReleaseBoard>(
          base,
          path,
          body === undefined ? { method } : { method, body },
        ),
      );
      if (env) void refreshInbox(env);
      return true;
    } catch (e) {
      fail("That did not work", e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const watch = (threadId: string) => {
    if (env)
      void navigate({ to: "/$environmentId/$threadId", params: { environmentId: env, threadId } });
  };

  const cfg = board?.config ?? null;
  const configured = Boolean(cfg?.channel && cfg?.kit_source);
  const lastRun = board?.runs[0];
  const stuckByThread = new Map<string, ReleaseStuck>(
    (board?.stuck ?? []).map((s) => [s.thread, s]),
  );
  const count = (id: (typeof COLUMNS)[number]["id"]) => (!board ? 0 : board.stages[id].length);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">PR reviews</h1>
        {sources.length > 1 && source ? (
          <Select
            value={source.environmentId}
            onValueChange={(v) => typeof v === "string" && setPicked(v as EnvironmentId)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Company">
              <SelectValue>{labelFor(source.environmentId)}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {sources.map((f) => (
                <SelectItem hideIndicator key={f.environmentId} value={f.environmentId}>
                  {labelFor(f.environmentId)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <span className="truncate text-sm text-muted-foreground">
            {source ? labelFor(source.environmentId) : ""}
          </span>
        )}
        {cfg ? (
          <div className="hidden items-center gap-1.5 lg:flex">
            <Badge variant={cfg.enabled ? "success" : "secondary"} size="sm">
              {cfg.enabled ? `Checks every ${cfg.interval_min} min` : "Not checking"}
            </Badge>
            <Badge
              variant={!cfg.review ? "secondary" : cfg.post && cfg.reply ? "info" : "warning"}
              size="sm"
            >
              {!cfg.review
                ? "Reviews off"
                : cfg.post && cfg.reply
                  ? "Reviews, posts and replies"
                  : cfg.post
                    ? "Posts on GitHub, no ClickUp replies"
                    : "Reviews as drafts"}
            </Badge>
            <Badge variant={board?.window_open ? "success" : "secondary"} size="sm">
              {board?.window_open ? "Posting window open" : "Posts wait for 09:30 to 17:00"}
            </Badge>
          </div>
        ) : null}
        <div className="min-w-0 flex-1" />
        {board ? (
          <span
            className="hidden truncate text-xs text-muted-foreground md:inline"
            title={lastRun?.error ?? ""}
          >
            {board.running
              ? "Checking the channel now"
              : lastRun
                ? `Checked ${agoMs(lastRun.at)}: ${lastRun.threads} threads${lastRun.failed ? `, ${lastRun.failed} to retry` : ""}`
                : "Not checked yet"}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !board || board.running || !configured}
          onClick={() => void call("/release/run", "POST")}
        >
          {board?.running ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          Check now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void navigate({ to: "/settings/integrations", hash: "chief-pr-reviews" })}
        >
          <SettingsIcon className="size-3.5" />
          Settings
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border/50">
        {!source && feeds.length === 0 ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Spinner className="size-3.5" /> Loading PR reviews
          </p>
        ) : !source ? (
          <p className="p-6 text-sm text-muted-foreground">
            No company service is answering for this organisation.
          </p>
        ) : error && !board ? (
          <p className="p-6 text-sm text-destructive">{error}</p>
        ) : !board || !cfg ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Spinner className="size-3.5" /> Loading PR reviews
          </p>
        ) : (
          <>
            {!configured ? (
              <div className="flex flex-col items-start gap-3 p-6 text-sm">
                <p className="text-muted-foreground">
                  PR reviews are not set up for{" "}
                  {source ? labelFor(source.environmentId) : "this company"} yet: choose the Release
                  Request channel and the review skills folder.
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    void navigate({ to: "/settings/integrations", hash: "chief-pr-reviews" })
                  }
                >
                  <SettingsIcon className="size-3.5" />
                  Open the PR review settings
                </Button>
              </div>
            ) : null}
            {configured && board.login.logged_in !== true && cfg.reply ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/8 px-4 py-2 text-sm">
                <AlertTriangleIcon className="size-4 text-warning" />
                Replies need Chief's Chrome signed in to ClickUp.
                <span className="flex-1" />
                <Button
                  size="xs"
                  disabled={board.login.busy}
                  onClick={() => void call("/release/login", "POST")}
                >
                  <LogInIcon className="size-3" />
                  {board.login.busy ? "Window open" : "Log in to ClickUp"}
                </Button>
              </div>
            ) : null}
            {configured ? (
              <div className="flex min-h-0 flex-1 gap-2.5 overflow-x-auto p-3">
                {COLUMNS.map((col) => (
                  <section
                    key={col.id}
                    className={cn(
                      "flex min-h-0 basis-0 flex-col rounded-xl border border-border/50 bg-muted/20",
                      "min-w-[13rem] flex-1",
                    )}
                  >
                    <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2 text-xs font-medium text-muted-foreground">
                      <span className="truncate uppercase tracking-wide">{col.title}</span>
                      {col.id === "reviewing" && count("reviewing") > 0 ? (
                        <Spinner className="size-3 text-info" />
                      ) : null}
                      <span className={cn("rounded-full px-1.5 tabular-nums", "bg-muted")}>
                        {count(col.id)}
                      </span>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                      {count(col.id) === 0 ? (
                        <p className="px-1.5 text-xs text-muted-foreground/70">{col.hint}</p>
                      ) : (
                        board.stages[col.id].map((c) => (
                          <StageCard
                            key={`${c.stage}-${c.card ?? c.thread}`}
                            card={c}
                            stuck={stuckByThread.get(c.thread) ?? null}
                            busy={busy}
                            onWatch={watch}
                            onRetry={(key) =>
                              void call(
                                `/release/replies/${encodeURIComponent(key)}/approve`,
                                "POST",
                              )
                            }
                          />
                        ))
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

type Step = "posted" | "draft" | "bailed" | null;

/** "1d 20h ago", "3h ago", "12m ago": how long ago, the way Chief v1 wrote it. */
function since(ms: number | null | undefined): string {
  if (!ms) return "";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ` ${h % 24}h` : ""} ago`;
}

/** The three steps of a request: asked in ClickUp, the verdict on GitHub, the reply in ClickUp. */
function Tracker({ steps }: { steps: { asked: boolean; github: Step; reply: Step } }) {
  const items: ReadonlyArray<[string, Step]> = [
    ["ClickUp", steps.asked ? "posted" : null],
    ["GitHub", steps.github],
    ["ClickUp", steps.reply],
  ];
  return (
    <ol className="flex w-full items-center gap-1.5 text-xs" aria-label="Stages">
      {items.map(([label, state], i) => (
        <li key={i} className={cn("flex min-w-0 items-center gap-1.5", i > 0 && "flex-1")}>
          {i > 0 ? (
            <span
              aria-hidden
              className={cn("h-px min-w-2 flex-1", state ? "bg-success/50" : "bg-foreground/15")}
            />
          ) : null}
          <span
            className={cn(
              "flex items-center gap-1",
              state === "posted"
                ? "text-success"
                : state === "draft"
                  ? "text-warning"
                  : state === "bailed"
                    ? "text-destructive"
                    : "text-muted-foreground",
            )}
            title={`${label}: ${state === "posted" ? "done" : state === "draft" ? "a draft, not posted" : state === "bailed" ? "not done" : "not yet"}`}
          >
            {state === "posted" ? (
              <CheckIcon className="size-3.5" />
            ) : state === "draft" ? (
              <CircleDashedIcon className="size-3.5" />
            ) : state === "bailed" ? (
              <XIcon className="size-3.5" />
            ) : (
              <CircleIcon className="size-3.5" />
            )}
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A link out of the console, as a quiet button. */
function Open({
  href,
  icon,
  children,
  label,
}: {
  href: string;
  icon: ReactNode;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/[0.06] text-xs font-medium text-foreground outline-none hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
        children ? "px-3" : "w-8 justify-center",
      )}
    >
      {icon}
      {children}
    </a>
  );
}

const VERDICT_TONE: Record<string, string> = {
  Approved: "bg-success/10 text-success-foreground",
  "Changes Requested": "bg-warning/10 text-warning-foreground",
  Bailed: "bg-destructive/10 text-destructive-foreground",
};
const VERDICT_DOT: Record<string, string> = {
  Approved: "bg-success",
  "Changes Requested": "bg-warning",
  Bailed: "bg-destructive",
};

function StageCard({
  card,
  stuck,
  busy,
  onWatch,
  onRetry,
}: {
  card: ReleaseCard;
  stuck: ReleaseStuck | null;
  busy: boolean;
  onWatch: (threadId: string) => void;
  onRetry: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const thread = card.review?.t3_thread ?? card.t3_thread ?? null;
  const results = card.review?.results ?? [];
  const resultFor = (p: { github: string; number: number }) =>
    results.find((r) => r.repo === p.github && r.number === p.number) ?? null;
  const github: Step = !card.review
    ? null
    : results.some((r) => r.posted)
      ? "posted"
      : card.review.error || results.every((r) => r.verdict === "Bailed")
        ? "bailed"
        : "draft";
  const reply: Step = card.reply?.status === "posted" ? "posted" : stuck ? "bailed" : null;
  const minutes = card.review?.seconds ? Math.max(1, Math.round(card.review.seconds / 60)) : null;
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2.5 rounded-xl bg-card p-3.5 shadow-xs/5 ring-1",
        card.stage === "reviewing" ? "ring-info/50" : stuck ? "ring-warning/50" : "ring-border/70",
      )}
    >
      <Tracker steps={{ asked: true, github, reply }} />
      <ul className="flex flex-col gap-1.5">
        {card.prs.map((p) => {
          const r = resultFor(p);
          return (
            <li key={`${p.github}#${p.number}`} className="flex flex-col gap-1">
              <a
                href={p.url || card.link}
                target="_blank"
                rel="noreferrer"
                className="text-sm leading-snug font-medium hover:underline"
              >
                {p.repo ?? p.github.split("/").pop()}#{p.number}
                {p.title ? ` · ${p.title}` : ""}
              </a>
              {r ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                      VERDICT_TONE[r.verdict],
                    )}
                    title={r.why}
                  >
                    <span className={cn("size-1.5 rounded-full", VERDICT_DOT[r.verdict])} />
                    {r.verdict}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.posted
                      ? "posted on GitHub"
                      : card.review?.post
                        ? "not posted"
                        : "draft, not posted"}
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {card.stage === "reviewing" ? (
        <div className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-info">
            <Spinner className="size-3.5" />
            Being reviewed now
            <span className="font-normal text-muted-foreground">
              · {card.progress?.minutes ??
                Math.max(0, Math.round((Date.now() - card.at) / 60_000))}{" "}
              min
              {card.progress
                ? ` · ${card.progress.steps} ${card.progress.steps === 1 ? "step" : "steps"}`
                : ""}
              {card.progress?.refused ? ` · ${card.progress.refused} refused` : ""}
            </span>
          </span>
          {card.progress ? (
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              Now: {card.progress.now}
            </span>
          ) : null}
          <span className="text-muted-foreground">Asked by {card.asked_by_name || "someone"}</span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          Asked by {card.asked_by_name || "someone"}
          {card.at ? ` · ${since(card.at)}` : ""}
          {minutes ? ` · reviewed in ${minutes} min` : ""}
        </span>
      )}
      {card.review?.error ? (
        <span className="text-xs text-destructive">{card.review.error}</span>
      ) : null}
      {stuck ? (
        <span className="text-xs text-destructive">ClickUp reply: {stuck.reply_error}</span>
      ) : card.reply && card.reply.status !== "posted" && card.reply.error ? (
        <span className="text-xs text-destructive">ClickUp reply: {card.reply.error}</span>
      ) : null}
      {card.review?.summary ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-left">
          <p
            className={cn(
              "text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]",
              !open && "line-clamp-3",
            )}
          >
            {card.review.summary}
          </p>
        </button>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-0.5">
        <Open href={card.link} icon={<MessageSquareIcon />}>
          Thread in ClickUp
        </Open>
        {card.prs.length === 1 && card.prs[0]?.url ? (
          <Open href={card.prs[0].url} icon={<GitPullRequestIcon />} label="PR on GitHub" />
        ) : null}
        {thread ? (
          <button
            type="button"
            onClick={() => onWatch(thread)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-3 text-xs font-medium hover:bg-foreground/[0.1] [&_svg]:size-3.5"
          >
            <EyeIcon />
            Watch
          </button>
        ) : null}
        {stuck ? (
          <Button size="xs" disabled={busy} onClick={() => onRetry(stuck.key)}>
            <RotateCwIcon className="size-3" /> Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
