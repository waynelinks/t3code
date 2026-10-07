import { ArrowLeftIcon, ChartNoAxesColumnIcon, ChevronsUpDownIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import {
  type OrganisationScope,
  renameOrganisation,
  setOrganisationScope,
  useOrganisationNames,
  useOrganisationScope,
} from "../../state/organisation";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { T3Wordmark } from "../T3Wordmark";
import { APP_BASE_NAME, APP_IS_REBRANDED } from "../../branding";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    // The titlebar row, not a padded SidebarHeader: it aligns to the window controls.
    <div
      className={cn(
        "@container/sidebar-header relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 px-3 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        // Over the stage artwork: the media viewer's control-on-imagery treatment.
        variant={backdropVariant ? "media-navigation" : "ghost"}
        className="relative top-auto z-10 translate-y-0 md:hidden"
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 hidden @[15rem]/sidebar-header:inline-flex"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </div>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <div className="relative z-10 ml-[var(--workspace-titlebar-content-left)] flex min-w-0 items-center gap-1.5">
      <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 hidden h-7 w-fit shrink-0 items-center rounded-md outline-hidden ring-ring focus-visible:ring-2 md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      {/* Center the visible capitals, without the font's ascender/descender space. */}
      <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
        {APP_IS_REBRANDED ? (
          <span className="shrink-0 whitespace-nowrap [text-box:trim-both_cap_alphabetic]">{APP_BASE_NAME}</span>
        ) : null}
        {APP_IS_REBRANDED ? null : <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />}
        {APP_IS_REBRANDED ? null : (
          <span
            className={cn(
              "truncate [text-box:trim-both_cap_alphabetic]",
              onBackdrop ? "text-white/70" : "text-muted-foreground",
            )}
          >
            Code
          </span>
        )}
      </span>
      </Link>
      <OrganisationSwitcher onBackdrop={onBackdrop} />
    </div>
  );
}

/**
 * Chief: the organisation at the top. One connected environment per company, so picking one scopes
 * projects, threads and new threads to that company; "All organisations" is the merged view.
 */
function OrganisationSwitcher({ onBackdrop }: { onBackdrop: boolean }) {
  const { environments } = useEnvironments();
  const navigate = useNavigate();
  const scope = useOrganisationScope();
  const names = useOrganisationNames();
  const selected = scope === "all" ? null : (environments.find((e) => e.environmentId === scope) ?? null);
  const known = scope === "all" || selected !== null;
  useEffect(() => {
    if (!known && environments.length > 0) setOrganisationScope("all");
  }, [known, environments.length]);
  if (environments.length < 2) return null;
  const nameOf = (environmentId: string, fallback: string) => names[environmentId] ?? fallback;
  const current = selected ? nameOf(selected.environmentId, selected.label) : "All organisations";
  return (
    <Menu>
      <MenuTrigger
        aria-label="Switch organisation"
        className={cn(
          "inline-flex h-7 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-sm font-medium tracking-tight outline-hidden hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        <span className="truncate">{current}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>Organisation</MenuGroupLabel>
          <MenuRadioGroup
            value={known ? scope : "all"}
            onValueChange={(value) => {
              setOrganisationScope(value as OrganisationScope);
              // the open draft may belong to another organisation: start again inside this one
              void navigate({ to: "/" });
            }}
          >
            {environments.map((environment) => (
              <MenuRadioItem key={environment.environmentId} value={environment.environmentId} closeOnClick>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{nameOf(environment.environmentId, environment.label)}</span>
                  {environment.displayUrl ? (
                    <span className="truncate text-xs text-muted-foreground">{environment.displayUrl}</span>
                  ) : null}
                </span>
              </MenuRadioItem>
            ))}
            <MenuRadioItem value="all" closeOnClick>
              All organisations
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          disabled={selected === null}
          onClick={() => {
            if (selected === null) return;
            const next = window.prompt(
              `Name for this organisation (${selected.label})`,
              nameOf(selected.environmentId, selected.label),
            );
            if (next !== null) renameOrganisation(selected.environmentId, next);
          }}
        >
          Rename this organisation
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    void navigateToMainApp();
  }, [closeMobileSidebar, navigateToMainApp]);

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull Requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarThreadUndoNotice />
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
