import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  GitPullRequestArrowIcon,
  LogInIcon,
  MessageSquareIcon,
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
import type { ReleaseBoard, ReleaseCard, ReleaseConfig, ReleaseYou } from "../../state/reviews";
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

const STAGES: ReadonlyArray<{ id: ReleaseCard["stage"]; title: string; hint: string }> = [
  { id: "requested", title: "Requested", hint: "Asked in the channel, needs your review" },
  { id: "reviewing", title: "Reviewing", hint: "A review thread is working on it" },
  { id: "reviewed", title: "Reviewed", hint: "The verdict is on GitHub (or a draft)" },
  { id: "replied", title: "Replied", hint: "The requester has the answer in ClickUp" },
];
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
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const sources = useMemo(
    () => feeds.filter((f) => inOrganisationScope(scope, f.environmentId) && !f.error),
    [feeds, scope],
  );
  const labelFor = (env: EnvironmentId) =>
    organisationLabel(env, environments.find((e) => e.environmentId === env)?.label ?? env);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">PR reviews</h1>
        <span className="truncate text-sm text-muted-foreground">
          {scope === "all" ? "All organisations" : labelFor(scope)}
        </span>
        <div className="min-w-0 flex-1" />
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-5 sm:px-6">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No company service is answering for this organisation.
            </p>
          ) : (
            sources.map((f) => (
              <CompanyReviews
                key={f.environmentId}
                base={f.base}
                env={f.environmentId}
                label={labelFor(f.environmentId)}
                showLabel={sources.length > 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CompanyReviews({
  base,
  env,
  label,
  showLabel,
}: {
  base: string;
  env: EnvironmentId;
  label: string;
  showLabel: boolean;
}) {
  const navigate = useNavigate();
  const [board, setBoard] = useState<ReleaseBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const load = useCallback(async () => {
    try {
      setBoard(await inboxRequest<ReleaseBoard>(base, "/release"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base]);
  const live = Boolean(
    board?.running || board?.login.busy || (board?.stages.reviewing.length ?? 0) > 0,
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), live ? 4_000 : 30_000);
    return () => clearInterval(t);
  }, [load, live]);
  const call = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      setBoard(
        await inboxRequest<ReleaseBoard>(
          base,
          path,
          body === undefined ? { method } : { method, body },
        ),
      );
      void refreshInbox(env);
      return true;
    } catch (e) {
      fail("That did not work", e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const watch = (threadId: string) =>
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId: env, threadId } });

  if (error && !board)
    return (
      <p className="text-sm text-destructive">
        {label}: {error}
      </p>
    );
  if (!board) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Loading PR reviews
      </p>
    );
  }
  const cfg = board.config;
  const configured = Boolean(cfg.channel && cfg.kit_source);
  const lastRun = board.runs[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {showLabel ? <h2 className="text-sm font-medium">{label}</h2> : null}
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
        <Badge variant={board.window_open ? "success" : "secondary"} size="sm">
          {board.window_open ? "Posting window open" : "Outside 09:30 to 17:00: posts wait"}
        </Badge>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {board.running ? "Checking the channel now" : `Last check ${agoMs(lastRun?.at)}`}
          {lastRun?.error ? `: ${lastRun.error}` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || board.running || !configured}
          onClick={() => void call("/release/run", "POST")}
        >
          {board.running ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          Check now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)}>
          <SettingsIcon className="size-3.5" />
          Settings
        </Button>
      </div>
      {showSettings || !configured ? (
        <SetupCard
          base={base}
          board={board}
          busy={busy}
          onSave={(changes) => call("/release/config", "PUT", changes)}
          onLogin={(check) => void call(check ? "/release/login/check" : "/release/login", "POST")}
        />
      ) : null}
      {configured && board.login.logged_in !== true && cfg.reply ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/8 px-4 py-2.5 text-sm">
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
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {STAGES.map((s) => (
              <div
                key={s.id}
                className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/50 bg-muted/20 p-2"
              >
                <div className="flex items-center gap-2 px-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
                  <span className="uppercase tracking-wide">{s.title}</span>
                  <span>{board.stages[s.id].length}</span>
                </div>
                {board.stages[s.id].length === 0 ? (
                  <p className="px-1.5 pb-1 text-xs text-muted-foreground/70">{s.hint}</p>
                ) : (
                  board.stages[s.id].map((c) => (
                    <StageCard key={`${c.stage}-${c.thread}`} card={c} onWatch={watch} />
                  ))
                )}
              </div>
            ))}
          </div>
          {board.you.length > 0 ? (
            <Card
              title="Needs you"
              icon={<MessageSquareIcon className="size-4 text-muted-foreground" />}
              aside={
                <span className="text-xs text-muted-foreground">
                  Chief does not answer these for you
                </span>
              }
            >
              <ul className="flex flex-col divide-y divide-border/50">
                {board.you.map((it) => (
                  <YouRow
                    key={it.id}
                    item={it}
                    busy={busy}
                    windowOpen={board.window_open}
                    onSend={(text) =>
                      call(`/release/you/${encodeURIComponent(it.id)}/send`, "POST", { text })
                    }
                  />
                ))}
              </ul>
            </Card>
          ) : null}
          {board.stuck.length > 0 ? (
            <Card
              title="Replies that did not post"
              icon={<AlertTriangleIcon className="size-4 text-warning" />}
            >
              <ul className="flex flex-col divide-y divide-border/50">
                {board.stuck.map((s) => (
                  <li key={s.key} className="flex flex-col gap-1.5 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.prs.join(", ")}</span>
                      <span className="text-xs text-muted-foreground">
                        for {s.asked_by_name || "the requester"}
                      </span>
                      <span className="flex-1" />
                      <Button
                        size="xs"
                        variant="outline"
                        render={<a href={s.link} target="_blank" rel="noreferrer" />}
                      >
                        Thread <ExternalLinkIcon className="size-3" />
                      </Button>
                      <Button
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          void call(`/release/replies/${encodeURIComponent(s.key)}/approve`, "POST")
                        }
                      >
                        <RotateCwIcon className="size-3" /> Try again
                      </Button>
                    </div>
                    <p className="text-xs text-destructive">{s.reply_error}</p>
                    <pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-background/60 p-2 font-sans text-xs">
                      {s.text}
                    </pre>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {board.others.length > 0 ? (
            <Card
              title="Handled without you"
              icon={<GitPullRequestArrowIcon className="size-4 text-muted-foreground" />}
              aside={
                <span className="text-xs text-muted-foreground">Last {board.others.length}</span>
              }
            >
              <ul className="flex flex-col gap-1 text-sm">
                {board.others.slice(0, 12).map((o) => (
                  <li
                    key={`${o.thread}-${o.github ?? o.repo}-${o.number}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <PrLink pr={o} />
                    <span className="text-xs text-muted-foreground">{o.verdict}</span>
                    <span className="flex-1" />
                    <span className="text-xs text-muted-foreground">{agoMs(o.last_ask)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {board.runs.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Recent checks</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {board.runs.map((r) => (
                  <li key={r.at}>
                    {agoMs(r.at)}: {r.threads} threads, {r.read} read, {r.qualified} understood
                    {r.failed ? `, ${r.failed} to retry` : ""}
                    {r.seconds !== undefined ? ` in ${r.seconds}s` : ""}
                    {r.error ? `. ${r.error}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
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

function StageCard({ card, onWatch }: { card: ReleaseCard; onWatch: (threadId: string) => void }) {
  const thread = card.review?.t3_thread ?? card.t3_thread ?? null;
  const results = card.review?.results ?? [];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm shadow-xs/5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {card.prs.map((p) => (
          <PrLink key={`${p.github}#${p.number}`} pr={p} />
        ))}
      </div>
      {card.prs[0]?.title ? (
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
      {card.reply && card.reply.status !== "posted" && card.reply.error ? (
        <p className="text-xs text-warning">Reply not posted yet: {card.reply.error}</p>
      ) : null}
      {card.stage === "replied" && card.reply ? (
        <p className="text-xs text-muted-foreground">Replied {agoMs(card.reply.at)}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
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

function YouRow({
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
    <li className="flex flex-col gap-2 py-2.5 text-sm">
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
        <span className="text-xs text-muted-foreground">
          {who ? `from ${who}` : ""}
          {item.kind === "pr" && item.verdict ? ` · ${item.verdict}` : ""}
          {item.kind === "mention" && item.summary ? ` · ${item.summary}` : ""}
        </span>
        <span className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          render={<a href={item.link} target="_blank" rel="noreferrer" />}
        >
          ClickUp <ExternalLinkIcon className="size-3" />
        </Button>
      </div>
      {item.answerable ? (
        <div className="flex flex-col gap-2">
          <Textarea
            unstyled
            value={text}
            placeholder={
              item.kind === "mention"
                ? "Your answer. The Inbox also has this question, with a drafted reply."
                : "Your answer"
            }
            className="block w-full rounded-lg border border-border/60 bg-background/60 [&_textarea]:min-h-14 [&_textarea]:resize-y [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            {item.queued ? (
              <span className="text-xs text-muted-foreground">Queued for 09:30</span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              Sent with a mention of {who || "the asker"}
            </span>
            <Button size="xs" disabled={busy || !text.trim()} onClick={() => void onSend(text)}>
              <SendIcon className="size-3" />
              {windowOpen ? "Send" : "Send at 09:30"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Your own pull request: Chief reviews it only when you ask.
        </p>
      )}
    </li>
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
