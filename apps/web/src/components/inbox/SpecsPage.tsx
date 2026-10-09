import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GavelIcon,
  GitPullRequestIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import ChatMarkdown from "../ChatMarkdown";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { inboxRequest, refreshInbox, useInboxFeeds } from "../../state/inbox";
import {
  inOrganisationScope,
  useOrganisationLabel,
  useOrganisationScope,
} from "../../state/organisation";
import type { Constitution, Spec, SpecRequirement, SpecStep, SpecSummary } from "../../state/specs";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { IconAction, SearchField, timeAgo, ago } from "./shared";

type Selection =
  | { readonly kind: "spec"; readonly env: EnvironmentId; readonly id: string }
  | { readonly kind: "constitution"; readonly env: EnvironmentId }
  | { readonly kind: "new"; readonly env: EnvironmentId };

const STATUS_LABEL: Record<string, string> = {
  prd: "PRD written",
  drafting: "Drafting",
  requirements_to_approve: "Requirements to approve",
  design_to_approve: "Design to approve",
  building: "Building",
  done: "Done",
};
const STEP_LABEL: Record<string, string> = {
  todo: "To do",
  speccing: "Writing the step spec",
  spec_to_approve: "Spec to approve",
  spec_failed: "Spec failed",
  building: "Building",
  needs_you: "Needs you",
  checks_passed: "Checks passed",
  pr_open: "Pull request open",
  pr_closed: "Pull request closed",
  merged: "Merged",
};
const REQ_LABEL: Record<string, string> = {
  uncovered: "No step",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};
const TEXTAREA =
  "block w-full rounded-lg border border-border/60 bg-background/60 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:leading-relaxed";

function useRepos(environmentId: EnvironmentId | null) {
  const projects = useProjects();
  return useMemo(
    () =>
      projects
        .filter((p) => p.environmentId === environmentId && p.workspaceRoot)
        .map((p) => ({ name: p.title, path: p.workspaceRoot })),
    [projects, environmentId],
  );
}

function Card({
  title,
  icon,
  aside,
  children,
  footer,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
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
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 px-3 py-2.5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function StepIcon({ state }: { state: string | undefined }) {
  if (state === "merged") return <CheckCircle2Icon className="size-4 shrink-0 text-success" />;
  if (state === "building" || state === "speccing")
    return <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  if (state === "spec_failed" || state === "pr_closed")
    return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
  if (state === "todo" || !state)
    return <CircleIcon className="size-4 shrink-0 text-muted-foreground/60" />;
  return <CircleDashedIcon className="size-4 shrink-0 text-info" />;
}

export function SpecsPage() {
  const feeds = useInboxFeeds();
  const scope = useOrganisationScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { spec?: string };
  const labelFor = useCallback(
    (environmentId: EnvironmentId) =>
      organisationLabel(
        environmentId,
        environments.find((e) => e.environmentId === environmentId)?.label ?? environmentId,
      ),
    [environments, organisationLabel],
  );
  const sources = useMemo(
    () => feeds.filter((f) => inOrganisationScope(scope, f.environmentId) && !f.error),
    [feeds, scope],
  );
  const sourceKey = sources.map((s) => `${s.environmentId}@${s.base}`).join("|");
  const baseFor = useCallback(
    (env: EnvironmentId) => feeds.find((f) => f.environmentId === env)?.base ?? null,
    [feeds],
  );
  const [lists, setLists] = useState<Record<string, ReadonlyArray<SpecSummary>>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const loadLists = useCallback(async () => {
    const current = sourcesRef.current;
    const results = await Promise.all(
      current.map(async (f) => {
        try {
          return [
            f.environmentId,
            (await inboxRequest<{ specs: SpecSummary[] }>(f.base, "/specs")).specs,
          ] as const;
        } catch {
          return [f.environmentId, null] as const;
        }
      }),
    );
    setLists((prev) => {
      const next: Record<string, ReadonlyArray<SpecSummary>> = {};
      for (const [env, specs] of results) {
        const kept = specs ?? prev[env];
        if (kept) next[env] = kept;
      }
      return next;
    });
    setLoadedKey(current.map((s) => `${s.environmentId}@${s.base}`).join("|"));
  }, []);
  useEffect(() => {
    void loadLists();
    const t = setInterval(() => void loadLists(), 30_000);
    return () => clearInterval(t);
  }, [loadLists, sourceKey]);

  const [selection, setSelection] = useState<Selection | null>(null);
  // A link from a plan card names the spec to open.
  useEffect(() => {
    if (!search.spec) return;
    for (const [env, specs] of Object.entries(lists)) {
      if (specs.some((s) => s.id === search.spec)) {
        setSelection({ kind: "spec", env: env as EnvironmentId, id: search.spec });
        void navigate({ to: "/specs", search: {}, replace: true });
        return;
      }
    }
  }, [lists, search.spec, navigate]);

  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      sources.flatMap((f) =>
        (lists[f.environmentId] ?? [])
          .filter(
            (s) => !query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .map((s) => ({ ...s, env: f.environmentId, organisation: labelFor(f.environmentId) })),
      ),
    [sources, lists, query, labelFor],
  );
  const loading = sources.length > 0 && loadedKey !== sourceKey;
  const defaultEnv = (scope !== "all" ? scope : sources[0]?.environmentId) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader>
        <h1 className="text-sm font-medium">Specs</h1>
        <span className="truncate text-sm text-muted-foreground">
          {scope === "all" ? "All organisations" : labelFor(scope)}
        </span>
        <div className="min-w-0 flex-1" />
        {defaultEnv ? (
          <Button size="sm" onClick={() => setSelection({ kind: "new", env: defaultEnv })}>
            <PlusIcon className="size-4" />
            New spec
          </Button>
        ) : null}
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 border-t border-border/50">
        <aside
          className={cn(
            "min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:flex md:w-[340px]",
            selection ? "hidden" : "flex",
          )}
        >
          <div className="p-3">
            <SearchField label="Search specs" value={query} onChange={setQuery} />
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
            {sources.map((f) => (
              <li key={`c-${f.environmentId}`}>
                <button
                  type="button"
                  onClick={() => setSelection({ kind: "constitution", env: f.environmentId })}
                  className={cn(
                    "relative flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selection?.kind === "constitution" && selection.env === f.environmentId
                      ? "bg-sidebar-row-selected"
                      : "hover:bg-sidebar-row-hover",
                  )}
                >
                  <GavelIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">Constitution</span>
                  {sources.length > 1 ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {labelFor(f.environmentId)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            <li className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Specs
            </li>
            {loading ? (
              <li className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Loading
              </li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-6 text-sm text-muted-foreground">
                {query
                  ? "Nothing matches."
                  : "No specs yet. Start with New spec, or Create PRD on a plan."}
              </li>
            ) : (
              rows.map((s) => {
                const selected =
                  selection?.kind === "spec" && selection.env === s.env && selection.id === s.id;
                const pct = s.progress.total
                  ? Math.round((100 * s.progress.merged) / s.progress.total)
                  : 0;
                return (
                  <li key={`${s.env}:${s.id}`}>
                    <button
                      type="button"
                      onClick={() => setSelection({ kind: "spec", env: s.env, id: s.id })}
                      className={cn(
                        "relative flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "bg-sidebar-row-selected before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                          : "hover:bg-sidebar-row-hover",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {s.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(s.updated_at)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
                        <Badge
                          variant={
                            s.status === "done"
                              ? "success"
                              : s.status.endsWith("to_approve")
                                ? "info"
                                : "secondary"
                          }
                          size="sm"
                        >
                          {STATUS_LABEL[s.status] ?? s.status}
                        </Badge>
                        {s.progress.total > 0 ? (
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-success"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            {s.progress.merged}/{s.progress.total}
                          </span>
                        ) : null}
                        {scope === "all" ? (
                          <span className="truncate">{s.organisation}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>
        <section
          className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", selection ? "flex" : "hidden")}
        >
          {selection?.kind === "spec" && baseFor(selection.env) ? (
            <SpecDetail
              key={`${selection.env}:${selection.id}`}
              base={baseFor(selection.env)!}
              env={selection.env}
              id={selection.id}
              onClose={() => setSelection(null)}
              onChanged={() => void loadLists()}
              onDeleted={() => {
                setSelection(null);
                void loadLists();
              }}
            />
          ) : selection?.kind === "constitution" && baseFor(selection.env) ? (
            <ConstitutionDetail
              key={`c:${selection.env}`}
              base={baseFor(selection.env)!}
              env={selection.env}
              label={labelFor(selection.env)}
              onClose={() => setSelection(null)}
            />
          ) : selection?.kind === "new" ? (
            <NewSpec
              envs={sources.map((f) => ({
                env: f.environmentId,
                label: labelFor(f.environmentId),
                base: f.base,
              }))}
              initialEnv={selection.env}
              onClose={() => setSelection(null)}
              onCreated={(env, id) => {
                void loadLists();
                setSelection({ kind: "spec", env, id });
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted-foreground">
              <ScrollTextIcon className="size-6" />
              <p>A spec takes a PRD to numbered requirements, a design and steps.</p>
              <p className="text-xs">
                You approve the requirements and the design; each step ticks only when its checks
                pass and its pull request merges.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NewSpec({
  envs,
  initialEnv,
  onClose,
  onCreated,
}: {
  envs: ReadonlyArray<{ env: EnvironmentId; label: string; base: string }>;
  initialEnv: EnvironmentId;
  onClose: () => void;
  onCreated: (env: EnvironmentId, id: string) => void;
}) {
  const [env, setEnv] = useState<EnvironmentId>(initialEnv);
  const repos = useRepos(env);
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [prd, setPrd] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // "" lets each step name its repository: the planner reads them all and decides
    if (repo && !repos.some((r) => r.path === repo)) setRepo("");
  }, [repos, repo]);
  const create = async () => {
    const base = envs.find((e) => e.env === env)?.base;
    if (!base) return;
    setBusy(true);
    try {
      const sp = await inboxRequest<Spec>(base, "/specs", {
        method: "POST",
        body: { title, repo, prd },
      });
      onCreated(env, sp.id);
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "Spec not created",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">New spec</h2>
        <p className="text-sm text-muted-foreground">
          Write the PRD: who it is for, the problem, what it must do, what is out of scope, and what
          done looks like. A plan from a Plan-mode thread works too. The next step drafts numbered
          requirements, a design and steps from it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            className="min-w-64 flex-1"
            placeholder="Title, for example Browser phone for agents"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {envs.length > 1 ? (
            <Select
              value={env}
              onValueChange={(v) => typeof v === "string" && setEnv(v as EnvironmentId)}
            >
              <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Organisation">
                <SelectValue>{envs.find((e) => e.env === env)?.label}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {envs.map((e) => (
                  <SelectItem hideIndicator key={e.env} value={e.env}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          <Select
            value={repo || "__steps"}
            onValueChange={(v) => typeof v === "string" && setRepo(v === "__steps" ? "" : v)}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-48"
              aria-label="Repository for the steps"
            >
              <SelectValue>
                {repo
                  ? (repos.find((r) => r.path === repo)?.name ?? "Chief decides per step")
                  : "Chief decides per step"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="__steps">
                Chief decides per step
              </SelectItem>
              {repos.map((r) => (
                <SelectItem hideIndicator key={r.path} value={r.path}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Textarea
          unstyled
          value={prd}
          placeholder="The PRD, in plain words or markdown"
          className={TEXTAREA}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrd(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !title.trim()} onClick={() => void create()}>
            Create spec
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConstitutionDetail({
  base,
  env,
  label,
  onClose,
}: {
  base: string;
  env: EnvironmentId;
  label: string;
  onClose: () => void;
}) {
  const repos = useRepos(env);
  const [data, setData] = useState<Constitution | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const d = await inboxRequest<Constitution>(base, "/constitution");
      setData(d);
      setText((cur) => (editing ? cur : d.text));
    } catch {}
  }, [base, editing]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (data?.draft.state !== "pending") return;
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, [data?.draft.state, load]);
  const save = async (value: string, clearDraft = false) => {
    setBusy(true);
    try {
      setData(
        await inboxRequest<Constitution>(base, "/constitution", {
          method: "PUT",
          body: { text: value, clear_draft: clearDraft },
        }),
      );
      setText(value);
      setEditing(false);
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "Not saved",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };
  const draft = async () => {
    setBusy(true);
    try {
      await inboxRequest(base, "/constitution/draft", { method: "POST", body: { repos } });
      await load();
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "Could not start the draft",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-5 py-3 lg:px-8">
        <GavelIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Constitution</p>
          <p className="truncate text-xs text-muted-foreground">
            {label} · {data?.updated_at ? `saved ${ago(data.updated_at)}` : "not written yet"} ·
            every spec, step, change and review is held to it
          </p>
        </div>
        <IconAction label="Close" onClick={onClose}>
          <XCircleIcon className="size-4" />
        </IconAction>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 lg:px-8">
        {data === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            Loading
          </p>
        ) : null}
        {data && data.draft.state !== "idle" ? (
          <Card
            title="Draft from the code"
            icon={<ScrollTextIcon className="size-4 text-muted-foreground" />}
            aside={
              data.draft.at ? (
                <span className="text-xs text-muted-foreground">{ago(data.draft.at)}</span>
              ) : null
            }
            footer={
              data.draft.state === "ready" ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void save(data.text, true)}
                  >
                    Discard draft
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(data.draft.text ?? "", true)}
                  >
                    Use this draft
                  </Button>
                </>
              ) : null
            }
          >
            {data.draft.state === "pending" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Reading the repositories and writing a draft. This takes a few minutes.
              </p>
            ) : data.draft.state === "failed" ? (
              <p className="text-sm text-destructive">The draft failed: {data.draft.error}</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <ChatMarkdown
                  text={data.draft.text ?? ""}
                  cwd={undefined}
                  environmentId={env}
                  className="text-sm"
                />
              </div>
            )}
          </Card>
        ) : null}
        {data ? (
          <Card
            title="Rules"
            icon={<GavelIcon className="size-4 text-muted-foreground" />}
            aside={
              editing ? null : (
                <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                  <PencilIcon className="size-3.5" />
                  Edit
                </Button>
              )
            }
            footer={
              editing ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setText(data.text);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void save(text)}>
                    Save
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || data.draft.state === "pending"}
                  onClick={() => void draft()}
                >
                  <ScrollTextIcon className="size-3.5" />
                  {data.text ? "Redraft from the code" : "Draft from the code"}
                </Button>
              )
            }
          >
            {editing ? (
              <Textarea
                unstyled
                value={text}
                className={TEXTAREA}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              />
            ) : data.text.trim() ? (
              <ChatMarkdown
                text={data.text}
                cwd={undefined}
                environmentId={env}
                className="text-sm"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No rules yet. Draft them from the code: an agent reads the repositories and proposes
                rules for security, data, testing, architecture, code quality, reliability and
                review. You edit and save; from then on every agent follows them.
              </p>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SpecDetail({
  base,
  env,
  id,
  onClose,
  onChanged,
  onDeleted,
}: {
  base: string;
  env: EnvironmentId;
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const repos = useRepos(env);
  const navigate = useNavigate();
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSpec(await inboxRequest<Spec>(base, `/specs/${encodeURIComponent(id)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base, id]);
  useEffect(() => {
    void load();
  }, [load]);
  const active =
    spec?.status === "drafting" ||
    spec?.steps.some(
      (st) => ["speccing", "building"].includes(st.state ?? "") || st.state === "pr_open",
    );
  useEffect(() => {
    const t = setInterval(() => void load(), active ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [active, load]);
  const call = async (path: string, method: string, bodyValue?: unknown) => {
    setBusy(true);
    try {
      setSpec(
        await inboxRequest<Spec>(base, `/specs/${encodeURIComponent(id)}${path}`, {
          method,
          ...(bodyValue !== undefined ? { body: bodyValue } : {}),
        }),
      );
      onChanged();
      void refreshInbox(env);
      return true;
    } catch (e) {
      toastManager.add({
        type: "error",
        title: "That did not work",
        description: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (error && !spec) return <p className="p-5 text-sm text-destructive">{error}</p>;
  if (!spec)
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading the spec
      </p>
    );
  const repoName = (path: string) =>
    repos.find((r) => r.path === path)?.name ?? path.split("/").pop() ?? path;
  const pct = spec.progress.total
    ? Math.round((100 * spec.progress.merged) / spec.progress.total)
    : 0;
  const approvedReq = Boolean(spec.approvals.requirements);
  const approvedDesign = Boolean(spec.approvals.design);
  const stepById = new Map(spec.steps.map((st) => [st.id, st]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-5 py-3 lg:px-8">
        <FileTextIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{spec.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {STATUS_LABEL[spec.status] ?? spec.status} · {repoName(spec.repo)} · updated{" "}
            {ago(spec.updated_at)}
          </p>
        </div>
        {spec.progress.total > 0 ? (
          <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
            </span>
            {spec.progress.merged} of {spec.progress.total} merged
          </span>
        ) : null}
        <IconAction
          label="Delete the spec"
          disabled={busy}
          onClick={() =>
            void inboxRequest(base, `/specs/${encodeURIComponent(id)}`, { method: "DELETE" })
              .then(onDeleted)
              .catch((e) =>
                toastManager.add({
                  type: "error",
                  title: "Not deleted",
                  description: e instanceof Error ? e.message : String(e),
                }),
              )
          }
        >
          <Trash2Icon className="size-4" />
        </IconAction>
        <IconAction label="Close" onClick={onClose}>
          <XCircleIcon className="size-4" />
        </IconAction>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:px-8">
        <Stepper spec={spec} />
        <EditableMarkdown
          title="PRD"
          env={env}
          value={spec.prd}
          empty="No PRD yet."
          busy={busy}
          onSave={(prd) => call("", "PUT", { prd })}
          footer={
            spec.steps.some((st) => st.chief_task_id) ? null : spec.drafting.state === "pending" ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Drafting requirements, design and steps from the code. A few minutes.
              </span>
            ) : (
              <>
                {spec.drafting.state === "failed" ? (
                  <span className="text-xs text-destructive">
                    The draft failed: {spec.drafting.error}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant={spec.requirements.length ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => void call("/draft", "POST", { repos })}
                >
                  <ScrollTextIcon className="size-3.5" />
                  {spec.requirements.length
                    ? "Redraft from the PRD"
                    : "Draft requirements, design and steps"}
                </Button>
              </>
            )
          }
        />
        {spec.requirements.length > 0 ? (
          <RequirementsCard
            spec={spec}
            busy={busy}
            onSave={(requirements) => call("", "PUT", { requirements })}
            onApprove={() => call("/approve", "POST", { what: "requirements" })}
          />
        ) : null}
        {spec.design.trim() ? (
          <EditableMarkdown
            title="Design"
            env={env}
            value={spec.design}
            empty=""
            busy={busy}
            aside={
              approvedDesign ? (
                <Badge variant="success" size="sm">
                  Approved {ago(spec.approvals.design!)}
                </Badge>
              ) : null
            }
            onSave={(design) => call("", "PUT", { design })}
            footer={
              approvedDesign ? null : (
                <Button
                  size="sm"
                  disabled={busy || !approvedReq}
                  onClick={() => void call("/approve", "POST", { what: "design" })}
                >
                  {approvedReq ? "Approve the design" : "Approve the requirements first"}
                </Button>
              )
            }
          />
        ) : null}
        {spec.steps.length > 0 ? (
          <Card
            title="Steps"
            icon={<CheckCircle2Icon className="size-4 text-muted-foreground" />}
            aside={
              <span className="text-xs text-muted-foreground">
                A step ticks only when its checks pass, the review approves and its pull request
                merges.
              </span>
            }
          >
            <ol className="flex flex-col divide-y divide-border/50">
              {spec.steps.map((st) => (
                <StepRow
                  key={st.id}
                  step={st}
                  stepById={stepById}
                  repoName={repoName}
                  busy={busy}
                  canBuild={approvedReq && approvedDesign}
                  onAction={(action) =>
                    call(`/steps/${encodeURIComponent(st.id)}/${action}`, "POST", {})
                  }
                  onEdit={(patch) => call(`/steps/${encodeURIComponent(st.id)}`, "PUT", patch)}
                  onLink={(links) =>
                    call(`/steps/${encodeURIComponent(st.id)}/links`, "POST", links)
                  }
                  allRequirements={spec.requirements}
                  onWatch={(threadId) =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId: env, threadId },
                    })
                  }
                />
              ))}
            </ol>
          </Card>
        ) : null}
        {spec.open_questions.length > 0 ? (
          <Card
            title="Open questions"
            icon={<ScrollTextIcon className="size-4 text-muted-foreground" />}
          >
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {spec.open_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Stepper({ spec }: { spec: Spec }) {
  const stages = [
    { label: "PRD", done: spec.prd.trim().length > 0 },
    { label: "Requirements", done: Boolean(spec.approvals.requirements) },
    { label: "Design", done: Boolean(spec.approvals.design) },
    {
      label: "Steps",
      done: spec.progress.total > 0 && spec.progress.merged === spec.progress.total,
    },
  ];
  const current = stages.findIndex((s) => !s.done);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {stages.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 ? <span aria-hidden className="h-px w-6 bg-border" /> : null}
          <li
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              s.done
                ? "border-success/40 text-success-foreground"
                : i === current
                  ? "border-primary/50 text-foreground"
                  : "border-border/60 text-muted-foreground",
            )}
          >
            {s.done ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <CircleIcon className="size-3.5" />
            )}
            {s.label}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

function EditableMarkdown({
  title,
  env,
  value,
  empty,
  busy,
  aside,
  footer,
  onSave,
}: {
  title: string;
  env: EnvironmentId;
  value: string;
  empty: string;
  busy: boolean;
  aside?: ReactNode;
  footer?: ReactNode;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  return (
    <Card
      title={title}
      icon={<FileTextIcon className="size-4 text-muted-foreground" />}
      aside={
        <>
          {aside}
          {editing ? null : (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          )}
        </>
      }
      footer={
        editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setText(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void onSave(text).then((ok) => ok && setEditing(false))}
            >
              Save
            </Button>
          </>
        ) : (
          footer
        )
      }
    >
      {editing ? (
        <Textarea
          unstyled
          value={text}
          className={TEXTAREA}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        />
      ) : value.trim() ? (
        <div className="max-h-[32rem] overflow-y-auto">
          <ChatMarkdown text={value} cwd={undefined} environmentId={env} className="text-sm" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}

/** Requirements as lines: `R1 | kind | statement`, which keeps editing simple. */
function RequirementsCard({
  spec,
  busy,
  onSave,
  onApprove,
}: {
  spec: Spec;
  busy: boolean;
  onSave: (requirements: SpecRequirement[]) => Promise<boolean>;
  onApprove: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const asText = (rs: ReadonlyArray<SpecRequirement>) =>
    rs.map((r) => `${r.id} | ${r.kind} | ${r.statement}`).join("\n");
  const [text, setText] = useState(asText(spec.requirements));
  useEffect(() => {
    if (!editing) setText(asText(spec.requirements));
  }, [spec.requirements, editing]);
  const parse = (): SpecRequirement[] =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l, i) => {
        const parts = l.split("|").map((p) => p.trim());
        if (parts.length >= 3)
          return {
            id: parts[0] || `R${i + 1}`,
            kind: parts[1] || "functional",
            statement: parts.slice(2).join(" | "),
          };
        return { id: `R${i + 1}`, kind: "functional", statement: l };
      });
  const approved = Boolean(spec.approvals.requirements);
  return (
    <Card
      title="Requirements"
      icon={<GavelIcon className="size-4 text-muted-foreground" />}
      aside={
        <>
          {approved ? (
            <Badge variant="success" size="sm">
              Approved {ago(spec.approvals.requirements!)}
            </Badge>
          ) : null}
          {editing ? null : (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          )}
        </>
      }
      footer={
        editing ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              One per line: id | kind | WHEN … THE SYSTEM SHALL …. Saving asks for approval again.
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void onSave(parse()).then((ok) => ok && setEditing(false))}
            >
              Save
            </Button>
          </>
        ) : approved ? null : (
          <Button size="sm" disabled={busy} onClick={() => void onApprove()}>
            Approve the requirements
          </Button>
        )
      }
    >
      {editing ? (
        <Textarea
          unstyled
          value={text}
          className={TEXTAREA}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {spec.requirements.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2">
              <span className="w-8 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
                {r.id}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {r.statement}
                {r.rationale ? (
                  <span className="block text-xs text-muted-foreground">{r.rationale}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="secondary" size="sm" className="capitalize">
                  {r.kind}
                </Badge>
                <Badge
                  variant={
                    r.state === "done"
                      ? "success"
                      : r.state === "uncovered"
                        ? "error"
                        : r.state === "in_progress"
                          ? "info"
                          : "secondary"
                  }
                  size="sm"
                >
                  {REQ_LABEL[r.state ?? "planned"]}
                  {r.steps && r.steps.length ? ` · ${r.steps.join(", ")}` : ""}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The owner edits a step: its summary and the requirements it delivers (a requirement with no step blocks the
 *  design's approval, so this is where one is taken on). */
function StepEditor({
  step,
  requirements,
  busy,
  onCancel,
  onSave,
}: {
  step: SpecStep;
  requirements: ReadonlyArray<SpecRequirement>;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { summary: string; requirements: string[]; title: string }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(step.title);
  const [summary, setSummary] = useState(step.summary);
  const [picked, setPicked] = useState<string[]>([...step.requirements]);
  return (
    <div className="flex flex-col gap-2">
      <Input
        value={title}
        aria-label="Step title"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
      />
      <Textarea
        unstyled
        value={summary}
        aria-label="Step summary"
        className="block w-full rounded-lg border border-border/60 bg-background/60 [&_textarea]:min-h-20 [&_textarea]:resize-y [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm"
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSummary(e.target.value)}
      />
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Requirements this step delivers
      </p>
      <div className="flex flex-wrap gap-1.5">
        {requirements.map((r) => {
          const on = picked.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              title={r.statement}
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-xs",
                on
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground",
              )}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== r.id) : [...p, r.id]))}
            >
              {r.id}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={busy || !title.trim()}
          onClick={() => void onSave({ title, summary, requirements: picked })}
        >
          Save the step
        </Button>
      </div>
    </div>
  );
}

/** Pull requests the owner opened by hand (main and its staging pair): the step ticks when both are merged. */
function LinkPrs({
  step,
  busy,
  onLink,
}: {
  step: SpecStep;
  busy: boolean;
  onLink: (links: { main: string; staging: string }) => Promise<boolean>;
}) {
  const [show, setShow] = useState(false);
  const [main, setMain] = useState(step.pr_links?.main ?? "");
  const [staging, setStaging] = useState(step.pr_links?.staging ?? "");
  if (!show) {
    return (
      <Button size="xs" variant="ghost" className="w-fit" onClick={() => setShow(true)}>
        <GitPullRequestIcon className="size-3" />
        {step.pr_links ? "Change the linked PRs" : "Link PRs opened by hand"}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={main}
        placeholder="The main pull request link"
        aria-label="Main pull request"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setMain(e.target.value)}
      />
      <Input
        value={staging}
        placeholder="Its staging pair link"
        aria-label="Staging pull request"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setStaging(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setShow(false)}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={busy || !main.trim() || !staging.trim()}
          onClick={() =>
            void onLink({ main: main.trim(), staging: staging.trim() }).then(
              (ok) => ok && setShow(false),
            )
          }
        >
          Link both
        </Button>
      </div>
    </div>
  );
}

function StepRow({
  step,
  stepById,
  repoName,
  busy,
  canBuild,
  onAction,
  onWatch,
  onEdit,
  onLink,
  allRequirements,
}: {
  step: SpecStep;
  stepById: Map<string, SpecStep>;
  repoName: (path: string) => string;
  busy: boolean;
  canBuild: boolean;
  onAction: (action: "build" | "approve" | "discard" | "pr-anyway" | "retry") => Promise<boolean>;
  onWatch: (threadId: string) => void;
  onEdit: (patch: {
    summary?: string;
    requirements?: ReadonlyArray<string>;
    title?: string;
  }) => Promise<boolean>;
  onLink: (links: { main: string; staging: string }) => Promise<boolean>;
  allRequirements: ReadonlyArray<SpecRequirement>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const state = step.state ?? "todo";
  const waiting = step.depends_on.filter(
    (d) => !["merged", "pr_open", "checks_passed"].includes(stepById.get(d)?.state ?? "todo"),
  );
  const ev = step.evidence ?? null;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <StepIcon state={state} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{step.id}</span>
            <span
              className={cn(
                "text-sm font-medium",
                state === "merged" &&
                  "text-muted-foreground line-through decoration-muted-foreground/50",
              )}
            >
              {step.title}
            </span>
            <Badge variant="secondary" size="sm">
              {step.size}
            </Badge>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {step.requirements.map((r) => (
              <Badge key={r} variant="secondary" size="sm" className="font-mono">
                {r}
              </Badge>
            ))}
            <span>· {repoName(step.repo)}</span>
            {step.depends_on.length ? <span>· after {step.depends_on.join(", ")}</span> : null}
          </span>
        </button>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge
            variant={
              state === "merged"
                ? "success"
                : ["spec_failed", "needs_you", "pr_closed"].includes(state)
                  ? "error"
                  : state === "todo"
                    ? "secondary"
                    : "info"
            }
            size="sm"
          >
            {STEP_LABEL[state] ?? state}
          </Badge>
          <span className="flex gap-1.5">
            {["todo", "spec_failed", "pr_closed"].includes(state) ? (
              <Button
                size="xs"
                disabled={busy || !canBuild || waiting.length > 0}
                title={
                  !canBuild
                    ? "Approve the requirements and the design first"
                    : waiting.length
                      ? `Waits for ${waiting.join(", ")}`
                      : undefined
                }
                onClick={() => void onAction("build")}
              >
                {state === "todo" ? "Build this step" : "Try again"}
              </Button>
            ) : null}
            {state === "spec_to_approve" ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onAction("discard")}
                >
                  Discard
                </Button>
                <Button size="xs" disabled={busy} onClick={() => void onAction("approve")}>
                  Approve and build
                </Button>
              </>
            ) : null}
            {state === "needs_you" ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onAction("discard")}
                >
                  Discard
                </Button>
                {ev && !ev.pr_url ? (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      title="After a fix on Chief's side (a check that could not run): the same tree is checked again first; finished work goes straight to review and the pull requests."
                      onClick={() => void onAction("retry")}
                    >
                      Run the checks again
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      title="Both pull requests, main and its staging pair, as drafts with the reasons in their bodies. Nothing is merged."
                      onClick={() => void onAction("pr-anyway")}
                    >
                      Open both PRs anyway
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {ev?.thread_id ? (
              <Button size="xs" variant="outline" onClick={() => onWatch(ev.thread_id!)}>
                Watch
              </Button>
            ) : null}
            {(ev?.pr_url ?? step.pr_links?.main) ? (
              <Button
                size="xs"
                variant="outline"
                render={
                  <a href={ev?.pr_url ?? step.pr_links!.main} target="_blank" rel="noreferrer" />
                }
              >
                main PR
                <ExternalLinkIcon className="size-3" />
              </Button>
            ) : null}
            {(ev?.staging_pr_url ?? step.pr_links?.staging) ? (
              <Button
                size="xs"
                variant="outline"
                render={
                  <a
                    href={ev?.staging_pr_url ?? step.pr_links!.staging}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                staging PR
                <ExternalLinkIcon className="size-3" />
              </Button>
            ) : ev?.pr_url ? (
              <Badge variant="warning" size="sm" title={ev.pair_error ?? undefined}>
                no staging pair
              </Badge>
            ) : null}
          </span>
        </span>
      </div>
      {open || state === "spec_to_approve" || state === "needs_you" ? (
        <div className="ml-7 flex flex-col gap-2 rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
          {editing ? (
            <StepEditor
              step={step}
              requirements={allRequirements}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(patch) => onEdit(patch).then((ok) => ok && setEditing(false))}
            />
          ) : (
            <>
              {step.summary ? <p>{step.summary}</p> : null}
              {!step.chief_task_id || state === "todo" || state === "spec_failed" ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon className="size-3" />
                  Edit the step
                </Button>
              ) : null}
            </>
          )}
          {ev?.pair_error && !ev.staging_pr_url ? (
            <p className="text-xs text-warning">Staging pair: {ev.pair_error}</p>
          ) : null}
          {state === "needs_you" || state === "todo" || state === "pr_open" ? (
            <LinkPrs step={step} busy={busy} onLink={onLink} />
          ) : null}
          {step.acceptance.length ? (
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Acceptance checks
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {step.acceptance.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {ev ? (
            <p className="text-xs text-muted-foreground">
              Evidence: build {ev.task_status.replace("_", " ")}
              {ev.acceptance_cases ? ` · ${ev.acceptance_cases} acceptance cases` : ""}
              {ev.attempts ? ` · ${ev.attempts} attempts` : ""}
              {ev.review ? ` · review: ${ev.review}` : ""}
              {step.merged_at ? ` · merged ${ago(step.merged_at)}` : ""}
            </p>
          ) : null}
          {state === "spec_to_approve" && ev?.spec ? (
            <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 p-3 whitespace-pre-wrap">
              {ev.spec}
            </div>
          ) : null}
          {state === "needs_you" && ev?.reasons ? (
            <div className="max-h-48 overflow-y-auto text-xs whitespace-pre-wrap">{ev.reasons}</div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
