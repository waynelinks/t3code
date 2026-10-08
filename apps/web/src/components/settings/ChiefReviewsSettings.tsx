import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { useEnvironmentHttpBaseUrl, useEnvironments } from "../../state/environments";
import { inboxBaseFor, inboxRequest, refreshInbox } from "../../state/inbox";
import { useOrganisationLabel } from "../../state/organisation";
import type { ReleaseBoard, ReleaseConfig } from "../../state/reviews";
import { ago } from "../inbox/shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Chief: PR reviews from each organisation's Release Request channel (the company service's release.ts). */
export function ChiefReviewsSettings() {
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
    <SettingsSection id="chief-pr-reviews" title="PR reviews">
      {targets.map((t) => (
        <ReviewRows key={t.environmentId} environmentId={t.environmentId} label={t.label} />
      ))}
    </SettingsSection>
  );
}

const agoMs = (ms: number | null | undefined) => (ms ? ago(new Date(ms).toISOString()) : "");

function ReviewRows({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const base = inboxBaseFor(useEnvironmentHttpBaseUrl(environmentId));
  const [board, setBoard] = useState<ReleaseBoard | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [channels, setChannels] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [kit, setKit] = useState("");
  const [merger, setMerger] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const b = await inboxRequest<ReleaseBoard>(base, "/release");
      setBoard(b);
      setKit(b.config.kit_source);
      setMerger(b.config.merger);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
    if (base)
      void inboxRequest<{ channels: { id: string; name: string }[] }>(base, "/config/channels")
        .then((d) => setChannels(d.channels))
        .catch(() => setChannels([]));
  }, [load, base]);
  // while Chief's Chrome is open for the login, look again until it closes
  useEffect(() => {
    if (!board?.login.busy) return;
    const t = setInterval(() => void load(), 4_000);
    return () => clearInterval(t);
  }, [board?.login.busy, load]);

  const call = async (path: string, method: string, body?: unknown) => {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      const b = await inboxRequest<ReleaseBoard>(
        base,
        path,
        body === undefined ? { method } : { method, body },
      );
      setBoard(b);
      setKit(b.config.kit_source);
      setMerger(b.config.merger);
      void refreshInbox(environmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const save = (changes: Partial<ReleaseConfig>) => void call("/release/config", "PUT", changes);

  if (unreachable || !board) {
    return (
      <SettingsRow
        title={`PR reviews for ${label}`}
        description="Pull requests people ask you to review in a ClickUp channel."
        status={
          unreachable
            ? `The company service is not answering${base ? ` at ${base}` : ""}.`
            : "Checking"
        }
      />
    );
  }
  const cfg = board.config;
  const ready = Boolean(cfg.channel && cfg.kit_source);
  const channelName = channels.find((c) => c.id === cfg.channel)?.name;
  const login = board.login;

  return (
    <>
      <SettingsRow
        title={`Release Request channel for ${label}`}
        description="The ClickUp channel where people ask you to review pull requests. Chief reads only the threads that moved."
        status={error ? <span className="text-destructive">{error}</span> : undefined}
        control={
          <Select
            value={cfg.channel || "__none"}
            onValueChange={(v) => typeof v === "string" && v !== "__none" && save({ channel: v })}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label="Release Request channel"
            >
              <SelectValue>{channelName ?? (cfg.channel || "Choose a channel")}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {channels.map((c) => (
                <SelectItem hideIndicator key={c.id} value={c.id}>
                  {c.name || c.id}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Review skills folder"
        description="The company's release and review skills, agents and scripts. Chief keeps its own copy and refreshes it every hour."
        status={
          board.kit.missing && board.kit.missing.length > 0 ? (
            <span className="text-destructive">Missing: {board.kit.missing.join(", ")}</span>
          ) : board.kit.at ? (
            `Copied ${agoMs(board.kit.at)}`
          ) : undefined
        }
        control={
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              save({ kit_source: kit });
            }}
          >
            <Input
              className="w-full sm:w-72"
              value={kit}
              placeholder="/home/wayne/ai-employees/<company>"
              aria-label="Review skills folder"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setKit(e.target.value)}
            />
            {kit !== cfg.kit_source ? (
              <Button size="sm" type="submit" disabled={saving}>
                Save
              </Button>
            ) : null}
          </form>
        }
      />
      <SettingsRow
        title="When everything is approved, cc"
        description="The person who merges, mentioned on the reply when every pull request is approved. Empty: no cc line."
        control={
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              save({ merger });
            }}
          >
            <Input
              className="w-full sm:w-56"
              value={merger}
              aria-label="cc on approved replies"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMerger(e.target.value)}
            />
            {merger !== cfg.merger ? (
              <Button size="sm" type="submit" disabled={saving}>
                Save
              </Button>
            ) : null}
          </form>
        }
      />
      <SettingsRow
        title="Check the channel"
        description={`Every ${cfg.interval_min} minutes, read the threads that moved and fill the PR reviews board.`}
        control={
          <Switch
            checked={cfg.enabled}
            disabled={saving || !ready}
            aria-label="Check the channel"
            onCheckedChange={(v) => save({ enabled: Boolean(v) })}
          />
        }
      />
      <SettingsRow
        title="Review requests"
        description="Each request that needs you gets a review thread running the company's review protocol."
        control={
          <Switch
            checked={cfg.review}
            disabled={saving || !ready}
            aria-label="Review requests"
            onCheckedChange={(v) =>
              save(v ? { review: true } : { review: false, post: false, reply: false })
            }
          />
        }
      />
      <SettingsRow
        title="Post verdicts on GitHub"
        description="As the company's GitHub account, only 09:30 to 17:00 Johannesburg. Off: reviews stay drafts on the board."
        control={
          <Switch
            checked={cfg.post}
            disabled={saving || !ready}
            aria-label="Post verdicts on GitHub"
            onCheckedChange={(v) => save(v ? { review: true, post: true } : { post: false })}
          />
        }
      />
      <SettingsRow
        title="Reply in ClickUp"
        description="Typed in the requester's thread by Chief's Chrome, so mentions really notify, then read back. Never posted twice."
        control={
          <Switch
            checked={cfg.reply}
            disabled={saving || !ready}
            aria-label="Reply in ClickUp"
            onCheckedChange={(v) => save({ reply: Boolean(v) })}
          />
        }
      />
      <SettingsRow
        title="Chief's Chrome for ClickUp"
        description="You log in once in a window Chief opens; it closes by itself. Chief never sees the password."
        status={
          login.busy ? (
            "A Chrome window is open: log in to ClickUp there."
          ) : login.logged_in === true ? (
            `Signed in${login.at ? `, checked ${agoMs(login.at)}` : ""}`
          ) : login.logged_in === false ? (
            <span className="text-destructive">
              Not signed in{login.error ? `: ${login.error}` : ""}
            </span>
          ) : (
            "Not checked yet"
          )
        }
        control={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={login.busy || saving}
              onClick={() => void call("/release/login/check", "POST")}
            >
              Check
            </Button>
            <Button
              size="sm"
              disabled={login.busy || saving}
              onClick={() => void call("/release/login", "POST")}
            >
              Log in
            </Button>
          </div>
        }
      />
    </>
  );
}
