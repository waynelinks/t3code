import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useEnvironmentHttpBaseUrl, useEnvironments } from "../../state/environments";
import { inboxBaseFor, inboxRequest, refreshInbox, type InboxConfig } from "../../state/inbox";
import { useOrganisationLabel } from "../../state/organisation";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Chief: connect each organisation's ClickUp to its inbox. The token goes to the inbox service, never to T3. */
export function ChiefInboxSettings() {
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
    <SettingsSection id="chief-inbox" title="Inbox">
      {targets.map((target) => (
        <ClickUpRows
          key={target.environmentId}
          environmentId={target.environmentId}
          label={target.label}
        />
      ))}
    </SettingsSection>
  );
}

function ClickUpRows({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const base = inboxBaseFor(useEnvironmentHttpBaseUrl(environmentId));
  const [config, setConfig] = useState<InboxConfig | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      setConfig(await inboxRequest<InboxConfig>(base, "/config"));
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const call = async (path: string, method: string, body?: unknown) => {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      setConfig(
        await inboxRequest<InboxConfig>(base, path, {
          method,
          ...(body !== undefined ? { body } : {}),
        }),
      );
      setToken("");
      setReplacing(false);
      void refreshInbox(environmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const connected = Boolean(config?.configured && config.user);
  const status = unreachable
    ? `The inbox service is not answering${base ? ` at ${base}` : ""}.`
    : error
      ? error
      : config === null
        ? "Checking"
        : connected
          ? `Connected as ${config.user!.username}`
          : config.configured
            ? (config.last_error ?? "Connecting")
            : "Not connected";
  const showTokenInput = !connected || replacing;

  return (
    <>
      <SettingsRow
        title={`ClickUp for ${label}`}
        description={
          showTokenInput ? (
            <>
              Paste a personal API token: your avatar in ClickUp, Settings, Apps.{" "}
              <InlineButton
                render={
                  <a
                    href="https://app.clickup.com/settings/apps"
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                }
              >
                Open ClickUp
                <ExternalLinkIcon aria-hidden className="size-3" />
              </InlineButton>
            </>
          ) : (
            "Direct messages, messages that tag you and tasks assigned to you land in the Inbox with a drafted reply. Nothing is sent until you press Send."
          )
        }
        status={
          <span
            className={error || (config?.last_error && !connected) ? "text-destructive" : undefined}
          >
            {status}
          </span>
        }
        control={
          unreachable ? null : showTokenInput ? (
            <form
              className="flex w-full items-center gap-2 sm:w-auto"
              onSubmit={(event) => {
                event.preventDefault();
                if (token.trim()) void call("/config", "PUT", { clickup_token: token.trim() });
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                size="sm"
                className="w-full sm:w-56"
                aria-label={`ClickUp API token for ${label}`}
                placeholder="pk_..."
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={saving || token.trim().length === 0}>
                {replacing ? "Replace" : "Connect"}
              </Button>
              {replacing ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              ) : null}
            </form>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setReplacing(true)}
              >
                Replace token
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void call("/config/clickup", "DELETE")}
              >
                Disconnect
              </Button>
            </>
          )
        }
      />
      {connected && config ? (
        <>
          <SettingsRow
            title="Workspace"
            description="The ClickUp workspace this inbox reads."
            control={
              <Select
                value={config.team_id ?? ""}
                disabled={saving || config.workspaces.length < 2}
                onValueChange={(value) => {
                  if (typeof value === "string" && value && value !== config.team_id)
                    void call("/config", "PUT", { clickup_team_id: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="ClickUp workspace">
                  <SelectValue>
                    {config.workspaces.find((w) => w.id === config.team_id)?.name ??
                      config.team_id ??
                      "Choose a workspace"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {config.workspaces.map((w) => (
                    <SelectItem hideIndicator key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <WatchedChannelsRow base={base!} watched={config.watch_channels} onChange={load} />
          <PriorityPeopleRow
            base={base!}
            onChange={async () => {
              await load();
              void refreshInbox(environmentId);
            }}
          />
          <SettingsRow
            title="Done also resolves"
            description="When you press Done on a comment assigned to you, also mark it resolved in ClickUp. Colleagues see it resolved."
            control={
              <Switch
                checked={config.resolve_on_done === true}
                disabled={saving}
                aria-label="Done also resolves assigned comments in ClickUp"
                onCheckedChange={(checked) =>
                  void call("/config/inbox", "PUT", { resolve_on_done: Boolean(checked) })
                }
              />
            }
          />
        </>
      ) : null}
    </>
  );
}

function WatchedChannelsRow({
  base,
  watched,
  onChange,
}: {
  base: string;
  watched: ReadonlyArray<string>;
  onChange: () => Promise<void>;
}) {
  const [channels, setChannels] = useState<ReadonlyArray<{ id: string; name: string }> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<string>>(watched);
  useEffect(() => setSelected(watched), [watched]);
  const loadChannels = useCallback(async () => {
    try {
      const data = await inboxRequest<{ channels: { id: string; name: string }[] }>(
        base,
        "/config/channels",
      );
      setChannels(data.channels);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base]);
  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(next);
    try {
      await inboxRequest(base, "/config/channels", { method: "PUT", body: { watch: next } });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const names = (channels ?? []).filter((c) => selected.includes(c.id)).map((c) => `#${c.name}`);
  return (
    <SettingsRow
      title="Channels"
      description="Direct messages and messages that tag you arrive from every channel. Choose channels where every message should arrive too."
      status={
        error ? (
          <span className="text-destructive">{error}</span>
        ) : selected.length === 0 ? (
          "Only messages that tag you"
        ) : names.length > 0 ? (
          `Every message from ${names.join(", ")}`
        ) : (
          `Every message from ${selected.length} ${selected.length === 1 ? "channel" : "channels"}`
        )
      }
      control={
        <Menu onOpenChange={(open) => (open ? void loadChannels() : undefined)}>
          <MenuTrigger render={<Button size="sm" variant="outline" className="w-full sm:w-auto" />}>
            Choose channels
          </MenuTrigger>
          <MenuPopup align="end" className="max-h-80">
            {channels === null ? (
              <MenuItem disabled>Loading the channels you follow</MenuItem>
            ) : channels.length === 0 ? (
              <MenuItem disabled>You follow no channels</MenuItem>
            ) : (
              channels.map((c) => (
                <MenuCheckboxItem
                  key={c.id}
                  checked={selected.includes(c.id)}
                  onCheckedChange={(on) => void toggle(c.id, on)}
                >
                  #{c.name}
                </MenuCheckboxItem>
              ))
            )}
          </MenuPopup>
        </Menu>
      }
    />
  );
}

/** People whose messages go on top of the Inbox, tags and direct messages first. */
function PriorityPeopleRow({ base, onChange }: { base: string; onChange: () => Promise<void> }) {
  const [people, setPeople] = useState<ReadonlyArray<{
    id: string;
    name: string;
    picture: string | null;
  }> | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await inboxRequest<{
        people: { id: string; name: string; picture: string | null }[];
        priority: string[];
      }>(base, "/config/people");
      setPeople(data.people);
      setSelected(data.priority);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(next);
    try {
      await inboxRequest(base, "/config/priority", { method: "PUT", body: { ids: next } });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const names = (people ?? []).filter((p) => selected.includes(p.id)).map((p) => p.name);
  return (
    <SettingsRow
      title="Priority people"
      description="Their messages stay on top of the Inbox, the ones where they tag you or message you directly first."
      status={
        error ? (
          <span className="text-destructive">{error}</span>
        ) : selected.length === 0 ? (
          "Nobody yet"
        ) : names.length > 0 ? (
          names.join(", ")
        ) : (
          `${selected.length} ${selected.length === 1 ? "person" : "people"}`
        )
      }
      control={
        <Menu onOpenChange={(open) => (open ? void load() : undefined)}>
          <MenuTrigger render={<Button size="sm" variant="outline" className="w-full sm:w-auto" />}>
            Choose people
          </MenuTrigger>
          <MenuPopup align="end" className="max-h-80">
            {people === null ? (
              <MenuItem disabled>Loading the workspace's people</MenuItem>
            ) : people.length === 0 ? (
              <MenuItem disabled>Nobody else in this workspace</MenuItem>
            ) : (
              people.map((p) => (
                <MenuCheckboxItem
                  key={p.id}
                  checked={selected.includes(p.id)}
                  onCheckedChange={(on) => void toggle(p.id, on)}
                >
                  {p.name}
                </MenuCheckboxItem>
              ))
            )}
          </MenuPopup>
        </Menu>
      }
    />
  );
}
