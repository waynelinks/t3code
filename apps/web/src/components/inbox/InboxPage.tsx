import type { EnvironmentId } from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InboxIcon,
  ListChecksIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  UndoIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  inOrganisationScope,
  useOrganisationLabel,
  useOrganisationScope,
} from "../../state/organisation";
import {
  inboxRequest,
  refreshInbox,
  useInboxFeeds,
  type EnvironmentInbox,
  type InboxItem,
} from "../../state/inbox";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInput } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

interface Row extends InboxItem {
  readonly environmentId: EnvironmentId;
  readonly base: string;
  readonly organisation: string;
  readonly key: string;
}
type Act = (row: Row, action: string, body?: unknown) => Promise<boolean>;
type Tab = "open" | "snoozed" | "done";

const LIVE_TASK = (row: InboxItem) => Boolean(row.task && row.task.status !== "discarded");
const CAN_REPLY = (row: InboxItem) =>
  Boolean(row.reply_to) || typeof row.context.task_id === "string";
const KIND_LABEL: Record<string, string> = {
  mention: "Tagged you",
  "comment-assigned": "Assigned to you",
  assigned: "Task assigned",
  direct: "Direct message",
  "chat-mention": "Tagged you",
  channel: "Watched channel",
  task: "Task",
  note: "Note",
};
const TASK_LABEL: Record<string, string> = {
  speccing: "Writing spec",
  proposed: "Spec to approve",
  spec_failed: "Spec failed",
  approved: "Building",
  running: "Building",
  failed_rung: "Building",
  needs_owner: "Build needs you",
  green: "Pull request ready",
};
const SHORTCUTS = "Arrow keys move · E done · S snooze · R reply · Ctrl+Enter sends";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}
function signature(row: InboxItem): string {
  let h = 0;
  for (const ch of `${row.body}|${row.task?.status ?? ""}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

// Read state lives in this browser only: a row is new until you open it, and again when it changes.
const SEEN_KEY = "chief_inbox_seen";
function readSeen(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const AVATAR_TINTS = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];
function tintFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length] ?? "bg-muted text-foreground/80";
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("size-8 shrink-0 rounded-full bg-muted object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function InboxPage() {
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const labelFor = useCallback(
    (environmentId: EnvironmentId) =>
      organisationLabel(
        environmentId,
        environments.find((e) => e.environmentId === environmentId)?.label ?? environmentId,
      ),
    [environments, organisationLabel],
  );
  const inScope = useMemo(
    () => feeds.filter((feed) => inOrganisationScope(scope, feed.environmentId)),
    [feeds, scope],
  );
  const loading =
    environments.filter((e) => inOrganisationScope(scope, e.environmentId)).length > inScope.length;
  const rows = useMemo<Row[]>(
    () =>
      inScope
        .flatMap((feed) =>
          feed.items.map((item) => ({
            ...item,
            environmentId: feed.environmentId,
            base: feed.base,
            organisation: labelFor(feed.environmentId),
            key: `${feed.environmentId}:${item.id}`,
          })),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [inScope, labelFor],
  );
  const [tab, setTab] = useState<Tab>("open");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>(() => readSeen());
  const counts = useMemo(
    () => ({
      open: rows.filter((r) => r.status === "open").length,
      snoozed: rows.filter((r) => r.status === "snoozed").length,
    }),
    [rows],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.status === tab &&
        (!q || `${r.who} ${r.title} ${r.body} ${r.organisation}`.toLowerCase().includes(q)),
    );
  }, [rows, tab, query]);
  const selected = visible.find((r) => r.key === selectedKey) ?? null;
  const markSeen = useCallback((row: Row) => {
    setSeen((prev) => {
      const next = { ...prev, [row.key]: signature(row) };
      try {
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  useEffect(() => {
    if (selected && seen[selected.key] !== signature(selected)) markSeen(selected);
  }, [selected, seen, markSeen]);

  const lastChecked =
    inScope
      .map((feed) => feed.health?.last_poll_at ?? "")
      .filter(Boolean)
      .sort()
      .pop() ?? null;
  const [checking, setChecking] = useState(false);
  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      await Promise.all(
        inScope.map((feed) =>
          inboxRequest(feed.base, "/poll", { method: "POST" }).catch(() => null),
        ),
      );
      await refreshInbox();
    } finally {
      setChecking(false);
    }
  }, [inScope]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback<Act>(async (row, action, body) => {
    setBusy(row.key);
    setError(null);
    try {
      await inboxRequest(row.base, `/items/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        body: body ?? {},
      });
      await refreshInbox(row.environmentId);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  // Done, snoozed or reopened: move on to the next row, and offer an undo.
  const actAndAdvance = useCallback<Act>(
    async (row, action, body) => {
      const index = visible.findIndex((r) => r.key === row.key);
      const ok = await act(row, action, body);
      if (ok && (action === "done" || action === "snooze" || action === "reopen")) {
        const next = visible[index + 1] ?? visible[index - 1] ?? null;
        setSelectedKey(next && next.key !== row.key ? next.key : null);
      }
      if (ok && (action === "done" || action === "snooze")) {
        const toastId = toastManager.add({
          type: "success",
          title: action === "done" ? "Marked done" : "Snoozed until tomorrow",
          description: row.title,
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(toastId);
              void act(row, "reopen").then((undone) => {
                if (undone) {
                  setTab("open");
                  setSelectedKey(row.key);
                }
              });
            },
          },
        });
      }
      return ok;
    },
    [act, visible],
  );

  // Keyboard: arrows or j/k move, e done, s snooze, r reply, escape closes the reading pane.
  const keyState = useRef({ visible, selected, busy, actAndAdvance });
  keyState.current = { visible, selected, busy, actAndAdvance };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.closest("[role=menu],[role=listbox],[role=dialog]"))
      ) {
        return;
      }
      const {
        visible: list,
        selected: current,
        busy: working,
        actAndAdvance: run,
      } = keyState.current;
      const index = current ? list.findIndex((r) => r.key === current.key) : -1;
      const go = (row: Row | undefined) => {
        if (!row) return;
        event.preventDefault();
        setSelectedKey(row.key);
        const el = document.querySelector<HTMLElement>(`[data-inbox-key="${CSS.escape(row.key)}"]`);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      };
      const key = event.key;
      if (key === "ArrowDown" || key === "j") go(list[Math.min(index + 1, list.length - 1)]);
      else if (key === "ArrowUp" || key === "k") go(list[Math.max(index - 1, 0)]);
      else if (key === "Escape" && current) setSelectedKey(null);
      else if (current && working === null && current.status === "open" && key === "e") {
        event.preventDefault();
        void run(current, "done");
      } else if (current && working === null && current.status === "open" && key === "s") {
        event.preventDefault();
        void run(current, "snooze", { hours: 24 });
      } else if (current && key === "r") {
        const box = document.getElementById("inbox-reply");
        if (box) {
          event.preventDefault();
          box.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">Inbox</h1>
        <span className="truncate text-sm text-muted-foreground">
          {scope === "all" ? "All organisations" : labelFor(scope)}
        </span>
        <div className="min-w-0 flex-1" />
        {lastChecked ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Checked {timeAgo(lastChecked) === "now" ? "just now" : `${timeAgo(lastChecked)} ago`}
          </span>
        ) : null}
        <Button variant="ghost" size="sm" disabled={checking} onClick={() => void checkNow()}>
          <RefreshCwIcon className={cn("size-4", checking && "animate-spin")} />
          {checking ? "Checking" : "Check now"}
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 border-t border-border/50">
        <aside
          className={cn(
            "min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:flex md:w-[360px]",
            selected ? "hidden" : "flex",
          )}
        >
          <div className="flex flex-col gap-2 p-3">
            <div className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
              <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
              <SidebarInput
                nativeInput
                type="search"
                placeholder="Search"
                aria-label="Search the inbox"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className="min-w-0 flex-1"
              />
            </div>
            <ToggleGroup
              aria-label="Inbox view"
              variant="segmented"
              className="w-full"
              value={[tab]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "open" || value === "snoozed" || value === "done") {
                  setTab(value);
                  setSelectedKey(null);
                }
              }}
            >
              <Toggle value="open" className="flex-1">
                Open{counts.open ? ` ${counts.open}` : ""}
              </Toggle>
              <Toggle value="snoozed" className="flex-1">
                Snoozed{counts.snoozed ? ` ${counts.snoozed}` : ""}
              </Toggle>
              <Toggle value="done" className="flex-1">
                Done
              </Toggle>
            </ToggleGroup>
          </div>
          {inScope.map((feed) => (
            <FeedNotice key={feed.environmentId} feed={feed} label={labelFor(feed.environmentId)} />
          ))}
          {error ? <p className="mx-3 mb-2 text-xs text-destructive">{error}</p> : null}
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
            {loading && visible.length === 0 ? (
              <li className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Loading
              </li>
            ) : visible.length === 0 ? (
              <li className="px-3 py-10 text-center text-sm text-muted-foreground">
                {query
                  ? "Nothing matches."
                  : tab === "open"
                    ? "Nothing waits on you."
                    : tab === "snoozed"
                      ? "Nothing snoozed."
                      : "Nothing closed yet."}
              </li>
            ) : (
              visible.map((row, index) => {
                const label = dayLabel(row.created_at);
                const first = index === 0 || dayLabel(visible[index - 1]!.created_at) !== label;
                return (
                  <Fragment key={row.key}>
                    {first ? (
                      <li className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        {label}
                      </li>
                    ) : null}
                    <ListItem
                      row={row}
                      selected={row.key === selected?.key}
                      unread={seen[row.key] !== signature(row)}
                      showOrganisation={scope === "all"}
                      onSelect={() => setSelectedKey(row.key)}
                    />
                  </Fragment>
                );
              })
            )}
          </ul>
        </aside>
        <section
          className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}
        >
          {selected ? (
            <Detail
              key={selected.key}
              row={selected}
              busy={busy === selected.key}
              showOrganisation={scope === "all"}
              onAct={actAndAdvance}
              onBack={() => setSelectedKey(null)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <InboxIcon className="size-6" />
              {visible.length > 0 ? "Choose a message on the left." : "Nothing here."}
              {visible.length > 0 ? <span className="text-xs">{SHORTCUTS}</span> : null}
            </div>
          )}
        </section>
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
  return (
    <p className="mx-3 mb-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {message}
    </p>
  );
}

function ListItem({
  row,
  selected,
  unread,
  showOrganisation,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  unread: boolean;
  showOrganisation: boolean;
  onSelect: () => void;
}) {
  const taskLabel =
    row.task && row.task.status !== "discarded" ? TASK_LABEL[row.task.status] : null;
  const draftReady = row.draft.state === "ready" && CAN_REPLY(row) && !LIVE_TASK(row);
  return (
    <li>
      <button
        type="button"
        data-inbox-key={row.key}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "relative flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          selected
            ? "bg-sidebar-row-selected before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
            : "hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <Avatar
            name={row.who || row.source}
            src={row.who_avatar}
            className="size-6 text-[10px]"
          />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{row.who || row.source}</span>
            {" · "}
            {timeAgo(row.created_at)}
            {showOrganisation ? ` · ${row.organisation}` : ""}
          </span>
          <span className="flex-1" />
          {unread ? (
            <span aria-label="New" className="size-2 shrink-0 rounded-full bg-primary" />
          ) : null}
        </span>
        <span
          className={cn(
            "truncate text-sm",
            unread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
          )}
        >
          {row.title}
        </span>
        {row.body ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">{row.body}</span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Badge variant="secondary" size="sm">
            {KIND_LABEL[row.kind] ?? row.kind}
          </Badge>
          {taskLabel ? (
            <Badge variant="info" size="sm">
              {taskLabel}
            </Badge>
          ) : null}
          {draftReady ? (
            <Badge variant="success" size="sm">
              Reply drafted
            </Badge>
          ) : null}
          {row.draft.state === "pending" ? (
            <Badge variant="secondary" size="sm">
              Drafting
            </Badge>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function Detail({
  row,
  busy,
  showOrganisation,
  onAct,
  onBack,
}: {
  row: Row;
  busy: boolean;
  showOrganisation: boolean;
  onAct: Act;
  onBack: () => void;
}) {
  const [composingTask, setComposingTask] = useState(false);
  const liveTask = LIVE_TASK(row);
  const replyable = CAN_REPLY(row) && !liveTask;
  const ctx = row.context as { where?: unknown; thread?: unknown };
  const where = typeof ctx.where === "string" ? ctx.where : null;
  const thread = Array.isArray(ctx.thread)
    ? (ctx.thread as { who?: string; at?: string; text?: string }[]).filter(
        (x) => x.text && !row.body.includes(x.text),
      )
    : [];
  const subtitle = [
    `${KIND_LABEL[row.kind] ?? row.kind}${where ? ` in ${where}` : ""}`,
    fullDate(row.created_at),
    showOrganisation ? row.organisation : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-5 py-3 lg:px-8">
        <Button
          size="icon-sm"
          variant="ghost"
          className="md:hidden"
          aria-label="Back to the list"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Avatar name={row.who || row.source} src={row.who_avatar} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.who || row.source}</p>
          <p className="truncate text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!liveTask && !composingTask && row.source !== "chief" && row.status === "open" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setComposingTask(true)}
            >
              <ListChecksIcon className="size-3.5" />
              Make this a task
            </Button>
          ) : null}
          {row.url ? (
            <IconAction
              label="Open in ClickUp"
              onClick={() => window.open(row.url!, "_blank", "noopener,noreferrer")}
            >
              <ExternalLinkIcon className="size-4" />
            </IconAction>
          ) : null}
          {row.status === "open" ? (
            <>
              <IconAction
                label="Snooze a day (S)"
                disabled={busy}
                onClick={() => void onAct(row, "snooze", { hours: 24 })}
              >
                <ClockIcon className="size-4" />
              </IconAction>
              <IconAction label="Done (E)" disabled={busy} onClick={() => void onAct(row, "done")}>
                <ArchiveIcon className="size-4" />
              </IconAction>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onAct(row, "reopen")}
            >
              <UndoIcon className="size-3.5" />
              Back to open
            </Button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:px-8">
        <h2 className="text-lg font-semibold tracking-tight">{row.title}</h2>
        {thread.length > 0 ? (
          <div className="flex flex-col gap-2 border-l-2 border-border/50 pl-3">
            {thread.slice(-6).map((x, i) => (
              <div key={`${x.at ?? i}-${i}`} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground/70">{x.who ?? "someone"}</span>
                {x.at ? <span className="text-xs"> · {timeAgo(x.at)}</span> : null}
                <p className="whitespace-pre-wrap">{x.text}</p>
              </div>
            ))}
          </div>
        ) : null}
        {row.body ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{row.body}</p>
        ) : null}
        {row.reply ? (
          <div className="rounded-xl border border-border/60 bg-muted/20 shadow-xs/5 p-4 text-sm">
            <p className="mb-1 text-xs text-muted-foreground">
              You replied {timeAgo(row.reply.sent_at)} ago
            </p>
            <p className="whitespace-pre-wrap">{row.reply.text}</p>
          </div>
        ) : null}
        {liveTask ? (
          <TaskPanel row={row} busy={busy} onAct={onAct} onRetry={() => setComposingTask(true)} />
        ) : null}
        {composingTask ? (
          <TaskComposer
            row={row}
            busy={busy}
            onAct={onAct}
            onClose={() => setComposingTask(false)}
          />
        ) : replyable && row.status === "open" ? (
          <Composer row={row} busy={busy} onAct={onAct} />
        ) : null}
      </div>
    </div>
  );
}

function Composer({ row, busy, onAct }: { row: Row; busy: boolean; onAct: Act }) {
  const [text, setText] = useState(row.draft.text);
  const [serverText, setServerText] = useState(row.draft.text);
  useEffect(() => {
    // A fresh draft from the service replaces the box unless you have typed since.
    if (row.draft.text !== serverText) {
      setServerText(row.draft.text);
      if (text === serverText) setText(row.draft.text);
    }
  }, [row.draft.text, serverText, text]);
  const saveDraft = useCallback(() => {
    if (text === serverText) return;
    setServerText(text);
    void inboxRequest(row.base, `/items/${encodeURIComponent(row.id)}/draft`, {
      method: "PUT",
      body: { text },
    }).catch(() => {});
  }, [row.base, row.id, serverText, text]);
  const drafting = row.draft.state === "pending";
  const hasDraft = row.draft.state === "ready" || row.draft.state === "failed";
  const canSend = !busy && !drafting && text.trim().length > 0;
  const target =
    row.reply_to?.kind === "channel"
      ? "the conversation"
      : row.reply_to?.kind === "thread" || row.reply_to?.kind === "comment-thread"
        ? "the thread"
        : "the task comments";
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">To:</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 py-0.5 pr-2.5 pl-0.5">
          <Avatar name={row.who || row.source} src={row.who_avatar} className="size-5 text-[9px]" />
          <span className="text-xs font-medium">{row.who || row.source}</span>
        </span>
        <span className="text-xs text-muted-foreground">in {target}</span>
        <span className="flex-1" />
        {drafting ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Drafting from the code
          </span>
        ) : row.draft.state === "ready" && row.draft.confidence ? (
          <span className="text-xs text-muted-foreground">
            Draft confidence: {row.draft.confidence}
            {row.draft.edited ? ", edited" : ""}
          </span>
        ) : null}
      </div>
      {row.draft.state === "failed" ? (
        <p className="px-4 pt-3 text-xs text-destructive">The draft failed: {row.draft.error}</p>
      ) : null}
      {row.draft.needs && row.draft.needs.length > 0 ? (
        <ul className="flex flex-col gap-1 px-4 pt-3 text-xs text-foreground/80">
          {row.draft.needs.map((need) => (
            <li key={need}>Needs you: {need}</li>
          ))}
        </ul>
      ) : null}
      <Textarea
        id="inbox-reply"
        unstyled
        value={text}
        className="block w-full [&_textarea]:min-h-36 [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:leading-relaxed"
        placeholder={
          drafting ? "Drafting a reply from the code" : "Write a reply, or draft one from the code"
        }
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
        onBlur={saveDraft}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canSend) {
            event.preventDefault();
            void onAct(row, "send", { text });
          }
        }}
      />
      {row.draft.checked && row.draft.checked.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {row.draft.checked.slice(0, 6).map((path) => (
            <span
              key={path}
              className="inline-flex max-w-64 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">{path.split("/").pop()}</span>
                <span className="truncate text-[11px] text-muted-foreground">{path}</span>
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || drafting}
          onClick={() => void onAct(row, "redraft")}
        >
          <SparklesIcon className="size-3.5" />
          {hasDraft ? "Redraft" : "Draft a reply"}
        </Button>
        <span className="flex-1" />
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter</span>
        <Button size="sm" disabled={!canSend} onClick={() => void onAct(row, "send", { text })}>
          Send reply
          <SendIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function goalFrom(row: Row): string {
  const ctx = row.context as { where?: unknown; thread?: unknown };
  const where = typeof ctx.where === "string" ? ctx.where : row.title;
  const lines = [
    `${row.who || "A colleague"} wrote in ${where}${row.url ? ` (${row.url})` : ""}:`,
    "",
    row.body.trim(),
  ];
  // earlier messages only: the message itself is already above
  const thread = Array.isArray(ctx.thread)
    ? (ctx.thread as { who?: string; text?: string }[])
        .filter((x) => x.text && !row.body.includes(x.text))
        .slice(-4)
    : [];
  if (thread.length > 0)
    lines.push(
      "",
      "Earlier messages:",
      ...thread.map((x) => `- ${x.who ?? "someone"}: ${x.text ?? ""}`),
    );
  lines.push("", "Build what this asks for, and keep the change as small as the request allows.");
  return lines.join("\n");
}

function TaskComposer({
  row,
  busy,
  onAct,
  onClose,
}: {
  row: Row;
  busy: boolean;
  onAct: Act;
  onClose: () => void;
}) {
  const projects = useProjects();
  const repos = useMemo(
    () =>
      projects
        .filter((p) => p.environmentId === row.environmentId && p.workspaceRoot)
        .map((p) => ({ path: p.workspaceRoot, name: p.title })),
    [projects, row.environmentId],
  );
  const [goal, setGoal] = useState(() => goalFrom(row));
  const [repo, setRepo] = useState<string>(() => repos[0]?.path ?? "");
  useEffect(() => {
    if (!repo && repos[0]) setRepo(repos[0].path);
  }, [repo, repos]);
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-sm">
        <ListChecksIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">New task</span>
        <span className="text-xs text-muted-foreground">
          The spec-writer proposes a spec with checks. Nothing is built until you approve.
        </span>
      </div>
      <Textarea
        unstyled
        value={goal}
        aria-label="What should be built"
        className="block w-full [&_textarea]:min-h-44 [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:leading-relaxed"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setGoal(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2.5">
        {repos.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Add the repository as a project in Chief first.
          </span>
        ) : (
          <Select
            value={repo}
            onValueChange={(value) => typeof value === "string" && setRepo(value)}
          >
            <SelectTrigger size="sm" className="w-full sm:w-64" aria-label="Repository">
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
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || !repo || goal.trim().length < 10}
          onClick={() =>
            void onAct(row, "task", { goal, repo, title: row.title }).then((ok) => ok && onClose())
          }
        >
          Write the spec
        </Button>
      </div>
    </div>
  );
}

function TaskPanel({
  row,
  busy,
  onAct,
  onRetry,
}: {
  row: Row;
  busy: boolean;
  onAct: Act;
  onRetry: () => void;
}) {
  const task = row.task!;
  const waiting = (text: string) => (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      {text}
    </p>
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
          <p className="text-sm">
            Spec ready, with {task.acceptance_cases ?? 0} acceptance checks. Nothing is built until
            you approve.
          </p>
          {task.spec ? (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-3 text-sm whitespace-pre-wrap">
              {task.spec}
            </div>
          ) : null}
        </>
      );
      actions = (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void onAct(row, "discard")}
          >
            Discard
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void onAct(row, "approve")}>
            Approve and build
          </Button>
        </>
      );
      break;
    case "spec_failed":
      body = (
        <p className="text-sm text-destructive">
          The spec-writer stopped: {task.error ?? "no reason given"}
        </p>
      );
      actions = (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void onAct(row, "discard")}
          >
            Discard
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            Try again
          </Button>
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
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            Open the draft pull request <ExternalLinkIcon className="size-3.5" />
          </a>
        </p>
      ) : (
        <p className="text-sm">
          Built and reviewed. {task.reasons ? `The pull request did not open: ${task.reasons}` : ""}
        </p>
      );
      break;
    case "needs_owner":
      body = (
        <>
          <p className="text-sm">The build stopped and needs you.</p>
          {task.reasons ? (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs whitespace-pre-wrap">
              {task.reasons}
            </div>
          ) : null}
        </>
      );
      actions = (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onAct(row, "discard")}
        >
          Discard
        </Button>
      );
      break;
    default:
      body = <p className="text-sm text-muted-foreground">Task status: {task.status}</p>;
  }
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-sm">
        <ListChecksIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">{task.title || task.id}</span>
        <Badge variant="info" size="sm">
          {TASK_LABEL[task.status] ?? task.status}
        </Badge>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">{body}</div>
      {actions ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-3 py-2.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
