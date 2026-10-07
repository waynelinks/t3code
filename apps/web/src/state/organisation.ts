import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";

import { useInboxFeeds } from "./inbox";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";

/**
 * Organisation scope: which connected environment the client shows, or "all".
 * Chief runs one environment per company, so "organisation" and "environment" are the same thing to
 * the person at the keyboard. Remembered per browser profile; the server knows nothing about it.
 */
export type OrganisationScope = EnvironmentId | "all";

const SCOPE_KEY = "chief_organisation_scope";
const NAMES_KEY = "chief_organisation_names";
const EMPTY_NAMES: Readonly<Record<string, string>> = Object.freeze({});

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function emit() {
  for (const listener of listeners) listener();
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered choice, or null when the person has never chosen. */
function readStoredScope(): OrganisationScope | null {
  const value = storage()?.getItem(SCOPE_KEY);
  if (!value) return null;
  return value === "all" ? "all" : (value as EnvironmentId);
}

let namesRaw: string | null | undefined;
let namesCache: Readonly<Record<string, string>> = EMPTY_NAMES;
function readNames(): Readonly<Record<string, string>> {
  const raw = storage()?.getItem(NAMES_KEY) ?? null;
  if (raw === namesRaw) return namesCache;
  namesRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    namesCache =
      parsed && typeof parsed === "object"
        ? Object.freeze(
            Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
          )
        : EMPTY_NAMES;
  } catch {
    namesCache = EMPTY_NAMES;
  }
  return namesCache;
}

export function setOrganisationScope(scope: OrganisationScope): void {
  storage()?.setItem(SCOPE_KEY, scope);
  emit();
}

/** A display name for one environment; an empty name clears it and the connection label shows again. */
export function renameOrganisation(environmentId: EnvironmentId, name: string): void {
  const next: Record<string, string> = { ...readNames() };
  const trimmed = name.trim();
  if (trimmed) next[environmentId] = trimmed;
  else delete next[environmentId];
  storage()?.setItem(NAMES_KEY, JSON.stringify(next));
  emit();
}

export function inOrganisationScope(scope: OrganisationScope, environmentId: EnvironmentId): boolean {
  return scope === "all" || scope === environmentId;
}

/**
 * The organisation in view. Until the person chooses, it is the environment that serves this window
 * (the primary connection): Chief's console is served by the company's own server, so that company
 * is the default. "all" is the merged view.
 */
export function useOrganisationScope(): OrganisationScope {
  const stored = useSyncExternalStore(subscribe, readStoredScope, () => null);
  const primary = useAtomValue(primaryEnvironmentIdAtom);
  return stored ?? primary ?? "all";
}

export function useOrganisationNames(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, readNames, () => EMPTY_NAMES);
}

/**
 * The name shown for an organisation: a name the person set, else the company name its inbox
 * service was started with, else the connection label (usually the machine name).
 */
export function useOrganisationLabel(): (environmentId: string, fallback: string) => string {
  const names = useOrganisationNames();
  const feeds = useInboxFeeds();
  return useCallback(
    (environmentId: string, fallback: string) =>
      names[environmentId] ??
      feeds.find((feed) => feed.environmentId === environmentId)?.companyLabel ??
      fallback,
    [feeds, names],
  );
}
