import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useEnvironmentHttpBaseUrl, useEnvironments } from "../../state/environments";
import { inboxBaseFor, inboxRequest, refreshInbox } from "../../state/inbox";
import { useOrganisationLabel } from "../../state/organisation";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

interface InboxConfig {
  readonly configured: boolean;
  readonly team_id_configured: boolean;
  readonly team_id: string | null;
  readonly user: { readonly id: number; readonly username: string } | null;
  readonly last_error: string | null;
  readonly last_poll_at: string | null;
}

/** Chief: connect each organisation's ClickUp to its inbox. The token goes to the inbox service, never to T3. */
export function ChiefInboxSettings() {
  const scope = useOptionalSettingsScope();
  const { environments } = useEnvironments();
  const organisationLabel = useOrganisationLabel();
  const selected = scope?.environment ?? null;
  const targets = selected
    ? [{ environmentId: selected.environmentId, label: organisationLabel(selected.environmentId, selected.label) }]
    : environments.map((e) => ({ environmentId: e.environmentId, label: organisationLabel(e.environmentId, e.label) }));
  return (
    <SettingsSection id="chief-inbox" title="Inbox">
      {targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">Connect to an environment to set up its inbox.</p>
      ) : (
        targets.map((target) => (
          <ClickUpConnection key={target.environmentId} environmentId={target.environmentId} label={target.label} />
        ))
      )}
    </SettingsSection>
  );
}

function ClickUpConnection({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const base = inboxBaseFor(useEnvironmentHttpBaseUrl(environmentId));
  const [config, setConfig] = useState<InboxConfig | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!base) return;
    try {
      setConfig(await inboxRequest<InboxConfig>(base, "/config"));
      setUnreachable(null);
    } catch (e) {
      setUnreachable(e instanceof Error ? e.message : String(e));
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (body: Record<string, string>) => {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      setConfig(await inboxRequest<InboxConfig>(base, "/config", { method: "PUT", body }));
      setToken("");
      setTeam("");
      void refreshInbox(environmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      setConfig(await inboxRequest<InboxConfig>(base, "/config/clickup", { method: "DELETE" }));
      void refreshInbox(environmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const needsWorkspace = /workspaces/.test(config?.last_error ?? "");
  const status = unreachable
    ? `The inbox service for ${label} is not answering${base ? ` at ${base}` : ""}.`
    : config === null
      ? "Checking"
      : config.configured && config.user
        ? `Connected as ${config.user.username}`
        : config.configured
          ? config.last_error ?? "Connecting"
          : "Not connected";
  const canSave = token.trim().length > 0 || (needsWorkspace && team.trim().length > 0);

  return (
    <SettingsRow
      title={`ClickUp for ${label}`}
      description="Comments that mention you or are assigned to you, and tasks newly assigned to you, land in the Inbox with a drafted reply. Replies are posted as you, only when you send them."
      status={<span className={config?.last_error && !needsWorkspace ? "text-destructive" : undefined}>{status}</span>}
    >
      {unreachable ? null : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave || saving) return;
            const body: Record<string, string> = {};
            if (token.trim()) body.clickup_token = token.trim();
            if (team.trim()) body.clickup_team_id = team.trim();
            void save(body);
          }}
        >
          <fieldset disabled={saving} className="contents">
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Personal API token from ClickUp: your avatar, Settings, Apps, API Token.{" "}
              <InlineButton render={<a href="https://app.clickup.com/settings/apps" target="_blank" rel="noreferrer noopener" />}>
                Open ClickUp apps settings
                <ExternalLinkIcon aria-hidden className="size-3" />
              </InlineButton>
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor={`clickup-token-${environmentId}`}>Personal API token</Label>
              <Input
                id={`clickup-token-${environmentId}`}
                type="password"
                autoComplete="off"
                size="sm"
                placeholder={config?.configured ? "Stored on this machine, enter a new value to replace" : "pk_..."}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            {needsWorkspace || config?.team_id_configured ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`clickup-team-${environmentId}`}>Workspace ID</Label>
                <Input
                  id={`clickup-team-${environmentId}`}
                  type="text"
                  autoComplete="off"
                  size="sm"
                  placeholder={config?.team_id ?? "The id from the message above"}
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                />
              </div>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                The token is kept by the inbox service on this machine, in the company's state directory. T3 never sees it.
              </p>
              <div className="flex shrink-0 gap-2">
                {config?.configured ? (
                  <Button size="xs" variant="outline" disabled={saving} onClick={() => void remove()}>
                    Disconnect
                  </Button>
                ) : null}
                <Button type="submit" size="xs" disabled={!canSave || saving}>
                  {config?.configured ? "Replace" : "Connect"}
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </SettingsRow>
  );
}
