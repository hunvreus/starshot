import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type PaginationState,
  type SortingState
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ArrowUpRight, ChevronDown, CircleAlert, CirclePause, CircleX, Download, Loader2, MoreVertical, Plus, RefreshCw, Search } from "lucide-react";
import {
  createTarget,
  getAuthStatus,
  getRateLimitStatus,
  getRuns,
  getStats,
  getTargets,
  getUsers,
  getViewerProfile,
  getViewerRepos,
  removeTarget,
  searchProfiles,
  searchRepos,
  startSync
} from "./lib/api";
import { authClient } from "./lib/auth-client";
import { StarshotWordmark } from "@/components/starshot-logo";
import { LoginForm } from "@/components/login-form";
import { cn } from "@/lib/utils";
import { userRowFields, type AuthStatus, type GithubRateLimitStatus, type ProfileSearchResult, type RepoSearchResult, type Stats, type SyncMode, type SyncRun, type Target, type UserRow, type UsersPage } from "./lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarInput,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type LoadState = {
  auth: AuthStatus | null;
  rateLimit: GithubRateLimitStatus;
  targets: Target[];
  runs: SyncRun[];
  users: UsersPage;
  stats: Stats | null;
};

type ExportSnapshot = {
  allCount: number;
  filteredCount: number;
  hasFilter: boolean;
  filteredRows: UserRow[];
};

type PickedSource =
  | { kind: "repo_stargazers"; value: string; key: string }
  | { kind: "user_followers"; value: string; key: string };

const emptyState: LoadState = {
  auth: null,
  rateLimit: { remaining: null, resetAt: null, resource: "core", status: "normal", updatedAt: null },
  targets: [],
  runs: [],
  users: { rows: [], total: 0, page: 1, pageSize: 10000, sort: "login", direction: "asc" },
  stats: null
};

const tableFetchLimit = 50000;
type RouteMode = "none" | "push" | "replace";
const lastSourcePathStorageKey = "starshot:last-source-path";
const defaultTableSorting: SortingState = [{ id: "followers", desc: true }];

export function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [targetId, setTargetId] = useState<number | undefined>();
  const [entryFilter, setEntryFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [exportSummary, setExportSummary] = useState({ allCount: 0, filteredCount: 0, hasFilter: false });
  const filteredExportRowsRef = useRef<UserRow[]>([]);
  const loadRequestRef = useRef(0);
  const targetIdRef = useRef<number | undefined>(undefined);

  async function load(nextTargetId?: number | null, routeMode: RouteMode = "none", options: { background?: boolean } = {}) {
    const requestId = ++loadRequestRef.current;
    if (!options.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const auth = await getAuthStatus();
      if (requestId !== loadRequestRef.current) return;
      if (!auth.oauthConfigured || !auth.authenticated) {
        if (options.background) return;
        setState({ auth, rateLimit: emptyState.rateLimit, targets: [], runs: [], users: emptyState.users, stats: null });
        return;
      }

      const [targets, runs] = await Promise.all([getTargets(), getRuns()]);
      if (requestId !== loadRequestRef.current) return;
      const rateLimit = await getRateLimitStatus();
      if (requestId !== loadRequestRef.current) return;
      const routeTarget = targetFromRoute(targets);
      const storedTarget = routeTarget ? undefined : targetFromStoredRoute(targets);
      const resolvedTargetId = nextTargetId === null ? undefined : nextTargetId ?? routeTarget?.id ?? storedTarget?.id ?? targetIdRef.current ?? targets[0]?.id;
      const resolvedTarget = targets.find((target) => target.id === resolvedTargetId);
      const [users, stats] = await Promise.all([
        getUsers({ targetId: resolvedTargetId, active: "active", page: 1, pageSize: tableFetchLimit, sort: "followers", direction: "desc" }),
        getStats(resolvedTargetId)
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (resolvedTarget) rememberSourcePath(resolvedTarget);
      setState({ auth, rateLimit, targets, runs, users, stats });
      if (resolvedTargetId && resolvedTargetId !== targetIdRef.current) {
        targetIdRef.current = resolvedTargetId;
        setTargetId(resolvedTargetId);
      }
      if (routeMode !== "none") setSourceRoute(resolvedTarget, routeMode);
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      if (!options.background) setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!options.background && requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load(undefined, "replace");
  }, []);

  useEffect(() => {
    targetIdRef.current = targetId;
  }, [targetId]);

  useEffect(() => {
    const onPopState = () => void load(undefined, "none");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!loading && state.runs.some((run) => run.status === "queued" || run.status === "running")) {
        void load(targetId, "none", { background: true });
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loading, state.runs, targetId]);

  const selectedTarget = useMemo(() => state.targets.find((target) => target.id === targetId), [state.targets, targetId]);
  const repoTargets = useMemo(() => filterTargets(state.targets, "repo_stargazers", entryFilter), [entryFilter, state.targets]);
  const profileTargets = useMemo(() => filterTargets(state.targets, "user_followers", entryFilter), [entryFilter, state.targets]);
  const runningTargetIds = useMemo(
    () => new Set(state.runs.filter((run) => run.status === "queued" || run.status === "running").map((run) => run.targetId)),
    [state.runs]
  );
  const selectedTargetIsRunning = Boolean(targetId && runningTargetIds.has(targetId));
  const selectedRun = useMemo(
    () => state.runs.find((run) => run.targetId === targetId && (run.status === "queued" || run.status === "running")),
    [state.runs, targetId]
  );
  const selectedLatestCompletedRun = useMemo(
    () => state.runs.find((run) => run.targetId === targetId && (run.status === "success" || run.status === "error")),
    [state.runs, targetId]
  );
  const selectedFailedRun = useMemo(
    () => selectedLatestCompletedRun?.status === "error" ? selectedLatestCompletedRun : undefined,
    [selectedLatestCompletedRun]
  );
  const selectedTargetHasData = (state.stats?.total ?? 0) > 0;
  const auth = state.auth;
  const isRefreshingContent = loading && Boolean(auth?.authenticated && state.targets.length > 0);
  const updateExportSnapshot = useCallback((snapshot: ExportSnapshot) => {
    filteredExportRowsRef.current = snapshot.filteredRows;
    setExportSummary((current) => {
      if (
        current.allCount === snapshot.allCount &&
        current.filteredCount === snapshot.filteredCount &&
        current.hasFilter === snapshot.hasFilter
      ) {
        return current;
      }
      return {
        allCount: snapshot.allCount,
        filteredCount: snapshot.filteredCount,
        hasFilter: snapshot.hasFilter
      };
    });
  }, []);
  async function selectTarget(id: number) {
    targetIdRef.current = id;
    setTargetId(id);
    await load(id, "push");
  }

  async function syncSelected(mode: SyncMode = "smart") {
    if (!targetId) return;
    if (mode === "clear" && selectedTarget) {
      const noun = selectedTarget.kind === "repo_stargazers" ? "stargazers" : "followers";
      if (!window.confirm(`Delete all local ${noun} records for this source? The next update will rebuild them from GitHub.`)) return;
    }
    try {
      await startSync(targetId, mode);
      await load(targetId);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    }
  }

  async function onSourceAdded(target: Target) {
    setSourceDialogOpen(false);
    targetIdRef.current = target.id;
    setTargetId(target.id);
    await load(target.id, "push");
  }

  async function removeSelectedTarget() {
    if (!targetId) return;
    const nextTargets = state.targets.filter((target) => target.id !== targetId);
    const nextTargetId = nextTargets[0]?.id;

    try {
      await removeTarget(targetId);
      setRemoveDialogOpen(false);
      targetIdRef.current = nextTargetId;
      setTargetId(nextTargetId);
      await load(nextTargetId ?? null, "replace");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    }
  }

  if (!auth) {
    return <InitialLoader />;
  }

  if (!auth.oauthConfigured) {
    return (
      <CenteredEmpty
        title="GitHub OAuth is not configured"
        description={
          <>
            Set <EnvVar>GITHUB_CLIENT_ID</EnvVar> and <EnvVar>GITHUB_CLIENT_SECRET</EnvVar> in <EnvVar>.env</EnvVar>, then restart the local app.
          </>
        }
        action={<ReadmeButton />}
      />
    );
  }

  if (!auth.authenticated) {
    return <LoginPage />;
  }

  if (state.targets.length === 0) {
    return (
      <>
        <CenteredEmpty
          title="No sources yet"
          description="Add a repository to track stargazers, or add a GitHub profile to track followers."
          action={
            <Button onClick={() => setSourceDialogOpen(true)}>
              <Plus />
              Add source
            </Button>
          }
        />
        <footer className="fixed inset-x-0 bottom-0 flex h-14 items-center px-4">
          <UserMenu auth={auth} />
        </footer>
        <AddSourceCommandDialog targets={state.targets} open={sourceDialogOpen} onOpenChange={setSourceDialogOpen} onAdded={onSourceAdded} />
      </>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2">
            <AboutStarshot />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
              <SidebarInput
                className="pl-8"
                value={entryFilter}
                onChange={(event) => setEntryFilter(event.target.value)}
                placeholder="Filter sources"
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => setSourceDialogOpen(true)} aria-label="Add source">
              <Plus />
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <EntryGroup
            label="Repositories"
            targets={repoTargets}
            selectedId={targetId}
            runningTargetIds={runningTargetIds}
            onSelect={selectTarget}
          />
          <EntryGroup
            label="Profiles"
            targets={profileTargets}
            selectedId={targetId}
            runningTargetIds={runningTargetIds}
            onSelect={selectTarget}
          />
        </SidebarContent>
        <SidebarFooter className="px-4">
          <UserMenu auth={auth} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {selectedTarget ? <SourceTitle target={selectedTarget} /> : <h1 className="truncate text-base font-medium">Sources</h1>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ButtonGroup>
              <Button variant="outline" onClick={() => void syncSelected("smart")} disabled={!targetId || selectedTargetIsRunning} aria-label="Update">
                {selectedTargetIsRunning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                <span className="hidden sm:inline">Update</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" disabled={!selectedTarget || selectedTargetIsRunning} aria-label="Update options">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="whitespace-nowrap" onSelect={() => void syncSelected("full")}>
                    Force full update
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="whitespace-nowrap" variant="destructive" onSelect={() => void syncSelected("clear")}>
                    Delete local records
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
            <Button variant="outline" onClick={() => setDownloadDialogOpen(true)} disabled={!selectedTargetHasData} aria-label="Download CSV">
              <Download />
              <span className="hidden sm:inline">Download CSV</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={!selectedTarget} aria-label="Source actions">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild disabled={!selectedTarget}>
                  <a href={selectedTarget ? githubTargetUrl(selectedTarget) : "#"} target="_blank" rel="noreferrer">View on GitHub</a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!selectedTarget}
                  onSelect={(event) => {
                    event.preventDefault();
                    setRemoveDialogOpen(true);
                  }}
                >
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <SyncProgressAlerts
          failedRun={selectedFailedRun}
          onRetry={() => void syncSelected("smart")}
          rateLimit={state.rateLimit}
          run={selectedRun}
        />

        <main className="min-w-0">
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {selectedTargetHasData ? (
            <div className={cn("mx-auto w-full max-w-7xl min-w-0 space-y-4 p-4", isRefreshingContent && "refresh-pulse")}>
              {selectedTarget ? <SourceOverview stats={state.stats} target={selectedTarget} /> : null}
              <ProfilesTable
                kind={selectedTarget?.kind}
                showAddedColumn={selectedTarget?.kind === "repo_stargazers"}
                users={state.users}
                onExportSnapshot={updateExportSnapshot}
              />
            </div>
          ) : selectedTargetIsRunning ? (
            <div className="min-h-[calc(100svh-4rem)]" />
          ) : (
            <SourceEmptyState
              hasQuery={false}
              onClearQuery={() => undefined}
              onSync={() => void syncSelected("smart")}
            />
          )}
        </main>
      </SidebarInset>

      <AddSourceCommandDialog targets={state.targets} open={sourceDialogOpen} onOpenChange={setSourceDialogOpen} onAdded={onSourceAdded} />
      <DownloadCsvDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        targetId={targetId}
        summary={exportSummary}
        filteredRowsRef={filteredExportRowsRef}
      />
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove source?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedTarget ? `Remove ${selectedTarget.value} from this account. Cached GitHub data will be kept.` : "Remove this source from this account."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void removeSelectedTarget();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

function githubTargetUrl(target: Target) {
  return target.htmlUrl ?? `https://github.com/${target.value}`;
}

function normalizeExternalUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function githubAvatarUrl(login: string) {
  return `https://github.com/${encodeURIComponent(login)}.png?size=48`;
}

function githubProfileUrl(login: string) {
  return `https://github.com/${encodeURIComponent(login)}`;
}

function sourceAvatarLogin(target: Target) {
  if (target.kind === "repo_stargazers") return target.ownerLogin ?? target.value.split("/")[0] ?? target.value;
  return target.value;
}

function sourceAvatarUrl(target: Target) {
  return githubAvatarUrl(sourceAvatarLogin(target));
}

function sourceFallback(target: Target) {
  return sourceAvatarLogin(target).slice(0, 2).toUpperCase();
}

function sourceAvatarClass(target: Target) {
  return target.kind === "repo_stargazers" ? "rounded-sm after:rounded-sm" : "rounded-full after:rounded-full";
}

function normalizeTwitterUsername(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    .trim() || null;
}

function normalizeWebsite(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const href = normalizeExternalUrl(trimmed);
  const display = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
  return { display, href };
}

function downloadRowsAsCsv(rows: UserRow[], filename: string) {
  const csv = [
    userRowFields.join(","),
    ...rows.map((row) => userRowFields.map((field) => csvValue(row[field])).join(","))
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value).toLowerCase();
}

function CenteredEmpty({
  action,
  description,
  title
}: {
  action?: React.ReactNode;
  description: React.ReactNode;
  title: string;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    </main>
  );
}

function InitialLoader() {
  return (
    <main className="grid min-h-svh place-items-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading...</span>
      </div>
    </main>
  );
}

function SourceEmptyState({
  hasQuery,
  onClearQuery,
  onSync
}: {
  hasQuery: boolean;
  onClearQuery: () => void;
  onSync: () => void;
}) {
  if (hasQuery) {
    return (
      <div className="grid min-h-[calc(100svh-4rem)] place-items-center p-4">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyTitle>No matching profiles</EmptyTitle>
            <EmptyDescription>No current rows match this search.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onClearQuery}>Clear search</Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100svh-4rem)] place-items-center p-4">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>No data yet</EmptyTitle>
          <EmptyDescription>
            Run an update to fetch the current audience.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onSync}>
            <RefreshCw />
            Update
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

function SyncProgressAlerts({
  failedRun,
  onRetry,
  rateLimit,
  run
}: {
  failedRun: SyncRun | undefined;
  onRetry: () => void;
  rateLimit: GithubRateLimitStatus;
  run: SyncRun | undefined;
}) {
  const totalCount = run?.scannedCount ?? 0;
  const showHydration = Boolean(run);
  const showSlowing = Boolean(run) && rateLimit.status === "slowing";
  const showPaused = Boolean(run) && rateLimit.status === "paused";
  const showFailed = Boolean(failedRun) && !run;
  if (!showHydration && !showSlowing && !showPaused && !showFailed) return null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-2 px-4 pt-4">
      {showFailed ? (
        <SyncStatusAlert
          action={
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw />
              Retry update
            </Button>
          }
          icon={<CircleX className="size-4 text-muted-foreground" />}
          variant="destructive"
          title="Update failed"
          description={syncFailureDescription(failedRun)}
        />
      ) : null}
      {showHydration ? (
        <SyncStatusAlert
          icon={<Loader2 className="size-4 animate-spin text-primary" />}
          title={syncProgressTitle(run, totalCount)}
          description={syncProgressDescription(run, totalCount)}
        />
      ) : null}
      {showSlowing ? (
        <SyncStatusAlert
          icon={<CircleAlert className="size-4 text-muted-foreground" />}
          variant="destructive"
          title="Slowing GitHub requests"
          description={rateLimitDescription(rateLimit, "Starshot is reducing request speed to avoid hitting a hard pause.")}
        />
      ) : null}
      {showPaused ? (
        <SyncStatusAlert
          icon={<CirclePause className="size-4 text-muted-foreground" />}
          variant="destructive"
          title="Paused until GitHub rate limit resets"
          description={rateLimitDescription(rateLimit, "GitHub asked us to wait. Updates will resume automatically.")}
        />
      ) : null}
    </div>
  );
}

function syncProgressTitle(run: SyncRun | undefined, totalCount: number) {
  if (!run || run.status === "queued") return "Update queued";
  if (run.mode === "clear") return "Deleting local records";
  if (totalCount <= 0) return "Fetching source members";
  if (run.mode === "profiles") return `Refreshing ${totalCount.toLocaleString()} profiles`;
  return `Reconciling members ${totalCount.toLocaleString()}`;
}

function syncProgressDescription(run: SyncRun | undefined, totalCount: number) {
  if (!run || run.status === "queued") return "Starshot will start this update when a worker is available.";
  if (run.mode === "clear") return "Starshot is deleting the current local source records.";
  if (run.mode === "profiles") return "Starshot is refreshing stale cached GitHub profiles for active members.";
  if (totalCount <= 0) return "Starshot is fetching the source member list from GitHub.";
  return "Starshot is reconciling source membership and marking missing entries inactive when required.";
}

function syncFailureDescription(run: SyncRun | undefined) {
  const details = run?.error ? ` ${run.error}` : "";
  return `The latest update stopped before completion.${details}`;
}

function rateLimitDescription(rateLimit: GithubRateLimitStatus, fallback: string) {
  const parts = [fallback];
  if (rateLimit.remaining != null) parts.push(`${rateLimit.remaining.toLocaleString()} GitHub API requests remaining.`);
  if (rateLimit.resetAt) parts.push(`Resets ${formatRelativeTime(rateLimit.resetAt)}.`);
  return parts.join(" ");
}

function formatRelativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absSeconds < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  return formatter.format(Math.round(minutes / 60), "hour");
}

function SyncStatusAlert({
  action,
  description,
  icon,
  title,
  variant
}: {
  action?: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  title: string;
  variant?: React.ComponentProps<typeof Alert>["variant"];
}) {
  return (
    <Alert variant={variant}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

function DownloadCsvDialog({
  filteredRowsRef,
  onOpenChange,
  open,
  summary,
  targetId
}: {
  filteredRowsRef: React.RefObject<UserRow[]>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  summary: { allCount: number; filteredCount: number; hasFilter: boolean };
  targetId: number | undefined;
}) {
  function downloadAll() {
    if (!targetId) return;
    window.location.assign(`/api/export.csv?targetId=${targetId}&active=active`);
    onOpenChange(false);
  }

  function downloadFiltered() {
    downloadRowsAsCsv(filteredRowsRef.current ?? [], "starshot-filtered.csv");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download CSV</DialogTitle>
          <DialogDescription>
            Choose whether to export every active row or only the rows matching the current table filters.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <Button className="h-28 flex-1 flex-col" variant="outline" onClick={downloadAll} disabled={!targetId}>
            <Download className="size-5" />
            <span>Download all</span>
            <span className="-mt-1 text-xs font-normal text-muted-foreground">{formatCompactCount(summary.allCount)} records</span>
          </Button>
          <Button className="h-28 flex-1 flex-col" variant="outline" onClick={downloadFiltered} disabled={!summary.hasFilter}>
            <Download className="size-5" />
            <span>Download filtered</span>
            <span className="-mt-1 text-xs font-normal text-muted-foreground">{formatCompactCount(summary.filteredCount)} records</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvVar({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>;
}

function ReadmeButton() {
  return (
    <Button variant="outline" asChild>
      <a href="https://github.com/hunvreus/starshot#github-oauth-setup" target="_blank" rel="noreferrer">
        Read setup instructions
        <ArrowUpRight className="opacity-50" />
      </a>
    </Button>
  );
}

function LoginPage() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  async function login() {
    setIsLoggingIn(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/"
      });
    } catch {
      setIsLoggingIn(false);
    }
  }

  return (
    <main className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <LoginForm isLoggingIn={isLoggingIn} onGithubLogin={() => void login()} />
    </main>
  );
}

function AboutStarshot() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <SidebarMenuButton asChild>
          <a href="#about-starshot">
            <StarshotWordmark />
          </a>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="w-[20rem] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StarshotWordmark />
          </DialogTitle>
          <DialogDescription>
            Track public GitHub repositories and profiles.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border">
          <AboutRow label="Version" value={<span className="text-sm">0.1.0</span>} />
          <AboutRow label="GitHub" value={<AboutLink href="https://github.com/hunvreus/starshot">hunvreus/starshot</AboutLink>} />
          <AboutRow label="License" value={<AboutLink href="https://github.com/hunvreus/starshot/blob/main/LICENSE">MIT</AboutLink>} />
          <AboutRow label="Creator" value={<AboutLink href="https://github.com/hunvreus">Ronan Berder</AboutLink>} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AboutRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function AboutLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
      {children}
    </a>
  );
}

function useDebouncedValue(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

function UserMenu({ auth }: { auth: AuthStatus }) {
  const [viewer, setViewer] = useState<ProfileSearchResult | null>(null);
  const fallback = (auth.login ?? "GH").slice(0, 2).toUpperCase();
  const name = auth.login ?? viewer?.login ?? "GitHub";
  const handle = viewer?.login ?? null;

  useEffect(() => {
    getViewerProfile().then(setViewer).catch(() => setViewer(null));
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="size-7 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open account menu">
          <Avatar className="size-7">
            {auth.image ? <AvatarImage src={auth.image} alt="" /> : null}
            <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-7">
              {auth.image ? <AvatarImage src={auth.image} alt="" /> : null}
              <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{name}</div>
              {handle ? <div className="truncate text-xs text-muted-foreground">@{handle}</div> : null}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={!handle}>
          <a href={handle ? `https://github.com/${handle}` : "#"} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void authClient.signOut().then(() => window.location.reload())}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceTitle({ target }: { target: Target }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SourceAvatar target={target} className="size-6" />
      <a className="min-w-0 truncate text-foreground hover:underline" href={githubTargetUrl(target)} target="_blank" rel="noreferrer">
        <h1 className="truncate text-base font-medium">{target.value}</h1>
      </a>
    </div>
  );
}

function SourceAvatar({ className, target }: { className?: string; target: Target }) {
  const shapeClassName = sourceAvatarClass(target);
  return (
    <Avatar className={cn("shrink-0", shapeClassName, className)}>
      <AvatarImage className={shapeClassName} src={sourceAvatarUrl(target)} alt="" />
      <AvatarFallback className={cn("text-[0.625rem]", shapeClassName)}>{sourceFallback(target)}</AvatarFallback>
    </Avatar>
  );
}

function EntryGroup({
  label,
  onSelect,
  runningTargetIds,
  selectedId,
  targets
}: {
  label: string;
  onSelect: (id: number) => Promise<void>;
  runningTargetIds: Set<number>;
  selectedId: number | undefined;
  targets: Target[];
}) {
  if (targets.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {targets.map((target) => {
            const isRunning = runningTargetIds.has(target.id);
            const isSelected = target.id === selectedId;
            const count = sourceSidebarCount(target);

            return (
              <SidebarMenuItem key={target.id}>
                <SidebarMenuButton asChild isActive={isSelected}>
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      void onSelect(target.id);
                    }}
                  >
                    <SourceAvatar target={target} className="size-5" />
                    <span className="min-w-0 flex-1 truncate" title={target.value}>{sourceSidebarLabel(target)}</span>
                    {isRunning ? (
                      <Loader2 className="ml-auto animate-spin" />
                    ) : count ? (
                      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
                    ) : null}
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function sourceSidebarCount(target: Target) {
  const count = target.kind === "repo_stargazers" ? target.stargazersCount : target.followersCount;
  return count == null ? null : formatCompactCount(count);
}

function sourceSidebarLabel(target: Target) {
  if (target.kind !== "repo_stargazers") return target.value;
  return target.value.split("/")[1] ?? target.value;
}

function filterTargets(targets: Target[], kind: Target["kind"], query: string) {
  const normalized = query.trim().toLowerCase();
  return targets
    .filter((target) => target.kind === kind)
    .filter((target) => !normalized || target.label.toLowerCase().includes(normalized) || target.value.toLowerCase().includes(normalized))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function sourcePath(target: Target | undefined) {
  if (!target) return "/";
  if (target.kind === "repo_stargazers") {
    const [owner, repo] = target.value.split("/");
    if (!owner || !repo) return "/";
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }
  return `/profiles/${encodeURIComponent(target.value)}`;
}

function setSourceRoute(target: Target | undefined, mode: RouteMode) {
  const nextPath = sourcePath(target);
  rememberSourcePath(target);
  if (window.location.pathname === nextPath) return;
  if (mode === "push") {
    window.history.pushState(null, "", nextPath);
  } else {
    window.history.replaceState(null, "", nextPath);
  }
}

function rememberSourcePath(target: Target | undefined) {
  try {
    if (target) {
      window.localStorage.setItem(lastSourcePathStorageKey, sourcePath(target));
    } else {
      window.localStorage.removeItem(lastSourcePathStorageKey);
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function targetFromStoredRoute(targets: Target[]) {
  try {
    const storedPath = window.localStorage.getItem(lastSourcePathStorageKey);
    if (!storedPath) return undefined;
    return targetFromPath(targets, storedPath);
  } catch {
    return undefined;
  }
}

function targetFromRoute(targets: Target[]) {
  return targetFromPath(targets, window.location.pathname);
}

function targetFromPath(targets: Target[], path: string) {
  const [kind, first, second] = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (kind === "repos" && first && second) {
    const value = `${first}/${second}`.toLowerCase();
    return targets.find((target) => target.kind === "repo_stargazers" && target.value.toLowerCase() === value);
  }
  if (kind === "profiles" && first) {
    const value = first.toLowerCase();
    return targets.find((target) => target.kind === "user_followers" && target.value.toLowerCase() === value);
  }
  return undefined;
}

function AddSourceCommandDialog({
  onAdded,
  onOpenChange,
  open,
  targets
}: {
  onAdded: (target: Target) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targets: Target[];
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [defaultRepos, setDefaultRepos] = useState<RepoSearchResult[]>([]);
  const [repos, setRepos] = useState<RepoSearchResult[]>([]);
  const [profiles, setProfiles] = useState<ProfileSearchResult[]>([]);
  const [defaultProfiles, setDefaultProfiles] = useState<ProfileSearchResult[]>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const existingSources = useMemo(() => new Set(targets.map((target) => `${target.kind}:${target.value.toLowerCase()}`)), [targets]);
  const showInitialLoading = loading && query.trim().length === 0 && repos.length === 0 && profiles.length === 0;

  useEffect(() => {
    if (!open) {
      defaultRequestRef.current++;
      searchRequestRef.current++;
      setQuery("");
      setDefaultRepos([]);
      setRepos([]);
      setProfiles([]);
      setDefaultProfiles([]);
      setAddingKey(null);
      setError(null);
      return;
    }

    const requestId = ++defaultRequestRef.current;
    setLoading(true);
    setError(null);
    Promise.all([getViewerRepos(), getViewerProfile()])
      .then(([repoRows, profile]) => {
        if (requestId !== defaultRequestRef.current) return;
        setDefaultRepos(repoRows);
        setRepos(repoRows);
        setDefaultProfiles([profile]);
        setProfiles([profile]);
      })
      .catch((defaultError) => {
        if (requestId === defaultRequestRef.current) {
          setError(defaultError instanceof Error ? defaultError.message : String(defaultError));
        }
      })
      .finally(() => {
        if (requestId === defaultRequestRef.current) setLoading(false);
      });
  }, [open]);

  useEffect(() => {
    const normalized = debouncedQuery.trim();
    if (!open) return;
    const requestId = ++searchRequestRef.current;
    if (normalized.length === 0) {
      setRepos(defaultRepos);
      setProfiles(defaultProfiles);
      setError(null);
      if (defaultRepos.length > 0 || defaultProfiles.length > 0) setLoading(false);
      return;
    }
    if (normalized.length < 2) {
      setRepos(defaultRepos);
      setProfiles(defaultProfiles);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([searchRepos(normalized), searchProfiles(normalized)])
      .then(([repoRows, profileRows]) => {
        if (requestId !== searchRequestRef.current) return;
        setRepos(repoRows);
        setProfiles(profileRows);
      })
      .catch((searchError) => {
        if (requestId === searchRequestRef.current) {
          setError(searchError instanceof Error ? searchError.message : String(searchError));
        }
      })
      .finally(() => {
        if (requestId === searchRequestRef.current) setLoading(false);
      });
  }, [debouncedQuery, defaultProfiles, defaultRepos, open]);

  async function addSource(source: PickedSource) {
    if (addingKey) return;
    setAddingKey(source.key);
    try {
      const target = await createTarget(source.kind, source.value);
      await onAdded(target);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
      setAddingKey(null);
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add source"
      description="Search GitHub repositories and profiles."
    >
      <Command shouldFilter={false}>
        <CommandInput
          loading={loading && !showInitialLoading}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
          }}
          placeholder="Search repositories and profiles..."
        />
        <CommandList>
          {error ? <div className="px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {showInitialLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading sources...</span>
            </div>
          ) : null}
          {!loading && repos.length === 0 && profiles.length === 0 ? <CommandEmpty>No sources found.</CommandEmpty> : null}
          {repos.length > 0 ? (
            <CommandGroup heading="Repositories">
              {repos.map((repo) => {
                const source: PickedSource = {
                  kind: "repo_stargazers",
                  value: repo.fullName,
                  key: `repo:${repo.id}`
                };
                const exists = existingSources.has(`${source.kind}:${source.value.toLowerCase()}`);

                return (
                  <CommandItem
                    key={source.key}
                    value={source.key}
                    disabled={exists || addingKey !== null}
                    onSelect={() => void addSource(source)}
                  >
                    <img className="size-6 rounded-md" src={repo.ownerAvatarUrl} alt="" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{repo.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">{repo.description ?? "No description"}</div>
                    </div>
                    <Badge variant="secondary">{repo.stargazersCount.toLocaleString()} stars</Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {profiles.length > 0 ? (
            <CommandGroup heading="Profiles">
              {profiles.map((profile) => {
                const source: PickedSource = {
                  kind: "user_followers",
                  value: profile.login,
                  key: `profile:${profile.id}`
                };
                const exists = existingSources.has(`${source.kind}:${source.value.toLowerCase()}`);

                return (
                  <CommandItem
                    key={source.key}
                    value={source.key}
                    disabled={exists || addingKey !== null}
                    onSelect={() => void addSource(source)}
                  >
                    <img className="size-6 rounded-md" src={profile.avatarUrl} alt="" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{profile.login}</div>
                      <div className="truncate text-xs text-muted-foreground">{profile.bio ?? profile.type}</div>
                    </div>
                    <Badge variant="secondary">{(profile.followersCount ?? 0).toLocaleString()} followers</Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

const growthChartConfig = {
  cumulativeCount: {
    label: "Cumulative",
    color: "var(--primary)"
  },
  newCount: {
    label: "New",
    color: "var(--chart-2)"
  }
} satisfies ChartConfig;

function SourceOverview({ stats, target }: { stats: Stats | null; target: Target }) {
  if (target.kind === "repo_stargazers") {
    return (
      <section className="grid gap-4 lg:grid-cols-4">
        <SourceInfoCard className="lg:col-span-1" target={target} />
        <CountCard className="lg:col-span-1" noun="stargazers" showWeekly stats={stats} />
        <GrowthCard className="lg:col-span-2" stats={stats} />
      </section>
    );
  }

  return (
    <section className="grid gap-4 lg:grid-cols-4">
      <SourceInfoCard className="lg:col-span-2" target={target} />
      <ProfileMetricCard label="Followers" value={target.followersCount} />
      <ProfileMetricCard label="Following" value={target.followingCount} />
    </section>
  );
}

function SourceInfoCard({ className, target }: { className?: string; target: Target }) {
  if (target.kind === "repo_stargazers") {
    return <RepoInfoCard className={className} target={target} />;
  }

  return <ProfileInfoCard className={className} target={target} />;
}

function RepoInfoCard({ className, target }: { className?: string; target: Target }) {
  const owner = target.ownerLogin ?? target.value.split("/")[0] ?? target.value;
  const homepage = normalizeWebsite(target.homepage);

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
        <CardDescription>Repository metadata from GitHub.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm">
          <InfoRow label="Owner">
            <SummaryLink href={`https://github.com/${owner}`}>{owner}</SummaryLink>
          </InfoRow>
          <InfoRow label="Description">
            {target.description ? <span className="truncate" title={target.description}>{target.description}</span> : <EmptyValue />}
          </InfoRow>
          <InfoRow label="Created">
            {target.repoCreatedAt ? <DateCell value={target.repoCreatedAt} /> : <EmptyValue />}
          </InfoRow>
          <InfoRow label="Updated">
            {target.repoUpdatedAt ? <DateCell value={target.repoUpdatedAt} /> : <EmptyValue />}
          </InfoRow>
          <InfoRow label="Homepage">
            {homepage ? <SummaryLink href={homepage.href}>{homepage.display}</SummaryLink> : <EmptyValue />}
          </InfoRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function ProfileInfoCard({ className, target }: { className?: string; target: Target }) {
  const website = normalizeWebsite(target.blog);
  const twitter = normalizeTwitterUsername(target.twitterUsername);
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
        <CardDescription>Profile metadata from GitHub.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 md:gap-x-6">
          <dl className="grid gap-2 text-sm">
            <InfoRow label="Name">
              {target.name ? <span className="truncate">{target.name}</span> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Bio">
              {target.bio ? <span className="truncate" title={target.bio}>{target.bio}</span> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Email">
              {target.email ? <SummaryLink href={`mailto:${target.email}`}>{target.email}</SummaryLink> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Twitter">
              {twitter ? <SummaryLink href={`https://x.com/${twitter}`}>@{twitter}</SummaryLink> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Blog">
              {website ? <SummaryLink href={website.href}>{website.display}</SummaryLink> : <EmptyValue />}
            </InfoRow>
          </dl>
          <dl className="grid gap-2 text-sm">
            <InfoRow label="Location">
              {target.location ? <span className="truncate">{target.location}</span> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Company">
              {target.company ? <GithubLinkedText value={target.company} /> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Created">
              {target.profileCreatedAt ? <DateCell value={target.profileCreatedAt} /> : <EmptyValue />}
            </InfoRow>
            <InfoRow label="Updated">
              {target.profileUpdatedAt ? <DateCell value={target.profileUpdatedAt} /> : <EmptyValue />}
            </InfoRow>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-left">{children}</dd>
    </div>
  );
}

function SummaryLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a className="block truncate text-primary hover:underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function EmptyValue() {
  return <span className="text-muted-foreground">N/A</span>;
}

function ProfileMetricCard({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <Card className="text-foreground">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>Current GitHub profile count.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center text-center">
        {value == null ? (
          <span className="text-muted-foreground">N/A</span>
        ) : (
          <span className="font-mono text-3xl font-medium tabular-nums">{value.toLocaleString()}</span>
        )}
      </CardContent>
    </Card>
  );
}

function CountCard({ className, noun, showWeekly = false, stats }: { className?: string; noun: string; showWeekly?: boolean; stats: Stats | null }) {
  const total = stats?.totalActive ?? 0;
  const weekNew = stats?.weekNew ?? 0;
  const weekChange = formatWeekChange(stats?.weekChange);
  const weekNewNotPositive = weekNew <= 0;
  const weekChangeNotPositive = stats?.weekChange != null && stats.weekChange <= 0;

  return (
    <Card className={cn("text-foreground", className)}>
      <CardHeader>
        <CardTitle>Audience</CardTitle>
        <CardDescription>Current tracked GitHub {noun}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Metric
          value={total.toLocaleString()}
          valueClassName="font-mono text-3xl font-medium"
        />
        {showWeekly ? (
          <>
            <Metric
              value={`+${weekNew.toLocaleString()}`}
              label="last week"
              className="text-muted-foreground"
              valueClassName={cn("text-sm", weekNewNotPositive && "text-destructive")}
            />
            <Metric
              value={weekChange}
              label="week over week"
              className="text-muted-foreground"
              valueClassName={cn("text-sm", weekChangeNotPositive && "text-destructive")}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GrowthCard({ className, stats }: { className?: string; stats: Stats | null }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Growth</CardTitle>
        <CardDescription>Cumulative stars over time.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={growthChartConfig} className="h-33 w-full">
          <ComposedChart accessibilityLayer data={stats?.trend ?? []} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis yAxisId="cumulative" hide />
            <YAxis yAxisId="daily" hide />
            <ChartTooltip shared content={<ChartTooltipContent />} />
            <Area
              yAxisId="daily"
              dataKey="newCount"
              type="stepAfter"
              animationDuration={250}
              fill="var(--color-newCount)"
              fillOpacity={0.18}
              stroke="var(--color-newCount)"
              strokeOpacity={0.85}
              strokeWidth={1}
            />
            <Line
              yAxisId="cumulative"
              dataKey="cumulativeCount"
              type="monotone"
              stroke="var(--color-cumulativeCount)"
              strokeWidth={2}
              animationDuration={250}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function Metric({
  className,
  label,
  value,
  valueClassName
}: {
  className?: string;
  label?: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 ${className ?? ""}`}>
      <span className={`inline-flex items-center gap-0.5 tabular-nums ${valueClassName ?? "font-medium"}`}>
        {value}
      </span>
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  );
}

function formatWeekChange(value: number | null | undefined) {
  if (value == null) return "n/a";
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "percent"
  }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

const profileGlobalFilter: FilterFn<UserRow> = (row, _columnId, filterValue) => {
  const query = String(filterValue ?? "").trim().toLowerCase();
  if (!query) return true;
  return [
    row.original.login,
    row.original.name,
    row.original.company,
    row.original.location,
    row.original.country,
    row.original.email,
    row.original.twitterUsername,
    row.original.blog,
    row.original.bio
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
};

function tableSortingStorageKey(kind: Target["kind"] | undefined) {
  return `starshot:table-sorting:${kind ?? "default"}`;
}

function readStoredTableSorting(kind: Target["kind"] | undefined, showAddedColumn: boolean): SortingState {
  try {
    const stored = window.localStorage.getItem(tableSortingStorageKey(kind));
    if (!stored) return defaultTableSorting;
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return defaultTableSorting;
    const sorting = validateTableSorting(parsed, showAddedColumn);
    return sorting.length > 0 ? sorting : defaultTableSorting;
  } catch {
    return defaultTableSorting;
  }
}

function writeStoredTableSorting(kind: Target["kind"] | undefined, sorting: SortingState, showAddedColumn: boolean) {
  try {
    window.localStorage.setItem(tableSortingStorageKey(kind), JSON.stringify(validateTableSorting(sorting, showAddedColumn)));
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function validateTableSorting(value: unknown[], showAddedColumn: boolean): SortingState {
  const allowedColumns = new Set([
    "login",
    "name",
    "followers",
    "company",
    "location",
    "email",
    "twitter",
    "blog",
    "bio",
    ...(showAddedColumn ? ["added"] : [])
  ]);
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { id?: unknown; desc?: unknown };
      if (typeof candidate.id !== "string" || !allowedColumns.has(candidate.id)) return null;
      return { id: candidate.id, desc: candidate.desc === true };
    })
    .filter((item): item is SortingState[number] => Boolean(item));
}

function ProfilesTable({
  kind,
  onExportSnapshot,
  showAddedColumn,
  users
}: {
  kind: Target["kind"] | undefined;
  onExportSnapshot: (snapshot: ExportSnapshot) => void;
  showAddedColumn: boolean;
  users: UsersPage;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [isScrolledX, setIsScrolledX] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSortingState] = useState<SortingState>(() => readStoredTableSorting(kind, showAddedColumn));
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 500 });
  const setSorting = useCallback((updater: SortingState | ((current: SortingState) => SortingState)) => {
    setSortingState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      writeStoredTableSorting(kind, next, showAddedColumn);
      return next;
    });
  }, [kind, showAddedColumn]);
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: "avatar",
        enableSorting: false,
        header: "",
        cell: ({ row }) => (
          <Avatar className="size-6">
            <AvatarImage src={githubAvatarUrl(row.original.login)} alt={row.original.login} />
            <AvatarFallback>{row.original.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        )
      },
      {
        id: "login",
        accessorKey: "login",
        header: "Login",
        cell: ({ row }) => (
          <a className="block truncate font-medium text-primary hover:underline" href={githubProfileUrl(row.original.login)} target="_blank" rel="noreferrer" title={row.original.login}>
            {row.original.login}
          </a>
        )
      },
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <TruncatedText value={row.original.name} />
      },
      {
        id: "followers",
        header: "Followers",
        accessorFn: (row) => row.followersCount,
        cell: ({ row }) => row.original.followersCount?.toLocaleString()
      },
      {
        id: "company",
        accessorKey: "company",
        header: "Company",
        cell: ({ row }) => <GithubLinkedText value={row.original.company} />
      },
      {
        id: "location",
        header: "Location",
        accessorFn: (row) => row.country ?? row.location ?? "",
        cell: ({ row }) => <TruncatedText value={row.original.country ?? row.original.location} />
      },
      {
        id: "email",
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <TruncatedText value={row.original.email} />
      },
      {
        id: "twitter",
        accessorKey: "twitterUsername",
        header: "Twitter",
        cell: ({ row }) => {
          const username = normalizeTwitterUsername(row.original.twitterUsername);
          return username ? (
            <a className="block truncate text-primary hover:underline" href={`https://x.com/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" title={`@${username}`}>
              @{username}
            </a>
          ) : null;
        }
      },
      {
        id: "blog",
        accessorKey: "blog",
        header: "Website",
        cell: ({ row }) => {
          const website = normalizeWebsite(row.original.blog);
          return website ? (
            <a className="block truncate text-primary hover:underline" href={website.href} target="_blank" rel="noreferrer" title={website.display}>
              {website.display}
            </a>
          ) : null;
        }
      },
      {
        id: "bio",
        accessorKey: "bio",
        header: "Bio",
        cell: ({ row }) => <GithubLinkedText value={row.original.bio} />
      },
      ...(showAddedColumn ? [{
        id: "added",
        header: "Added",
        accessorFn: (row) => row.starredAt ?? row.firstSeenAt,
        cell: ({ row }) => <DateCell value={row.original.starredAt ?? row.original.firstSeenAt} />
      } satisfies ColumnDef<UserRow>] : [])
    ],
    [showAddedColumn]
  );
  const table = useReactTable({
    data: users.rows,
    columns,
    state: {
      columnFilters,
      globalFilter,
      pagination,
      sorting
    },
    globalFilterFn: profileGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel()
  });
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 40,
    overscan: 20,
    scrollMargin
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? Math.max(0, virtualRows[0].start - scrollMargin) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? Math.max(0, rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1].end - scrollMargin))
      : 0;
  const pageCount = table.getPageCount();
  const previousDisabled = !table.getCanPreviousPage();
  const nextDisabled = !table.getCanNextPage();
  const hasFilter = Boolean(String(globalFilter ?? "").trim()) || columnFilters.length > 0;
  const title = kind === "repo_stargazers" ? "Stargazers" : "Followers";
  const description = kind === "repo_stargazers"
    ? "Filter, sort, and inspect active repository stargazers."
    : "Filter, sort, and inspect active profile followers.";
  const updateScrolledX = useCallback(() => {
    setIsScrolledX((tableScrollRef.current?.scrollLeft ?? 0) > 0);
  }, []);

  useLayoutEffect(() => {
    function updateScrollMargin() {
      setScrollMargin(tableRef.current?.offsetTop ?? 0);
      updateScrolledX();
    }

    updateScrollMargin();
    const frame = window.requestAnimationFrame(updateScrollMargin);
    window.addEventListener("resize", updateScrollMargin);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateScrollMargin);
    };
  }, [rows.length, updateScrolledX]);

  useEffect(() => {
    setPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 });
  }, [columnFilters, globalFilter]);

  useEffect(() => {
    setSortingState(readStoredTableSorting(kind, showAddedColumn));
  }, [kind, showAddedColumn]);

  useEffect(() => {
    onExportSnapshot({
      allCount: users.total,
      filteredCount: table.getPrePaginationRowModel().rows.length,
      filteredRows: table.getPrePaginationRowModel().rows.map((row) => row.original),
      hasFilter
    });
  });

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            <div className="relative w-80 max-w-full">
              <Search className="absolute left-3 top-2 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Search profiles..."
              />
            </div>
            <ProfileFacetCombobox table={table} columnId="company" label="companies" placeholder="Company" />
            <ProfileFacetCombobox table={table} columnId="location" label="locations" placeholder="Location" />
          </div>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100 rows</SelectItem>
              <SelectItem value="500">500 rows</SelectItem>
              <SelectItem value="1000">1,000 rows</SelectItem>
              <SelectItem value={String(Math.max(users.rows.length, 1))}>All rows</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div ref={scrollRef} className="min-w-0">
          <div ref={tableRef} className="min-w-0">
            <Table
              containerClassName={cn("scrollbar", isScrolledX && "table-scrolled-x")}
              containerRef={tableScrollRef}
              onContainerScroll={updateScrolledX}
              className="min-w-[104rem] table-fixed"
            >
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const alignRight = header.column.id === "followers";
                      return (
                        <TableHead key={header.id} className={profileHeaderClass(header.column.id)}>
                          <button
                            className={`flex w-full items-center gap-1 truncate rounded-md px-1 py-1 text-muted-foreground transition-colors hover:bg-muted ${alignRight ? "justify-end text-right" : "text-left"}`}
                            disabled={!header.column.getCanSort()}
                            onClick={header.column.getToggleSortingHandler()}
                            type="button"
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <span className="text-xs text-muted-foreground">{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : ""}</span>
                          </button>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
                      No results.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {paddingTop > 0 ? (
                      <TableRow aria-hidden="true">
                        <TableCell colSpan={columns.length} style={{ height: `${paddingTop}px` }} className="p-0" />
                      </TableRow>
                    ) : null}
                    {virtualRows.map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      return (
                        <TableRow key={row.id} className="group/row">
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className={profileCellClass(cell.column.id)}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                    {paddingBottom > 0 ? (
                      <TableRow aria-hidden="true">
                        <TableCell colSpan={columns.length} style={{ height: `${paddingBottom}px` }} className="p-0" />
                      </TableRow>
                    ) : null}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
            <div className="text-sm text-muted-foreground">
              Page {(pagination.pageIndex + 1).toLocaleString()} of {pageCount.toLocaleString()}
            </div>
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={previousDisabled}
                    tabIndex={previousDisabled ? -1 : undefined}
                    className={previousDisabled ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      table.previousPage();
                      scrollRef.current?.scrollIntoView({ block: "start" });
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={nextDisabled}
                    tabIndex={nextDisabled ? -1 : undefined}
                    className={nextDisabled ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      table.nextPage();
                      scrollRef.current?.scrollIntoView({ block: "start" });
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProfileFacetCombobox({
  columnId,
  label,
  placeholder,
  table
}: {
  columnId: string;
  label: string;
  placeholder: string;
  table: ReturnType<typeof useReactTable<UserRow>>;
}) {
  const column = table.getColumn(columnId);
  const value = String(column?.getFilterValue() ?? "");
  const facets = column?.getFacetedUniqueValues() ?? new Map<unknown, number>();
  const allOption = { count: table.getPreFilteredRowModel().rows.length, label: `All ${label}`, value: "" };
  const facetOptions = [...facets.entries()]
    .map(([facetValue, count]) => ({
      count,
      label: String(facetValue || ""),
      value: String(facetValue || "")
    }))
    .filter((option) => option.value.length > 0)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 100);
  const options = [allOption, ...facetOptions];
  const selectedOption = options.find((option) => option.value === value) ?? allOption;

  return (
    <Combobox
      items={options}
      itemToStringValue={(option) => option.label}
      value={selectedOption}
      onValueChange={(option) => column?.setFilterValue(option?.value || undefined)}
    >
      <ComboboxInput
        className="w-40"
        placeholder={placeholder}
        showClear={Boolean(value)}
      />
      <ComboboxContent>
        <ComboboxEmpty>No results.</ComboboxEmpty>
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option.value || "all"} value={option}>
              <span className={cn("min-w-0 flex-1 truncate", option.value === "" && "text-muted-foreground")}>
                {option.label}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{option.count.toLocaleString()}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function GithubLinkedText({ value }: { value: string | null | undefined }) {
  if (!value) return null;

  const parts = value.split(/(@[A-Za-z0-9-]+)/g);
  return (
    <span className="block truncate" title={value}>
      {parts.map((part, index) => {
        const login = part.match(/^@([A-Za-z0-9-]+)$/)?.[1];
        return login ? (
          <a key={`${part}-${index}`} className="text-primary hover:underline" href={githubProfileUrl(login)} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </span>
  );
}

function TruncatedText({ value }: { value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  const text = String(value);
  return <span className="block truncate" title={text}>{text}</span>;
}

function profileColumnClass(columnId: string) {
  switch (columnId) {
    case "avatar":
      return "w-12 min-w-12 max-w-12 pl-4";
    case "login":
      return "w-48 min-w-48 max-w-48";
    case "name":
      return "w-[13%]";
    case "followers":
      return "w-[8%] text-right";
    case "company":
      return "w-[14%]";
    case "location":
      return "w-[12%]";
    case "email":
      return "w-[16%]";
    case "twitter":
      return "w-[10%]";
    case "blog":
      return "w-[12%]";
    case "bio":
      return "w-[18%]";
    case "added":
      return "w-[8rem] pr-4";
    default:
      return "";
  }
}

function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block truncate tabular-nums">{formatShortDate(value)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatFullDateTime(value)}</TooltipContent>
    </Tooltip>
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "2-digit"
  }).format(new Date(value));
}

function formatFullDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long"
  }).format(new Date(value));
}

function profileHeaderClass(columnId: string) {
  return `${profileColumnClass(columnId)} sticky top-0 border-b bg-card ${profileStickyClass(columnId, true) || "z-20"}`;
}

function profileCellClass(columnId: string) {
  return `overflow-hidden text-ellipsis whitespace-nowrap ${profileColumnClass(columnId)} ${profileStickyClass(columnId, false)}`;
}

function profileStickyClass(columnId: string, header: boolean) {
  const zIndex = header ? "z-50" : "z-40";
  const background = header ? "bg-card" : "bg-card group-hover/row:bg-accent";
  switch (columnId) {
    case "avatar":
      return `sticky left-0 ${zIndex} ${background}`;
    case "login":
      return `table-fixed-edge sticky left-12 ${zIndex} ${background}`;
    default:
      return "";
  }
}
