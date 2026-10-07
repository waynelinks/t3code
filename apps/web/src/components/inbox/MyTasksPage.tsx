import type { EnvironmentId } from "@t3tools/contracts";
import {
  BellOffIcon,
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlagIcon,
  KanbanIcon,
  ListIcon,
  ListTodoIcon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import {
  inboxRequest,
  refreshInbox,
  useInboxFeeds,
  type MyTask,
  type MyTaskDetail,
  type MyTasksBody,
  type TaskStatus,
} from "../../state/inbox";
import {
  inOrganisationScope,
  useOrganisationLabel,
  useOrganisationScope,
} from "../../state/organisation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Avatar, IconAction, SearchField, timeAgo } from "./shared";

interface TaskRow extends MyTask {
  readonly environmentId: EnvironmentId;
  readonly base: string;
  readonly organisation: string;
  readonly key: string;
  readonly statuses: ReadonlyArray<TaskStatus>;
}
type View = "list" | "board";
const VIEW_KEY = "chief_mytasks_view";
const REFRESH_MS = 60_000;

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}
const isClosed = (s: TaskStatus) => s.type === "closed" || s.type === "done";

function startOfDay(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
/** List groups, by when a task is due. */
function bucketOf(task: MyTask): { key: string; label: string; order: number } {
  if (task.snoozed_until) return { key: "snoozed", label: "Snoozed", order: 9 };
  const due = task.due_date;
  if (due === null) return { key: "none", label: "No due date", order: 8 };
  if (due < Date.now()) return { key: "overdue", label: "Overdue", order: 0 };
  if (due < startOfDay(1)) return { key: "today", label: "Today", order: 1 };
  if (due < startOfDay(2)) return { key: "tomorrow", label: "Tomorrow", order: 2 };
  if (due < startOfDay(7)) return { key: "week", label: "This week", order: 3 };
  return { key: "later", label: "Later", order: 4 };
}
function dueText(due: number | null): string | null {
  if (due === null) return null;
  if (due < Date.now()) {
    const days = Math.floor((startOfDay() - due) / 86_400_000) + 1;
    return due >= startOfDay()
      ? "Due earlier today"
      : days <= 1
        ? "1 day overdue"
        : `${days} days overdue`;
  }
  if (due < startOfDay(1)) return "Today";
  if (due < startOfDay(2)) return "Tomorrow";
  return new Date(due).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const STATUS_RANK: Record<string, number> = { open: 0, custom: 1, done: 2, closed: 3 };

function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full border border-black/10 dark:border-white/10",
        className,
      )}
      style={{ backgroundColor: status.color || undefined }}
    />
  );
}
function PriorityFlag({ priority }: { priority: MyTask["priority"] }) {
  if (!priority) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title={`Priority: ${priority.priority}`}
    >
      <FlagIcon className="size-3.5" style={{ color: priority.color || undefined }} />
      <span className="capitalize">{priority.priority}</span>
    </span>
  );
}
function Tags({ tags, max = 3 }: { tags: MyTask["tags"]; max?: number }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.slice(0, max).map((tag) => (
        <Badge key={tag.name} variant="secondary" size="sm" className="gap-1">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ backgroundColor: tag.bg || undefined }}
          />
          {tag.name}
        </Badge>
      ))}
      {tags.length > max ? (
        <span className="text-xs text-muted-foreground">+{tags.length - max}</span>
      ) : null}
    </>
  );
}

export function MyTasksPage() {
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
  const sources = useMemo(
    () =>
      feeds.filter(
        (feed) =>
          inOrganisationScope(scope, feed.environmentId) && !feed.error && feed.health?.configured,
      ),
    [feeds, scope],
  );
  const sourceKey = sources.map((s) => `${s.environmentId}@${s.base}`).join("|");
  const [data, setData] = useState<Record<string, MyTasksBody>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const load = useCallback(async (force = false) => {
    const current = sourcesRef.current;
    const results = await Promise.all(
      current.map(async (feed) => {
        try {
          return [
            feed.environmentId,
            await inboxRequest<MyTasksBody>(feed.base, `/mytasks${force ? "?refresh=1" : ""}`),
            null,
          ] as const;
        } catch (e) {
          return [feed.environmentId, null, e instanceof Error ? e.message : String(e)] as const;
        }
      }),
    );
    setData((prev) => {
      const next: Record<string, MyTasksBody> = {};
      for (const [id, body] of results) {
        const kept = body ?? prev[id];
        if (kept) next[id] = kept;
      }
      return next;
    });
    setErrors(
      Object.fromEntries(results.filter(([, , err]) => err).map(([id, , err]) => [id, err!])),
    );
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, sourceKey]);
  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      await load(true);
      void refreshInbox();
    } finally {
      setChecking(false);
    }
  }, [load]);

  const rows = useMemo<TaskRow[]>(
    () =>
      sources.flatMap((feed) => {
        const body = data[feed.environmentId];
        if (!body) return [];
        return body.tasks.map((task) => ({
          ...task,
          environmentId: feed.environmentId,
          base: feed.base,
          organisation: labelFor(feed.environmentId),
          key: `${feed.environmentId}:${task.id}`,
          statuses: body.statuses_by_list[task.list.id] ?? [task.status],
        }));
      }),
    [sources, data, labelFor],
  );
  const lastChecked =
    Object.values(data)
      .map((b) => b.checked_at ?? "")
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  const [view, setViewState] = useState<View>(() => readView());
  const setView = (next: View) => {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter((r) =>
          `${r.name} ${r.list.name} ${r.folder ?? ""} ${r.status.status} ${r.tags.map((t) => t.name).join(" ")}`
            .toLowerCase()
            .includes(q),
        )
      : rows;
    return [...matched].sort((a, b) => {
      const ba = bucketOf(a).order - bucketOf(b).order;
      if (ba !== 0) return ba;
      return (
        (a.due_date ?? Number.MAX_SAFE_INTEGER) - (b.due_date ?? Number.MAX_SAFE_INTEGER) ||
        b.date_updated - a.date_updated
      );
    });
  }, [rows, query]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((r) => r.key === selectedKey) ?? null;

  const patchLocal = useCallback((row: TaskRow, fields: Partial<MyTask>) => {
    setData((prev) => {
      const body = prev[row.environmentId];
      if (!body) return prev;
      return {
        ...prev,
        [row.environmentId]: {
          ...body,
          tasks: body.tasks.map((t) => (t.id === row.id ? { ...t, ...fields } : t)),
        },
      };
    });
  }, []);
  const setStatus = useCallback(
    async (row: TaskRow, statusName: string) => {
      const target = row.statuses.find((s) => s.status.toLowerCase() === statusName.toLowerCase());
      if (!target) {
        toastManager.add({
          type: "error",
          title: `"${statusName}" is not a status in ${row.list.name || "this list"}`,
          description: row.name,
        });
        return;
      }
      if (target.status === row.status.status) return;
      const before = row.status;
      patchLocal(row, { status: target });
      try {
        const body = await inboxRequest<MyTasksBody>(
          row.base,
          `/mytasks/${encodeURIComponent(row.id)}/status`,
          { method: "PUT", body: { status: target.status } },
        );
        setData((prev) => ({ ...prev, [row.environmentId]: body }));
      } catch (e) {
        patchLocal(row, { status: before });
        toastManager.add({
          type: "error",
          title: "Status not changed",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [patchLocal],
  );
  const snooze = useCallback(async (row: TaskRow, on: boolean) => {
    try {
      const body = await inboxRequest<MyTasksBody>(
        row.base,
        `/mytasks/${encodeURIComponent(row.id)}/${on ? "snooze" : "unsnooze"}`,
        {
          method: "POST",
          body: on ? { hours: 24 } : {},
        },
      );
      setData((prev) => ({ ...prev, [row.environmentId]: body }));
      void refreshInbox(row.environmentId);
      if (on) {
        const toastId = toastManager.add({
          type: "success",
          title: "Snoozed until tomorrow",
          description: row.name,
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(toastId);
              void inboxRequest<MyTasksBody>(
                row.base,
                `/mytasks/${encodeURIComponent(row.id)}/unsnooze`,
                { method: "POST", body: {} },
              ).then((b) => setData((prev) => ({ ...prev, [row.environmentId]: b })));
            },
          },
        });
      }
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "Not snoozed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  // Keyboard in the list: arrows or j/k move, escape closes the task.
  const keyState = useRef({ visible, selected, view });
  keyState.current = { visible, selected, view };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.closest("[role=menu],[role=listbox],[role=dialog]"))
      )
        return;
      const { visible: list, selected: current, view: mode } = keyState.current;
      if (event.key === "Escape" && current) {
        setSelectedKey(null);
        return;
      }
      if (mode !== "list") return;
      const index = current ? list.findIndex((r) => r.key === current.key) : -1;
      const next =
        event.key === "ArrowDown" || event.key === "j"
          ? list[Math.min(index + 1, list.length - 1)]
          : event.key === "ArrowUp" || event.key === "k"
            ? list[Math.max(index - 1, 0)]
            : undefined;
      if (next) {
        event.preventDefault();
        setSelectedKey(next.key);
        const el = document.querySelector<HTMLElement>(`[data-task-key="${CSS.escape(next.key)}"]`);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notConnected = feeds.filter(
    (feed) =>
      inOrganisationScope(scope, feed.environmentId) && (feed.error || !feed.health?.configured),
  );
  const loading = !loaded && sources.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">My tasks</h1>
        <span className="truncate text-sm text-muted-foreground">
          {scope === "all" ? "All organisations" : labelFor(scope)}
        </span>
        <div className="min-w-0 flex-1" />
        {lastChecked ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Checked {timeAgo(lastChecked) === "now" ? "just now" : `${timeAgo(lastChecked)} ago`}
          </span>
        ) : null}
        <ToggleGroup
          aria-label="Task view"
          variant="segmented"
          value={[view]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "list" || value === "board") setView(value);
          }}
        >
          <Toggle value="list" aria-label="List">
            <ListIcon className="size-4" />
            <span className="hidden sm:inline">List</span>
          </Toggle>
          <Toggle value="board" aria-label="Board">
            <KanbanIcon className="size-4" />
            <span className="hidden sm:inline">Board</span>
          </Toggle>
        </ToggleGroup>
        <Button variant="ghost" size="sm" disabled={checking} onClick={() => void checkNow()}>
          <RefreshCwIcon className={cn("size-4", checking && "animate-spin")} />
          {checking ? "Checking" : "Check now"}
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 border-t border-border/50">
        {view === "list" ? (
          <aside
            className={cn(
              "min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:flex md:w-[400px]",
              selected ? "hidden" : "flex",
            )}
          >
            <div className="p-3">
              <SearchField label="Search my tasks" value={query} onChange={setQuery} />
            </div>
            <Notices
              notConnected={notConnected.map((f) => labelFor(f.environmentId))}
              errors={Object.entries(errors).map(
                ([id, err]) => `${labelFor(id as EnvironmentId)}: ${err}`,
              )}
            />
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
              {loading ? (
                <li className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
                  <Spinner className="size-3.5" />
                  Loading your tasks
                </li>
              ) : visible.length === 0 ? (
                <li className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {query ? "Nothing matches." : "No open tasks assigned to you."}
                </li>
              ) : (
                visible.map((row, index) => {
                  const bucket = bucketOf(row);
                  const first = index === 0 || bucketOf(visible[index - 1]!).key !== bucket.key;
                  const count = first
                    ? visible.filter((r) => bucketOf(r).key === bucket.key).length
                    : 0;
                  return (
                    <Fragment key={row.key}>
                      {first ? (
                        <li
                          className={cn(
                            "flex items-center gap-2 px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase",
                            bucket.key === "overdue" ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {bucket.label}
                          <span className="font-normal opacity-70">{count}</span>
                        </li>
                      ) : null}
                      <TaskListItem
                        row={row}
                        selected={row.key === selected?.key}
                        showOrganisation={scope === "all"}
                        onSelect={() => setSelectedKey(row.key)}
                      />
                    </Fragment>
                  );
                })
              )}
            </ul>
          </aside>
        ) : (
          <div
            className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "hidden lg:flex" : "flex")}
          >
            <div className="flex items-center gap-3 px-4 pt-3">
              <div className="w-full max-w-xs">
                <SearchField label="Search my tasks" value={query} onChange={setQuery} />
              </div>
            </div>
            <Notices
              notConnected={notConnected.map((f) => labelFor(f.environmentId))}
              errors={Object.entries(errors).map(
                ([id, err]) => `${labelFor(id as EnvironmentId)}: ${err}`,
              )}
            />
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Loading your tasks
              </p>
            ) : (
              <Board
                rows={visible.filter((r) => !r.snoozed_until)}
                selectedKey={selected?.key ?? null}
                onSelect={setSelectedKey}
                onMove={setStatus}
              />
            )}
          </div>
        )}
        <section
          className={cn(
            "min-h-0 min-w-0 flex-col",
            view === "list"
              ? cn("flex-1 md:flex", selected ? "flex" : "hidden")
              : cn(
                  "border-l border-border/50",
                  selected ? "flex w-full lg:w-[480px] lg:shrink-0" : "hidden",
                ),
          )}
        >
          {selected ? (
            <TaskDetail
              key={selected.key}
              row={selected}
              showOrganisation={scope === "all"}
              onClose={() => setSelectedKey(null)}
              onStatus={(name) => void setStatus(selected, name)}
              onSnooze={(on) => void snooze(selected, on)}
            />
          ) : view === "list" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <ListTodoIcon className="size-6" />
              {visible.length > 0 ? "Choose a task on the left." : "Nothing here."}
              {visible.length > 0 ? (
                <span className="text-xs">Arrow keys move · Esc closes</span>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Notices({ notConnected, errors }: { notConnected: string[]; errors: string[] }) {
  const lines = [
    ...notConnected.map(
      (label) =>
        `${label}: ClickUp is not connected. Connect it under Settings, Integrations, Inbox.`,
    ),
    ...errors,
  ];
  if (lines.length === 0) return null;
  return (
    <div className="mx-3 mb-2 flex flex-col gap-1">
      {lines.map((line) => (
        <p
          key={line}
          className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function TaskListItem({
  row,
  selected,
  showOrganisation,
  onSelect,
}: {
  row: TaskRow;
  selected: boolean;
  showOrganisation: boolean;
  onSelect: () => void;
}) {
  const due = dueText(row.due_date);
  const overdue = row.due_date !== null && row.due_date < Date.now() && !row.snoozed_until;
  return (
    <li>
      <button
        type="button"
        data-task-key={row.key}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "relative flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          selected
            ? "bg-sidebar-row-selected before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
            : "hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex w-full items-start gap-2">
          <StatusDot status={row.status} className="mt-1.5" />
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground/90">{row.name}</span>
          {due ? (
            <span
              className={cn(
                "shrink-0 pt-0.5 text-xs",
                overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {due}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4.5 text-xs text-muted-foreground">
          <span className="capitalize">{row.status.status}</span>
          <span aria-hidden>·</span>
          <span className="truncate">
            {row.folder ? `${row.folder} › ${row.list.name}` : row.list.name}
          </span>
          {showOrganisation ? <span>· {row.organisation}</span> : null}
          <PriorityFlag priority={row.priority} />
          <Tags tags={row.tags} max={2} />
        </span>
      </button>
    </li>
  );
}

function Board({
  rows,
  selectedKey,
  onSelect,
  onMove,
}: {
  rows: TaskRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onMove: (row: TaskRow, status: string) => Promise<void>;
}) {
  const columns = useMemo(() => {
    const byName = new Map<string, { name: string; color: string; type: string; order: number }>();
    for (const row of rows) {
      for (const s of row.statuses) {
        const key = s.status.toLowerCase();
        const seen = byName.get(key);
        if (!seen)
          byName.set(key, { name: s.status, color: s.color, type: s.type, order: s.orderindex });
        else seen.order = Math.min(seen.order, s.orderindex);
      }
    }
    return [...byName.entries()]
      .map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => (STATUS_RANK[a.type] ?? 1) - (STATUS_RANK[b.type] ?? 1) || a.order - b.order);
  }, [rows]);
  const [over, setOver] = useState<string | null>(null);
  const onDrop = (event: DragEvent, column: string) => {
    event.preventDefault();
    setOver(null);
    const key = event.dataTransfer.getData("text/plain");
    const row = rows.find((r) => r.key === key);
    if (row && row.status.status.toLowerCase() !== column) void onMove(row, column);
  };
  if (rows.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No open tasks assigned to you.
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {columns.map((column) => {
        const cards = rows.filter((r) => r.status.status.toLowerCase() === column.key);
        return (
          <section
            key={column.key}
            aria-label={column.name}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.key);
            }}
            onDragLeave={() => setOver((cur) => (cur === column.key ? null : cur))}
            onDrop={(event) => onDrop(event, column.key)}
            className={cn(
              "flex max-h-full w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5 transition-colors",
              over === column.key && "border-primary/50 bg-primary/5",
            )}
          >
            <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
              <StatusDot
                status={{
                  status: column.name,
                  color: column.color,
                  type: column.type,
                  orderindex: column.order,
                }}
              />
              <span className="truncate text-xs font-medium tracking-wide uppercase">
                {column.name}
              </span>
              <span className="text-xs text-muted-foreground">{cards.length}</span>
            </header>
            <div className="flex min-h-16 flex-col gap-2 overflow-y-auto p-2">
              {cards.map((row) => {
                const due = dueText(row.due_date);
                const overdue = row.due_date !== null && row.due_date < Date.now();
                return (
                  <button
                    key={row.key}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", row.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onSelect(row.key)}
                    className={cn(
                      "flex w-full cursor-grab flex-col gap-1.5 rounded-lg border border-border/60 bg-background/80 p-2.5 text-left outline-none transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                      selectedKey === row.key && "border-primary/60 bg-sidebar-row-selected",
                    )}
                  >
                    <span className="text-sm font-medium text-foreground/90">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{row.list.name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {due ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs",
                            overdue ? "font-medium text-destructive" : "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="size-3" />
                          {due}
                        </span>
                      ) : null}
                      <PriorityFlag priority={row.priority} />
                      <Tags tags={row.tags} max={2} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskDetail({
  row,
  showOrganisation,
  onClose,
  onStatus,
  onSnooze,
}: {
  row: TaskRow;
  showOrganisation: boolean;
  onClose: () => void;
  onStatus: (name: string) => void;
  onSnooze: (on: boolean) => void;
}) {
  const [detail, setDetail] = useState<MyTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    inboxRequest<MyTaskDetail>(row.base, `/mytasks/${encodeURIComponent(row.id)}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [row.base, row.id]);
  const send = async () => {
    const text = comment.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const d = await inboxRequest<MyTaskDetail>(
        row.base,
        `/mytasks/${encodeURIComponent(row.id)}/comment`,
        { method: "POST", body: { text } },
      );
      setDetail(d);
      setComment("");
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "Comment not posted",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  };
  const due = dueText(row.due_date);
  const overdue = row.due_date !== null && row.due_date < Date.now();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-5 py-3">
        <Select
          value={row.status.status}
          onValueChange={(value) => typeof value === "string" && onStatus(value)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Status">
            <SelectValue>
              <span className="inline-flex items-center gap-2 capitalize">
                <StatusDot status={row.status} />
                {row.status.status}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {row.statuses.map((s) => (
              <SelectItem hideIndicator key={s.status} value={s.status}>
                <span className="inline-flex items-center gap-2 capitalize">
                  <StatusDot status={s} />
                  {s.status}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="flex-1" />
        {row.url ? (
          <IconAction
            label="Open in ClickUp"
            onClick={() => window.open(row.url!, "_blank", "noopener,noreferrer")}
          >
            <ExternalLinkIcon className="size-4" />
          </IconAction>
        ) : null}
        {row.snoozed_until ? (
          <IconAction label="Unsnooze" onClick={() => onSnooze(false)}>
            <BellOffIcon className="size-4" />
          </IconAction>
        ) : (
          <IconAction label="Snooze a day" onClick={() => onSnooze(true)}>
            <ClockIcon className="size-4" />
          </IconAction>
        )}
        <IconAction label="Close (Esc)" onClick={onClose}>
          <XIcon className="size-4" />
        </IconAction>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {row.folder ? `${row.folder} › ${row.list.name}` : row.list.name}
            {showOrganisation ? ` · ${row.organisation}` : ""}
          </p>
          <h2 className="text-lg font-semibold tracking-tight">{row.name}</h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {due ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  overdue && "font-medium text-destructive",
                )}
              >
                <CalendarIcon className="size-3.5" />
                {due}
                {row.due_date !== null
                  ? ` · ${new Date(row.due_date).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`
                  : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="size-3.5" />
                No due date
              </span>
            )}
            <PriorityFlag priority={row.priority} />
            <Tags tags={row.tags} max={6} />
            {row.snoozed_until ? (
              <span>
                Snoozed until{" "}
                {new Date(row.snoozed_until).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {detail === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            Loading the task
          </p>
        ) : null}
        {detail ? (
          <>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              {detail.description.trim() ? (
                detail.description
              ) : (
                <span className="text-muted-foreground">No description.</span>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Comments
              </h3>
              {detail.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : null}
              {detail.comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar name={c.who} src={c.who_avatar} className="size-7 text-[10px]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{c.who}</span> ·{" "}
                      {timeAgo(c.at)}
                      {c.replies > 0
                        ? ` · ${c.replies} ${c.replies === 1 ? "reply" : "replies"}`
                        : ""}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div className="flex flex-col rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
          <Textarea
            unstyled
            value={comment}
            placeholder="Comment on the task"
            className="block w-full [&_textarea]:min-h-24 [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:leading-relaxed"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setComment(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2.5">
            <span className="flex-1" />
            <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter</span>
            <Button
              size="sm"
              disabled={sending || comment.trim().length === 0}
              onClick={() => void send()}
            >
              Comment
              <SendIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
