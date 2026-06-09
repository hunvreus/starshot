import type { Stats, UserRow, UsersPage } from "../lib/types";
import { sqlite } from "./db";

type UserParams = { targetId?: number; q?: string; active?: string };
type UserSort = "added" | "login" | "name" | "company" | "location" | "followers" | "status";

const sortColumns: Record<UserSort, string> = {
  added: "COALESCE(m.starred_at, m.first_seen_at)",
  login: "u.login",
  name: "u.name",
  company: "u.company",
  location: "COALESCE(u.country, u.location)",
  followers: "u.followers_count",
  status: "m.removed_at"
};

function userWhere(userId: string, params: UserParams) {
  const where = ["us.user_id = ?"];
  const values: Array<string | number> = [userId];

  if (params.targetId) {
    where.push("m.source_id = ?");
    values.push(params.targetId);
  }

  if (params.active === "active") {
    where.push("m.removed_at IS NULL");
  } else if (params.active === "inactive") {
    where.push("m.removed_at IS NOT NULL");
  }

  const q = params.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const fts = ftsPrefixQuery(q);
    where.push(`(
      ${fts ? "u.id IN (SELECT rowid FROM github_users_fts WHERE github_users_fts MATCH ?)" : "0"}
      OR u.login LIKE ?
      OR u.name LIKE ?
      OR u.company LIKE ?
      OR u.location LIKE ?
      OR u.bio LIKE ?
    )`);
    if (fts) values.push(fts);
    values.push(like, like, like, like, like);
  }

  return { clause: `WHERE ${where.join(" AND ")}`, values };
}

function ftsPrefixQuery(query: string) {
  return query
    .split(/\s+/)
    .map((term) => term.replaceAll('"', "").trim())
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" ");
}

const userSelect = `SELECT
  u.id,
  m.id AS membershipId,
  m.source_id AS sourceId,
  u.login,
  COALESCE(NULLIF(u.avatar_url, ''), 'https://github.com/' || u.login || '.png?size=48') AS avatarUrl,
  u.name,
  u.company,
  u.location,
  u.email,
  u.bio,
  u.twitter_username AS twitterUsername,
  u.followers_count AS followersCount,
  u.following_count AS followingCount,
  u.public_repos AS publicRepos,
  u.public_gists AS publicGists,
  u.blog,
  u.hireable,
  u.created_at AS createdAt,
  u.updated_at AS updatedAt,
  u.fetched_at AS fetchedAt,
  u.normalized_location AS normalizedLocation,
  u.country,
  u.country_code AS countryCode,
  u.latitude,
  u.longitude,
  u.geocoded_at AS geocodedAt,
  m.starred_at AS starredAt,
  m.first_seen_at AS firstSeenAt,
  m.last_seen_at AS lastSeenAt,
  m.removed_at AS inactiveAt,
  m.last_run_id AS lastRunId
FROM source_memberships m
JOIN user_sources us ON us.source_id = m.source_id
JOIN github_users u ON u.id = m.github_user_id`;

export function listUsers(
  userId: string,
  params: UserParams & { page?: number; pageSize?: number; sort?: string; direction?: string }
): UsersPage {
  const { clause, values } = userWhere(userId, params);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50000, Math.max(25, params.pageSize ?? 100));
  const offset = (page - 1) * pageSize;
  const sort = normalizeSort(params.sort);
  const direction = params.direction === "desc" ? "desc" : "asc";
  const order = `${sortColumns[sort]} ${direction.toUpperCase()}, u.login ASC`;

  const totalRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS total
      FROM source_memberships m
      JOIN user_sources us ON us.source_id = m.source_id
      JOIN github_users u ON u.id = m.github_user_id
      ${clause}`
    )
    .get(...values) as { total: number } | undefined;

  const rows = sqlite
    .prepare(
      `${userSelect}
      ${clause}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset) as UserRow[];

  return { rows, total: totalRow?.total ?? 0, page, pageSize, sort, direction };
}

export function listAllUsers(userId: string, params: UserParams): UserRow[] {
  const { clause, values } = userWhere(userId, params);
  return sqlite
    .prepare(
      `${userSelect}
      ${clause}
      ORDER BY COALESCE(m.starred_at, m.first_seen_at) DESC, u.login ASC`
    )
    .all(...values) as UserRow[];
}

function countryFromLocation(location: string | null) {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? location.trim();
}

export function getStats(userId: string, targetId?: number): Stats {
  const targetClause = targetId ? "AND m.source_id = ?" : "";
  const args: Array<string | number> = targetId ? [userId, targetId] : [userId];

  const totals =
    (sqlite
      .prepare(
        `SELECT
          SUM(CASE WHEN m.removed_at IS NULL THEN 1 ELSE 0 END) AS totalActive,
          SUM(CASE WHEN m.removed_at IS NOT NULL THEN 1 ELSE 0 END) AS totalInactive,
          SUM(CASE WHEN m.removed_at IS NULL AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL THEN 1 ELSE 0 END) AS geocoded
        FROM source_memberships m
        JOIN user_sources us ON us.source_id = m.source_id
        JOIN github_users u ON u.id = m.github_user_id
        WHERE us.user_id = ? ${targetClause}`
      )
      .get(...args) as { totalActive: number | null; totalInactive: number | null; geocoded: number | null } | undefined) ?? {
      totalActive: 0,
      totalInactive: 0,
      geocoded: 0
    };

  const locations = sqlite
    .prepare(
      `SELECT u.login, u.location, u.normalized_location AS normalizedLocation, u.country, u.latitude, u.longitude
      FROM source_memberships m
      JOIN user_sources us ON us.source_id = m.source_id
      JOIN github_users u ON u.id = m.github_user_id
      WHERE us.user_id = ? AND m.removed_at IS NULL ${targetClause}`
    )
    .all(...args) as Array<{
    login: string;
    location: string | null;
    normalizedLocation: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;

  const countryMap = new Map<string, number>();
  for (const row of locations) {
    const country = row.country ?? countryFromLocation(row.location);
    if (country) countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
  }

  const trend = sqlite
    .prepare(
      `SELECT substr(COALESCE(m.starred_at, m.first_seen_at), 1, 10) AS date, COUNT(*) AS newCount
      FROM source_memberships m
      JOIN user_sources us ON us.source_id = m.source_id
      WHERE us.user_id = ? AND m.removed_at IS NULL ${targetClause}
      GROUP BY date
      ORDER BY date ASC`
    )
    .all(...args) as Array<{ date: string; newCount: number }>;

  const sourceStart =
    targetId == null
      ? undefined
      : (sqlite
          .prepare(
            `SELECT substr(r.created_at, 1, 10) AS createdAt
            FROM sources s
            LEFT JOIN github_repos r ON r.id = s.github_repo_id
            JOIN user_sources us ON us.source_id = s.id
            WHERE us.user_id = ? AND s.id = ? AND s.kind = 'repo_stargazers'`
          )
          .get(userId, targetId) as { createdAt: string | null } | undefined);

  const lastDate = trend.at(-1)?.date;
  const { weekNew, previousWeekNew } = weeklyCounts(trend, lastDate);

  const totalActive = totals.totalActive ?? 0;
  const totalInactive = totals.totalInactive ?? 0;

  return {
    totalActive,
    totalInactive,
    total: totalActive + totalInactive,
    geocoded: totals.geocoded ?? 0,
    weekNew,
    previousWeekNew,
    weekChange: previousWeekNew > 0 ? (weekNew - previousWeekNew) / previousWeekNew : null,
    countries: [...countryMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    locations: locations
      .filter((row): row is typeof row & { latitude: number; longitude: number } => row.latitude != null && row.longitude != null)
      .slice(0, 500)
      .map((row) => ({
        login: row.login,
        label: row.normalizedLocation ?? row.location ?? row.login,
        latitude: row.latitude,
        longitude: row.longitude
      })),
    trend: cumulativeTrend(trend, 90, sourceStart?.createdAt ?? undefined)
  };
}

function weeklyCounts(rows: Array<{ date: string; newCount: number }>, lastDate: string | undefined) {
  if (!lastDate) return { weekNew: 0, previousWeekNew: 0 };

  const lastWeekStart = addDays(lastDate, -6);
  const previousWeekStart = addDays(lastDate, -13);
  return {
    weekNew: rows.filter((row) => row.date >= lastWeekStart && row.date <= lastDate).reduce((sum, row) => sum + row.newCount, 0),
    previousWeekNew: rows.filter((row) => row.date >= previousWeekStart && row.date < lastWeekStart).reduce((sum, row) => sum + row.newCount, 0)
  };
}

function cumulativeTrend(rows: Array<{ date: string; newCount: number }>, minDays: number, requestedStartDate?: string) {
  if (rows.length === 0) return [];

  const firstDate = rows[0].date;
  const lastDate = rows.at(-1)?.date ?? firstDate;
  const minStartDate = addDays(lastDate, -(minDays - 1));
  const dataStartDate = firstDate < minStartDate ? firstDate : minStartDate;
  const startDate = requestedStartDate && requestedStartDate < dataStartDate ? requestedStartDate : dataStartDate;
  const result: Array<{ date: string; cumulativeCount: number; newCount: number }> = [];
  const countsByDate = new Map(rows.map((row) => [row.date, row.newCount]));
  let cumulative = 0;

  for (let date = startDate; date <= lastDate; date = addDays(date, 1)) {
    const newCount = countsByDate.get(date) ?? 0;
    cumulative += newCount;
    result.push({ date, cumulativeCount: cumulative, newCount });
  }

  return result;
}

function addDays(date: string | undefined, days: number) {
  if (!date) return "";
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function normalizeSort(sort: string | undefined): UserSort {
  if (sort === "added" || sort === "login" || sort === "name" || sort === "company" || sort === "location" || sort === "followers" || sort === "status") {
    return sort;
  }
  return "added";
}
