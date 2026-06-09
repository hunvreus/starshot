import type { Target, TargetKind } from "../lib/types";
import { sqlite } from "./db";
import { nowIso } from "./time";
export { normalizeTarget, targetLabel } from "./target-utils";
import { normalizeTarget, targetLabel } from "./target-utils";

export function createTarget(userId: string, kind: TargetKind, value: string): Target {
  const normalized = normalizeTarget(kind, value);
  const now = nowIso();

  sqlite
    .prepare(
      `INSERT INTO sources (kind, value, label, github_repo_id, github_user_id, created_at, updated_at)
      VALUES (
        @kind,
        @value,
        @label,
        CASE WHEN @kind = 'repo_stargazers' THEN (SELECT id FROM github_repos WHERE lower(full_name) = lower(@value)) END,
        CASE WHEN @kind = 'user_followers' THEN (SELECT id FROM github_users WHERE lower(login) = lower(@value)) END,
        @now,
        @now
      )
      ON CONFLICT(kind, value) DO UPDATE SET
        label = excluded.label,
        github_repo_id = COALESCE(sources.github_repo_id, excluded.github_repo_id),
        github_user_id = COALESCE(sources.github_user_id, excluded.github_user_id),
        updated_at = excluded.updated_at`
    )
    .run({ kind, value: normalized, label: targetLabel(kind, normalized), now });

  const source = getSourceByKindValue(kind, normalized);
  sqlite
    .prepare(
      `INSERT INTO user_sources (user_id, source_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, source_id) DO NOTHING`
    )
    .run(userId, source.id, now);

  return getTarget(userId, source.id) ?? source;
}

function getSourceByKindValue(kind: TargetKind, value: string): Target {
  const row = sqlite
    .prepare(
      targetSelectSql("s.created_at", `WHERE s.kind = ? AND s.value = ?`)
    )
    .get(kind, value) as Target | undefined;
  if (!row) throw new Error("Source was not created");
  return row;
}

export function getTargetByKindValue(userId: string, kind: TargetKind, value: string) {
  const normalized = normalizeTarget(kind, value);
  const source = getSourceByKindValue(kind, normalized);
  const target = getTarget(userId, source.id);
  if (!target) throw new Error("Target was not created");
  return target;
}

export function getTarget(userId: string, id: number) {
  return sqlite
    .prepare(
      targetSelectSql(
        "us.created_at",
        `JOIN user_sources us ON us.source_id = s.id
      WHERE us.user_id = ? AND s.id = ?`
      )
    )
    .get(userId, id) as Target | undefined;
}

export function listTargets(userId: string) {
  return sqlite
    .prepare(
      targetSelectSql(
        "us.created_at",
        `JOIN user_sources us ON us.source_id = s.id
      WHERE us.user_id = ?
      ORDER BY us.created_at DESC`
      )
    )
    .all(userId) as Target[];
}

export function removeTarget(userId: string, id: number) {
  const result = sqlite.prepare("DELETE FROM user_sources WHERE user_id = ? AND source_id = ?").run(userId, id);
  if (result.changes === 0) throw new Error("Source not found");
}

export function linkCachedTarget(kind: TargetKind, value: string) {
  const normalized = normalizeTarget(kind, value);
  if (kind === "repo_stargazers") {
    sqlite
      .prepare(
        `UPDATE sources
        SET github_repo_id = (SELECT id FROM github_repos WHERE lower(full_name) = lower(@value))
        WHERE kind = @kind AND value = @value`
      )
      .run({ kind, value: normalized });
    return;
  }

  sqlite
    .prepare(
      `UPDATE sources
      SET github_user_id = (SELECT id FROM github_users WHERE lower(login) = lower(@value))
      WHERE kind = @kind AND value = @value`
    )
    .run({ kind, value: normalized });
}

function targetSelectSql(createdAtSql: string, tail: string) {
  return `SELECT
    s.id,
    s.kind,
    s.value,
    s.label,
    ${createdAtSql} AS createdAt,
    r.description,
    r.stargazers_count AS stargazersCount,
    r.owner_login AS ownerLogin,
    r.owner_avatar_url AS ownerAvatarUrl,
    r.html_url AS htmlUrl,
    r.homepage,
    r.language,
    r.forks_count AS forksCount,
    r.open_issues_count AS openIssuesCount,
    r.created_at AS repoCreatedAt,
    r.updated_at AS repoUpdatedAt,
    r.pushed_at AS pushedAt,
    r.latest_commit_sha AS latestCommitSha,
    r.latest_commit_url AS latestCommitUrl,
    r.latest_commit_message AS latestCommitMessage,
    r.latest_commit_author_login AS latestCommitAuthorLogin,
    r.latest_commit_author_avatar_url AS latestCommitAuthorAvatarUrl,
    r.latest_commit_author_url AS latestCommitAuthorUrl,
    r.latest_commit_author_name AS latestCommitAuthorName,
    r.latest_commit_at AS latestCommitAt,
    u.avatar_url AS avatarUrl,
    u.name,
    u.company,
    u.location,
    u.bio,
    u.email,
    u.twitter_username AS twitterUsername,
    u.blog,
    u.followers_count AS followersCount,
    u.following_count AS followingCount,
    u.created_at AS profileCreatedAt,
    u.updated_at AS profileUpdatedAt
  FROM sources s
  LEFT JOIN github_repos r ON r.id = s.github_repo_id OR (s.kind = 'repo_stargazers' AND lower(r.full_name) = lower(s.value))
  LEFT JOIN github_users u ON u.id = s.github_user_id OR (s.kind = 'user_followers' AND lower(u.login) = lower(s.value))
  ${tail}`;
}
