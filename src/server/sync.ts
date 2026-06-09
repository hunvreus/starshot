import { sqlite } from "./db";
import { env } from "./env";
import { ensureFreshGithubUser, upsertGithubRepo, upsertGithubUser } from "./github-cache";
import { getFollowers, getNewestStargazersPage, getRepo, getStargazers, getUser } from "./github";
import { getTarget } from "./targets";
import { nowIso, staleFetchedAt } from "./time";
import type { SyncMode, SyncRun } from "../lib/types";
import type { Statement } from "better-sqlite3";

type SourceRow = {
  id: number;
  kind: "repo_stargazers" | "user_followers";
  value: string;
};

type Entry = {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  starredAt: string | null;
};

type BeginRunResult = {
  run: SyncRun;
  created: boolean;
};

type ClaimedRun = {
  id: number;
  userId: string;
  sourceId: number;
};

type SyncStatements = {
  upsertPlaceholder: Statement<unknown[]>;
  upsertMembership: Statement<unknown[]>;
  updateScanned: Statement<unknown[]>;
  reactivateMembership: Statement<unknown[]>;
  markMembershipInactive: Statement<unknown[]>;
  deleteMemberships: Statement<unknown[]>;
};

let syncStatements: SyncStatements | undefined;

function statements() {
  syncStatements ??= {
    upsertPlaceholder: sqlite.prepare(
      `INSERT INTO github_users (id, login, avatar_url, fetched_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        login = excluded.login,
        avatar_url = COALESCE(excluded.avatar_url, github_users.avatar_url)`
    ),
    upsertMembership: sqlite.prepare(
      `INSERT INTO source_memberships (
        source_id, github_user_id, starred_at, first_seen_at, last_seen_at, removed_at, last_run_id
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(source_id, github_user_id) DO UPDATE SET
        starred_at = COALESCE(excluded.starred_at, source_memberships.starred_at),
        last_seen_at = excluded.last_seen_at,
        removed_at = NULL,
        last_run_id = excluded.last_run_id`
    ),
    updateScanned: sqlite.prepare("UPDATE sync_runs SET scanned_count = ? WHERE id = ?"),
    reactivateMembership: sqlite.prepare(
      `UPDATE source_memberships
      SET starred_at = COALESCE(?, starred_at),
        last_seen_at = ?,
        removed_at = NULL,
        last_run_id = ?
      WHERE source_id = ? AND github_user_id = ?`
    ),
    markMembershipInactive: sqlite.prepare(
      `UPDATE source_memberships
      SET removed_at = ?
      WHERE source_id = ? AND github_user_id = ? AND removed_at IS NULL`
    ),
    deleteMemberships: sqlite.prepare("DELETE FROM source_memberships WHERE source_id = ?")
  };

  return syncStatements;
}

function runSelect(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `SELECT
    ${prefix}id,
    ${prefix}source_id AS targetId,
    COALESCE(${prefix}mode, 'smart') AS mode,
    ${prefix}status,
    ${prefix}started_at AS startedAt,
    ${prefix}finished_at AS finishedAt,
    ${prefix}error,
    ${prefix}scanned_count AS scannedCount,
    ${prefix}active_count AS activeCount,
    ${prefix}removed_count AS removedCount`;
}

function profileConcurrency() {
  if (!Number.isFinite(env.githubProfileConcurrency)) return 8;
  return Math.min(100, Math.max(1, Math.floor(env.githubProfileConcurrency)));
}

function syncConcurrency() {
  if (!Number.isFinite(env.syncConcurrency)) return 4;
  return Math.min(200, Math.max(1, Math.floor(env.syncConcurrency)));
}

async function mapConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export function clearOrphanedRuns() {
  sqlite
    .prepare(
      `UPDATE sync_runs
      SET status = 'queued', finished_at = NULL, error = 'Server restarted during sync'
      WHERE status = 'running'`
    )
    .run();
}

export function listRuns(userId: string) {
  return sqlite
    .prepare(
      `${runSelect("r")}
      FROM sync_runs r
      JOIN user_sources us ON us.source_id = r.source_id
      WHERE us.user_id = ?
      ORDER BY r.started_at DESC
      LIMIT 20`
    )
    .all(userId) as SyncRun[];
}

export function startSync(userId: string, sourceId: number, mode: SyncMode = "smart") {
  const source = getTarget(userId, sourceId);
  if (!source) throw new Error("Source not found");

  const { run, created } = beginRun(userId, source.id, normalizeSyncMode(mode));
  if (created) wakeSyncScheduler();

  return run;
}

const beginRun = sqlite.transaction((userId: string, sourceId: number, mode: SyncMode): BeginRunResult => {
  const existing = getActiveRun(sourceId);
  if (existing) return { run: existing, created: false };

  const runId = createRun(userId, sourceId, mode);
  const run = getRun(runId);
  if (!run) throw new Error("Sync run was not created");
  return { run, created: true };
});

function normalizeSyncMode(mode: string): SyncMode {
  if (mode === "full" || mode === "profiles" || mode === "clear") return mode;
  return "smart";
}

function getActiveRun(sourceId: number): SyncRun | undefined {
  return sqlite
    .prepare(
      `${runSelect()}
      FROM sync_runs
      WHERE source_id = ? AND status IN ('queued', 'running')
      ORDER BY started_at DESC
      LIMIT 1`
    )
    .get(sourceId) as SyncRun | undefined;
}

function createRun(userId: string, sourceId: number, mode: SyncMode) {
  const result = sqlite
    .prepare(
      `INSERT INTO sync_runs (user_id, source_id, mode, status, started_at, scanned_count, active_count, removed_count)
      VALUES (?, ?, ?, 'queued', ?, 0, 0, 0)`
    )
    .run(userId, sourceId, mode, nowIso());
  return Number(result.lastInsertRowid);
}

function getRun(runId: number): SyncRun | undefined {
  return sqlite
    .prepare(
      `${runSelect()}
      FROM sync_runs
      WHERE id = ?`
    )
    .get(runId) as SyncRun | undefined;
}

const activeRuns = new Set<number>();
let schedulerWakeQueued = false;

export function startSyncScheduler() {
  wakeSyncScheduler();
}

function wakeSyncScheduler() {
  if (schedulerWakeQueued) return;
  schedulerWakeQueued = true;
  setImmediate(() => {
    schedulerWakeQueued = false;
    pumpSyncScheduler();
  });
}

function pumpSyncScheduler() {
  while (activeRuns.size < syncConcurrency()) {
    const run = claimNextRun();
    if (!run) break;

    activeRuns.add(run.id);
    void runSync(run).finally(() => {
      activeRuns.delete(run.id);
      wakeSyncScheduler();
    });
  }
}

const claimNextRun = sqlite.transaction((): ClaimedRun | undefined => {
  const run = sqlite
    .prepare(
      `SELECT id, user_id AS userId, source_id AS sourceId
      FROM sync_runs
      WHERE status = 'queued'
      ORDER BY started_at ASC, id ASC
      LIMIT 1`
    )
    .get() as ClaimedRun | undefined;

  if (!run) return undefined;

  sqlite
    .prepare(
      `UPDATE sync_runs
      SET status = 'running', error = NULL
      WHERE id = ? AND status = 'queued'`
    )
    .run(run.id);

  return run;
});

async function runSync(run: ClaimedRun) {
  try {
    const token = getGithubAccessTokenForUser(run.userId);
    const source = getSource(run.sourceId);
    const syncRun = getRun(run.id);
    const mode = syncRun?.mode ?? "smart";

    if (mode === "profiles") {
      await refreshProfiles(token, run.sourceId, run.id);
      finishRun(run.id, "success");
      return;
    }

    if (mode === "clear") {
      clearMemberships(run.sourceId, run.id);
      finishRun(run.id, "success");
      return;
    }

    if (mode === "smart") {
      await runSmartSync(token, run.sourceId, run.id, source);
      finishRun(run.id, "success");
      return;
    }

    await fetchGithubTotal(token, source);
    const entries = await fetchEntries(token, source);
    reconcileMemberships(run.sourceId, run.id, entries, true);
    finishRun(run.id, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Update failed", {
      runId: run.id,
      sourceId: run.sourceId,
      error
    });
    finishRun(run.id, "error", message);
  }
}

function getGithubAccessTokenForUser(userId: string) {
  const row = sqlite
    .prepare(
      `SELECT accessToken
      FROM account
      WHERE userId = ? AND providerId = 'github' AND accessToken IS NOT NULL
      ORDER BY updatedAt DESC
      LIMIT 1`
    )
    .get(userId) as { accessToken: string | null } | undefined;

  if (!row?.accessToken) throw new Error("GitHub account is not linked");
  return row.accessToken;
}

function getSource(sourceId: number) {
  const source = sqlite.prepare("SELECT id, kind, value FROM sources WHERE id = ?").get(sourceId) as SourceRow | undefined;
  if (!source) throw new Error("Source not found");
  return source;
}

async function fetchEntries(token: string, source: SourceRow): Promise<Entry[]> {
  if (source.kind === "repo_stargazers") {
    const stargazers = await getStargazers(token, source.value);
    return stargazers.map((row) => ({
      githubUserId: row.user.id,
      login: row.user.login,
      avatarUrl: row.user.avatar_url,
      starredAt: row.starred_at
    }));
  }

  const followers = await getFollowers(token, source.value);
  return followers.map((row) => ({
    githubUserId: row.id,
    login: row.login,
    avatarUrl: row.avatar_url,
    starredAt: null
  }));
}

async function runSmartSync(token: string, sourceId: number, runId: number, source: SourceRow) {
  if (source.kind === "repo_stargazers") {
    await runSmartRepoSync(token, sourceId, runId, source);
    return;
  }

  await fetchGithubTotal(token, source);
  const entries = await fetchEntries(token, source);
  reconcileMemberships(sourceId, runId, entries, true);
}

async function runSmartRepoSync(token: string, sourceId: number, runId: number, source: SourceRow) {
  const beforeActiveCount = getActiveMembershipCount(sourceId);
  const githubTotal = await fetchGithubTotal(token, source);

  if (beforeActiveCount === 0) {
    const entries = await fetchEntries(token, source);
    reconcileMemberships(sourceId, runId, entries, true);
    return;
  }

  if (githubTotal != null && await reconcileRepoDelta(token, source, runId, beforeActiveCount, githubTotal)) {
    return;
  }

  const entries = await fetchEntries(token, source);
  reconcileMemberships(sourceId, runId, entries, true);
}

async function fetchGithubTotal(token: string, source: SourceRow) {
  if (source.kind === "repo_stargazers") {
    const repo = await getRepo(token, source.value);
    upsertGithubRepo(repo);
    return repo.stargazers_count;
  }

  const user = await getUser(token, source.value);
  upsertGithubUser(user);
  return user.followers;
}

function syncKnownBoundaryCount() {
  if (!Number.isFinite(env.syncKnownBoundaryCount)) return 200;
  return Math.max(1, Math.floor(env.syncKnownBoundaryCount));
}

function updateProbeMaxPages() {
  if (!Number.isFinite(env.updateProbeMaxPages)) return 5;
  return Math.max(1, Math.floor(env.updateProbeMaxPages));
}

function dedupeEntries(entries: Entry[]) {
  const map = new Map<number, Entry>();
  for (const entry of entries) map.set(entry.githubUserId, entry);
  return [...map.values()];
}

function getActiveMembershipCount(sourceId: number) {
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM source_memberships WHERE source_id = ? AND removed_at IS NULL")
    .get(sourceId) as { count: number } | undefined;
  return row?.count ?? 0;
}

function getActiveMembershipIds(sourceId: number) {
  const rows = sqlite
    .prepare("SELECT github_user_id AS githubUserId FROM source_memberships WHERE source_id = ? AND removed_at IS NULL")
    .all(sourceId) as Array<{ githubUserId: number }>;
  return new Set(rows.map((row) => row.githubUserId));
}

function getActiveMembershipRows(sourceId: number) {
  return sqlite
    .prepare(
      `SELECT github_user_id AS githubUserId, starred_at AS starredAt
      FROM source_memberships
      WHERE source_id = ? AND removed_at IS NULL
      ORDER BY starred_at DESC`
    )
    .all(sourceId) as Array<{ githubUserId: number; starredAt: string | null }>;
}

function updateScannedCount(count: number, runId: number) {
  statements().updateScanned.run(count, runId);
}

const markInactiveByIds = sqlite.transaction((sourceId: number, ids: number[]) => {
  const now = nowIso();
  const { markMembershipInactive } = statements();
  for (const id of ids) markMembershipInactive.run(now, sourceId, id);
});

const clearMemberships = sqlite.transaction((sourceId: number, runId: number) => {
  const rowCount = sqlite
    .prepare("SELECT COUNT(*) AS count FROM source_memberships WHERE source_id = ?")
    .get(sourceId) as { count: number } | undefined;
  statements().deleteMemberships.run(sourceId);
  updateScannedCount(rowCount?.count ?? 0, runId);
});

async function reconcileRepoDelta(token: string, source: SourceRow, runId: number, beforeActiveCount: number, githubTotal: number) {
  const activeRows = getActiveMembershipRows(source.id);
  if (activeRows.some((row) => row.starredAt == null)) return false;

  const activeIds = new Set(activeRows.map((row) => row.githubUserId));
  const entries: Entry[] = [];
  const seenIds = new Set<number>();
  let cursor: string | null = null;
  let knownStreak = 0;
  const boundaryCount = syncKnownBoundaryCount();
  const maxPages = updateProbeMaxPages();

  for (let page = 0; page < maxPages; page += 1) {
    const response = await getNewestStargazersPage(token, source.value, cursor);
    for (const row of response.rows) {
      const entry = {
        githubUserId: row.user.id,
        login: row.user.login,
        avatarUrl: row.user.avatar_url,
        starredAt: row.starred_at
      };
      entries.push(entry);
      seenIds.add(entry.githubUserId);
      knownStreak = activeIds.has(entry.githubUserId) ? knownStreak + 1 : 0;
    }

    const dedupedEntries = dedupeEntries(entries);
    const newCount = dedupedEntries.filter((entry) => !activeIds.has(entry.githubUserId)).length;
    const expectedRemoved = beforeActiveCount + newCount - githubTotal;

    if (knownStreak >= boundaryCount || !response.hasNextPage) {
      if (expectedRemoved <= 0) {
        reconcileMemberships(source.id, runId, dedupedEntries, false);
        return true;
      }

      const oldestScannedStarredAt = dedupedEntries[dedupedEntries.length - 1]?.starredAt;
      if (oldestScannedStarredAt) {
        const removedIds = activeRows
          .filter((row) => row.starredAt != null && row.starredAt >= oldestScannedStarredAt && !seenIds.has(row.githubUserId))
          .map((row) => row.githubUserId);

        if (removedIds.length === expectedRemoved) {
          reconcileMemberships(source.id, runId, dedupedEntries, false);
          markInactiveByIds(source.id, removedIds);
          return true;
        }

        if (removedIds.length > expectedRemoved) return false;
      }
    }

    if (!response.hasNextPage) break;
    cursor = response.nextCursor;
  }

  return false;
}

const writeMemberships = sqlite.transaction((sourceId: number, runId: number, entries: Entry[], markMissingInactive: boolean) => {
  const { markMembershipInactive, reactivateMembership, updateScanned, upsertMembership, upsertPlaceholder } = statements();
  const now = nowIso();
  const seenIds = new Set(entries.map((entry) => entry.githubUserId));
  const existingRows = sqlite
    .prepare(
      `SELECT github_user_id AS githubUserId, starred_at AS starredAt, removed_at AS removedAt
      FROM source_memberships
      WHERE source_id = ?`
    )
    .all(sourceId) as Array<{ githubUserId: number; starredAt: string | null; removedAt: string | null }>;
  const existing = new Map(existingRows.map((row) => [row.githubUserId, row]));

  for (const entry of entries) {
    const current = existing.get(entry.githubUserId);
    upsertPlaceholder.run(entry.githubUserId, entry.login, entry.avatarUrl, staleFetchedAt);
    if (!current) {
      upsertMembership.run(sourceId, entry.githubUserId, entry.starredAt, now, now, runId);
    } else if (current.removedAt != null || (entry.starredAt != null && current.starredAt == null)) {
      reactivateMembership.run(entry.starredAt, now, runId, sourceId, entry.githubUserId);
    }
  }

  if (markMissingInactive) {
    for (const row of existingRows) {
      if (!seenIds.has(row.githubUserId)) markMembershipInactive.run(now, sourceId, row.githubUserId);
    }
  }

  updateScanned.run(entries.length, runId);

  return {
    reactivatedCount: existingRows.filter((row) => row.removedAt != null && seenIds.has(row.githubUserId)).length
  };
});

function reconcileMemberships(sourceId: number, runId: number, entries: Entry[], markMissingInactive: boolean) {
  return writeMemberships(sourceId, runId, dedupeEntries(entries), markMissingInactive);
}

async function refreshProfiles(token: string, sourceId: number, runId: number) {
  const rows = sqlite
    .prepare(
      `SELECT u.login
      FROM source_memberships m
      JOIN github_users u ON u.id = m.github_user_id
      WHERE m.source_id = ? AND m.removed_at IS NULL`
    )
    .all(sourceId) as Array<{ login: string }>;

  updateScannedCount(rows.length, runId);
  await mapConcurrent(rows, profileConcurrency(), async (row) => {
    await ensureFreshGithubUser(token, row.login);
  });
}

function finishRun(runId: number, status: "success" | "error", error?: string) {
  const counts = sqlite
    .prepare(
      `SELECT
        (SELECT scanned_count FROM sync_runs WHERE id = ?) AS scannedCount,
        SUM(CASE WHEN removed_at IS NULL THEN 1 ELSE 0 END) AS activeCount,
        SUM(CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END) AS removedCount
      FROM source_memberships
      WHERE source_id = (SELECT source_id FROM sync_runs WHERE id = ?)`
    )
    .get(runId, runId) as { scannedCount: number | null; activeCount: number | null; removedCount: number | null } | undefined;

  sqlite
    .prepare(
      `UPDATE sync_runs
      SET status = ?,
        finished_at = ?,
        error = ?,
        scanned_count = ?,
        active_count = ?,
        removed_count = ?
      WHERE id = ?`
    )
    .run(
      status,
      nowIso(),
      error ?? null,
      counts?.scannedCount ?? 0,
      counts?.activeCount ?? 0,
      counts?.removedCount ?? 0,
      runId
    );
}
