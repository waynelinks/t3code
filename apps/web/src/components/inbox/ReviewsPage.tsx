import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  LogInIcon,
  PlayIcon,
  RotateCwIcon,
  SendIcon,
  SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { inboxRequest, refreshInbox, useInboxFeeds } from "../../state/inbox";
import {
  inOrganisationScope,
  useOrganisationLabel,
  useOrganisationScope,
} from "../../state/organisation";
import type {
  ReleaseBoard,
  ReleaseCard,
  ReleaseConfig,
  ReleaseStuck,
  ReleaseYou,
} from "../../state/reviews";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ago } from "./shared";

/** The board's columns, left to right: what waits on you, then a request's way through. */
const COLUMNS = [
  { id: "you", title: "Needs you", hint: "Only you can answer these" },
  { id: "requested", title: "Requested", hint: "Asked in the channel, needs your review" },
  { id: "reviewing", title: "Reviewing", hint: "A review thread is working on it" },
  { id: "reviewed", title: "Reviewed", hint: "The verdict is on GitHub, or a draft" },
  { id: "replied", title: "Replied", hint: "The requester has the answer in ClickUp" },
  { id: "others", title: "Handled without you", hint: "Another reviewer, or already answered" },
] as const;
const agoMs = (ms: number | null | undefined) => (ms ? ago(new Date(ms).toISOString()) : "never");
const fail = (title: string, e: unknown) =>
  toastManager.add({
    type: "error",
    title,
    description: e instanceof Error ? e.message : String(e),
  });

function Card({
  title,
  icon,
  aside,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-sm">
        {icon}
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        {aside}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">{children}</div>
    </section>
  );
}

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
  const [showSettings, setShowSettings] = useState(false);
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
  const count = (id: (typeof COLUMNS)[number]["id"]) =>
    !board
      ? 0
      : id === "you"
        ? board.you.length
        : id === "others"
          ? board.others.length
          : board.stages[id].length;

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
          variant={showSettings ? "secondary" : "ghost"}
          disabled={!board}
          onClick={() => setShowSettings((v) => !v)}
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
            {showSettings || !configured ? (
              <div className="max-h-[55vh] shrink-0 overflow-y-auto border-b border-border/50 bg-muted/10 px-3 py-3">
                <SetupCard
                  base={source.base}
                  board={board}
                  busy={busy}
                  onSave={(changes) => call("/release/config", "PUT", changes)}
                  onLogin={(check) =>
                    void call(check ? "/release/login/check" : "/release/login", "POST")
                  }
                />
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
                      // Needs you holds answer boxes: it gets more room than the others
                      col.id === "you" ? "min-w-[15rem] flex-[1.6]" : "min-w-[10.5rem] flex-1",
                    )}
                  >
                    <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2 text-xs font-medium text-muted-foreground">
                      <span className="truncate uppercase tracking-wide">{col.title}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 tabular-nums",
                          col.id === "you" && count("you") > 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted",
                        )}
                      >
                        {count(col.id)}
                      </span>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                      {count(col.id) === 0 ? (
                        <p className="px-1.5 text-xs text-muted-foreground/70">{col.hint}</p>
                      ) : col.id === "you" ? (
                        board.you.map((it) => (
                          <YouCard
                            key={it.id}
                            item={it}
                            busy={busy}
                            windowOpen={board.window_open}
                            onSend={(text) =>
                              call(`/release/you/${encodeURIComponent(it.id)}/send`, "POST", {
                                text,
                              })
                            }
                          />
                        ))
                      ) : col.id === "others" ? (
                        board.others.map((o) => (
                          <div
                            key={`${o.thread}-${o.github ?? o.repo}-${o.number}`}
                            className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm shadow-xs/5"
                          >
                            <PrLink pr={o} />
                            <p className="text-xs text-muted-foreground">{o.verdict}</p>
                            <p className="text-xs text-muted-foreground">
                              {o.asked_by_name ? `${o.asked_by_name} · ` : ""}
                              {agoMs(o.last_ask)}
                            </p>
                          </div>
                        ))
                      ) : (
                        board.stages[col.id].map((c) => (
                          <StageCard
                            key={`${c.stage}-${c.thread}`}
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

function PrLink({
  pr,
}: {
  pr: { github?: string; repo?: string; number: number; url?: string; title?: string };
}) {
  const name = `${(pr.github ?? pr.repo ?? "").split("/").pop()}#${pr.number}`;
  return pr.url ? (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="font-medium hover:underline"
      title={pr.title}
    >
      {name}
    </a>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

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
  const thread = card.review?.t3_thread ?? card.t3_thread ?? null;
  const results = card.review?.results ?? [];
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-xs/5",
        stuck ? "border-warning/50" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {card.prs.map((p) => (
          <PrLink key={`${p.github}#${p.number}`} pr={p} />
        ))}
        {card.stage === "reviewing" ? <Spinner className="size-3 text-muted-foreground" /> : null}
      </div>
      {card.prs.some((p) => p.title) ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {card.prs
            .map((p) => p.title)
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {card.asked_by_name ? `${card.asked_by_name} · ` : ""}
        {agoMs(card.at)}
      </p>
      {results.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {results.map((r) => (
            <Badge
              key={`${r.repo}#${r.number}`}
              size="sm"
              variant={
                r.verdict === "Approved"
                  ? "success"
                  : r.verdict === "Changes Requested"
                    ? "warning"
                    : "error"
              }
              title={r.why}
            >
              {card.prs.length > 1 ? `#${r.number} ` : ""}
              {r.verdict}
              {r.verdict !== "Bailed"
                ? r.posted
                  ? ""
                  : card.review?.post
                    ? ", not posted"
                    : ", draft"
                : ""}
            </Badge>
          ))}
        </div>
      ) : null}
      {card.review?.error ? <p className="text-xs text-destructive">{card.review.error}</p> : null}
      {stuck ? (
        <p className="text-xs text-warning">The reply did not post: {stuck.reply_error}</p>
      ) : card.reply && card.reply.status !== "posted" && card.reply.error ? (
        <p className="text-xs text-warning">Reply not posted yet: {card.reply.error}</p>
      ) : null}
      {card.stage === "replied" && card.reply ? (
        <p className="text-xs text-muted-foreground">Replied {agoMs(card.reply.at)}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {stuck ? (
          <Button size="xs" disabled={busy} onClick={() => onRetry(stuck.key)}>
            <RotateCwIcon className="size-3" /> Try again
          </Button>
        ) : null}
        {thread ? (
          <Button size="xs" variant="outline" onClick={() => onWatch(thread)}>
            Watch
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          render={<a href={card.link} target="_blank" rel="noreferrer" />}
        >
          ClickUp <ExternalLinkIcon className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function YouCard({
  item,
  busy,
  windowOpen,
  onSend,
}: {
  item: ReleaseYou;
  busy: boolean;
  windowOpen: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(item.queued ?? item.suggestion ?? "");
  const who = item.by_name ?? item.asked_by_name ?? "";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm shadow-xs/5">
      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "pr" ? (
          <PrLink
            pr={{
              repo: item.repo ?? "",
              number: item.number ?? 0,
              ...(item.url ? { url: item.url } : {}),
              ...(item.title ? { title: item.title } : {}),
            }}
          />
        ) : (
          <span className="font-medium">Question</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {who ? `${who} · ` : ""}
        {agoMs(item.last_ask ?? item.date)}
      </p>
      <p className="text-xs text-muted-foreground">
        {item.kind === "pr" ? item.verdict : item.summary}
      </p>
      {item.answerable ? (
        <>
          <Textarea
            unstyled
            value={text}
            placeholder={
              item.kind === "mention" ? "Your answer (the Inbox has a draft)" : "Your answer"
            }
            className="block w-full rounded-md border border-border/60 bg-background/60 [&_textarea]:min-h-20 [&_textarea]:resize-y [&_textarea]:bg-transparent [&_textarea]:px-2 [&_textarea]:py-1.5 [&_textarea]:text-xs"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" disabled={busy || !text.trim()} onClick={() => void onSend(text)}>
              <SendIcon className="size-3" />
              {windowOpen ? "Send" : "Send at 09:30"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              render={<a href={item.link} target="_blank" rel="noreferrer" />}
            >
              ClickUp <ExternalLinkIcon className="size-3" />
            </Button>
          </div>
          {item.queued ? <p className="text-xs text-muted-foreground">Queued for 09:30</p> : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            render={<a href={item.link} target="_blank" rel="noreferrer" />}
          >
            ClickUp <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SetupCard({
  base,
  board,
  busy,
  onSave,
  onLogin,
}: {
  base: string;
  board: ReleaseBoard;
  busy: boolean;
  onSave: (changes: Partial<ReleaseConfig>) => Promise<boolean>;
  onLogin: (check: boolean) => void;
}) {
  const cfg = board.config;
  const [channels, setChannels] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [channel, setChannel] = useState(cfg.channel);
  const [kit, setKit] = useState(cfg.kit_source);
  const [merger, setMerger] = useState(cfg.merger);
  useEffect(() => {
    void inboxRequest<{ channels: { id: string; name: string }[] }>(base, "/config/channels")
      .then((d) => setChannels(d.channels))
      .catch(() => setChannels([]));
  }, [base]);
  const dirty = channel !== cfg.channel || kit !== cfg.kit_source || merger !== cfg.merger;
  const ready = Boolean(cfg.channel && cfg.kit_source);
  const toggle = (k: "enabled" | "review" | "post" | "reply", v: boolean) =>
    void onSave(
      k === "review" && !v
        ? { review: false, post: false, reply: false }
        : k === "post" && v
          ? { review: true, post: true }
          : { [k]: v },
    );
  const row = (title: string, description: string, control: ReactNode) => (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {control}
    </div>
  );
  return (
    <Card
      title="PR review settings"
      icon={<SettingsIcon className="size-4 text-muted-foreground" />}
    >
      <div className="flex flex-col divide-y divide-border/50">
        {row(
          "Release Request channel",
          "Where people ask you to review pull requests.",
          <Select
            value={channel || "__none"}
            onValueChange={(v) => typeof v === "string" && setChannel(v === "__none" ? "" : v)}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-52"
              aria-label="Release Request channel"
            >
              <SelectValue>
                {channels.find((c) => c.id === channel)?.name ?? (channel || "Choose a channel")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {channels.map((c) => (
                <SelectItem hideIndicator key={c.id} value={c.id}>
                  {c.name || c.id}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>,
        )}
        {row(
          "Skills folder",
          "The company's review skills and scripts. Chief keeps a copy and refreshes it every hour.",
          <Input
            className="w-full max-w-sm"
            value={kit}
            placeholder="/home/wayne/ai-employees/<company>"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKit(e.target.value)}
            aria-label="Skills folder"
          />,
        )}
        {row(
          "When everything is approved, cc",
          "The person who merges, mentioned on approved replies. Empty: no cc line.",
          <Input
            className="w-full max-w-60"
            value={merger}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMerger(e.target.value)}
            aria-label="cc on approved replies"
          />,
        )}
        {dirty ? (
          <div className="flex justify-end py-2.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void onSave({ channel, kit_source: kit, merger })}
            >
              Save
            </Button>
          </div>
        ) : null}
        {board.kit.missing && board.kit.missing.length > 0 ? (
          <p className="py-2 text-xs text-destructive">
            The skills folder lacks {board.kit.missing.join(", ")}
          </p>
        ) : null}
        {row(
          "Check the channel",
          `Every ${cfg.interval_min} minutes, read the threads that moved.`,
          <Switch
            checked={cfg.enabled}
            disabled={busy || !ready}
            onCheckedChange={(v) => toggle("enabled", Boolean(v))}
            aria-label="Check the channel"
          />,
        )}
        {row(
          "Review requests",
          "Each request that needs you gets a review thread, with the company's protocol.",
          <Switch
            checked={cfg.review}
            disabled={busy || !ready}
            onCheckedChange={(v) => toggle("review", Boolean(v))}
            aria-label="Review requests"
          />,
        )}
        {row(
          "Post verdicts on GitHub",
          "As the company's GitHub account, only 09:30 to 17:00. Off: reviews stay drafts.",
          <Switch
            checked={cfg.post}
            disabled={busy || !ready}
            onCheckedChange={(v) => toggle("post", Boolean(v))}
            aria-label="Post verdicts on GitHub"
          />,
        )}
        {row(
          "Reply in ClickUp",
          "Typed in the requester's thread by Chief's Chrome, with real mentions, then read back.",
          <Switch
            checked={cfg.reply}
            disabled={busy || !ready}
            onCheckedChange={(v) => toggle("reply", Boolean(v))}
            aria-label="Reply in ClickUp"
          />,
        )}
        {row(
          "Chief's Chrome for ClickUp",
          board.login.busy
            ? "A Chrome window is open: log in to ClickUp there. It closes by itself."
            : board.login.logged_in === true
              ? `Signed in (checked ${agoMs(board.login.at)}).`
              : board.login.logged_in === false
                ? `Not signed in${board.login.error ? `: ${board.login.error}` : ""}.`
                : "Not checked yet. You log in once; Chief never sees the password.",
          <div className={cn("flex gap-2")}>
            <Button
              size="sm"
              variant="outline"
              disabled={board.login.busy}
              onClick={() => onLogin(true)}
            >
              Check
            </Button>
            <Button size="sm" disabled={board.login.busy} onClick={() => onLogin(false)}>
              <LogInIcon className="size-3.5" />
              Log in
            </Button>
          </div>,
        )}
      </div>
    </Card>
  );
}
