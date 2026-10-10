import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { useEnvironmentHttpBaseUrl, useEnvironments } from "../../state/environments";
import { inboxBaseFor, inboxRequest } from "../../state/inbox";
import { useOrganisationLabel } from "../../state/organisation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type EngineName = "claude" | "opencode" | "cline";
interface EngineBlock {
  readonly model?: string;
  readonly ladder?: ReadonlyArray<string>;
  readonly models?: Readonly<Record<string, string>>;
  readonly limit?: { readonly until_text: string; readonly message: string } | null;
}
interface EngineView {
  readonly primary: EngineName;
  readonly fallback: ReadonlyArray<EngineName>;
  readonly active: EngineName;
  readonly engines: Readonly<Record<EngineName, EngineBlock>>;
  readonly models: { readonly opencode: ReadonlyArray<string> };
}
const LABEL: Record<EngineName, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  cline: "Cline",
};
const ALL: ReadonlyArray<EngineName> = ["claude", "opencode", "cline"];

/** Chief: which engine runs each organisation's builds, and what it falls back to when one hits its usage limit. */
export function ChiefEnginesSettings() {
  const scope = useOptionalSettingsScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const selected = scope?.environment ?? null;
  const targets = selected
    ? [
        {
          environmentId: selected.environmentId,
          label: organisationLabel(selected.environmentId, selected.label),
        },
      ]
    : environments.map((e) => ({
        environmentId: e.environmentId,
        label: organisationLabel(e.environmentId, e.label),
      }));
  if (targets.length === 0) return null;
  return (
    <SettingsSection id="chief-engines" title="Engines">
      {targets.map((t) => (
        <EngineRows key={t.environmentId} environmentId={t.environmentId} label={t.label} />
      ))}
    </SettingsSection>
  );
}

function EngineRows({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const base = inboxBaseFor(useEnvironmentHttpBaseUrl(environmentId));
  const [view, setView] = useState<EngineView | null>(null);
  const [primary, setPrimary] = useState<EngineName>("claude");
  const [fallback, setFallback] = useState<EngineName[]>([]);
  const [ocModel, setOcModel] = useState("");
  const [ocLadder, setOcLadder] = useState("");
  const [ocReviewer, setOcReviewer] = useState("");
  const [clineModel, setClineModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const fill = (v: EngineView) => {
    setView(v);
    setPrimary(v.primary);
    setFallback([...v.fallback]);
    setOcModel(v.engines.opencode.model ?? "");
    setOcLadder((v.engines.opencode.ladder ?? []).join(", "));
    setOcReviewer(v.engines.opencode.models?.reviewer ?? "");
    setClineModel(v.engines.cline.model ?? "");
  };
  const load = useCallback(async () => {
    if (!base) return;
    try {
      fill(await inboxRequest<EngineView>(base, "/config/engine"));
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const send = async (path: string, method: string, body: unknown) => {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      fill(await inboxRequest<EngineView>(base, path, { method, body }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const save = () =>
    void send("/config/engine", "PUT", {
      primary,
      fallback,
      opencode: {
        model: ocModel.trim(),
        ladder: ocLadder
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        models: ocReviewer.trim() ? { reviewer: ocReviewer.trim() } : {},
      },
      cline: { model: clineModel.trim() },
    });

  if (unreachable || !view) {
    return (
      <SettingsRow
        title={`Engines for ${label}`}
        description="Which coding agent runs Chief's builds, and what it falls back to."
        status={unreachable ? "The company service is not answering." : "Checking"}
      />
    );
  }
  const chain = [primary, ...fallback];
  const unused = ALL.filter((e) => !chain.includes(e));
  const move = (i: number, d: -1 | 1) => {
    const next = [...fallback];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setFallback(next);
  };
  const limits = ALL.filter((e) => view.engines[e].limit);
  const usesOpencode = chain.includes("opencode");
  const usesCline = chain.includes("cline");

  return (
    <>
      <datalist id={`oc-models-${environmentId}`}>
        {view.models.opencode.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <SettingsRow
        title={`Builds for ${label} run on`}
        description={`Now: ${LABEL[view.active]}. The spec-writer, the implementer, the reviewer, the staging pair and the CI rounds.`}
        status={error ? <span className="text-destructive">{error}</span> : undefined}
        control={
          <Select
            value={primary}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              setPrimary(v as EngineName);
              setFallback(fallback.filter((e) => e !== v));
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Primary engine">
              <SelectValue>{LABEL[primary]}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {ALL.map((e) => (
                <SelectItem hideIndicator key={e} value={e}>
                  {LABEL[e]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="When it hits its usage limit, fall back to"
        description="In this order. Chief switches by itself, carries the running step on, and goes back when the limit resets."
        control={
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            {fallback.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No fallback: work waits for the limit.
              </span>
            ) : null}
            {fallback.map((e, i) => (
              <div key={e} className="flex items-center gap-1">
                <span className="flex-1 text-sm">
                  {i + 1}. {LABEL[e]}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Earlier"
                  onClick={() => move(i, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Later"
                  onClick={() => move(i, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Remove"
                  onClick={() => setFallback(fallback.filter((x) => x !== e))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            {unused.length ? (
              <div className="flex flex-wrap gap-1">
                {unused.map((e) => (
                  <Button
                    key={e}
                    size="xs"
                    variant="outline"
                    onClick={() => setFallback([...fallback, e])}
                  >
                    Add {LABEL[e]}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        }
      />
      {usesOpencode ? (
        <SettingsRow
          title="OpenCode models"
          description="The model for every role; the implementer's rungs, weaker first, comma-separated; the reviewer's model. `opencode models` lists them."
          control={
            <div className="flex w-full flex-col gap-1.5 sm:w-72">
              <Input
                list={`oc-models-${environmentId}`}
                value={ocModel}
                placeholder="opencode/big-pickle"
                aria-label="OpenCode model"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setOcModel(e.target.value)}
              />
              <Input
                value={ocLadder}
                placeholder="Rungs: model, stronger model"
                aria-label="OpenCode implementer rungs"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setOcLadder(e.target.value)}
              />
              <Input
                list={`oc-models-${environmentId}`}
                value={ocReviewer}
                placeholder="Reviewer (optional)"
                aria-label="OpenCode reviewer model"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setOcReviewer(e.target.value)}
              />
            </div>
          }
        />
      ) : null}
      {usesCline ? (
        <SettingsRow
          title="Cline model"
          description="The model on your Cline account, for example cline:qwen/qwen3.8-27b:free."
          control={
            <Input
              className="w-full sm:w-72"
              value={clineModel}
              placeholder="cline:provider/model"
              aria-label="Cline model"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setClineModel(e.target.value)}
            />
          }
        />
      ) : null}
      {limits.map((e) => (
        <SettingsRow
          key={e}
          title={`${LABEL[e]} is at its limit`}
          description={`Until ${view.engines[e].limit!.until_text}. ${view.engines[e].limit!.message.slice(0, 140)}`}
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={saving}
              onClick={() => void send("/config/engine/clear", "POST", { engine: e })}
            >
              It works again
            </Button>
          }
        />
      ))}
      <SettingsRow
        title=""
        control={
          <Button size="sm" disabled={saving} onClick={save}>
            Save engines
          </Button>
        }
      />
    </>
  );
}
