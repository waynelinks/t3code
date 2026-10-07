import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

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

function readScope(): OrganisationScope {
  const value = storage()?.getItem(SCOPE_KEY);
  return value && value !== "all" ? (value as EnvironmentId) : "all";
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

export function useOrganisationScope(): OrganisationScope {
  return useSyncExternalStore(subscribe, readScope, () => "all");
}

export function useOrganisationNames(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, readNames, () => EMPTY_NAMES);
}
