import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const githubUsers = sqliteTable("github_users", {
  id: integer("id").primaryKey(),
  login: text("login").notNull().unique(),
  avatarUrl: text("avatar_url"),
  name: text("name"),
  company: text("company"),
  location: text("location"),
  email: text("email"),
  bio: text("bio"),
  twitterUsername: text("twitter_username"),
  followersCount: integer("followers_count"),
  followingCount: integer("following_count"),
  publicRepos: integer("public_repos"),
  publicGists: integer("public_gists"),
  blog: text("blog"),
  hireable: integer("hireable"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  normalizedLocation: text("normalized_location"),
  country: text("country"),
  countryCode: text("country_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  geocodedAt: text("geocoded_at"),
  fetchedAt: text("fetched_at").notNull()
});

export const githubRepos = sqliteTable("github_repos", {
  id: integer("id").primaryKey(),
  fullName: text("full_name").notNull().unique(),
  description: text("description"),
  private: integer("private").notNull().default(0),
  stargazersCount: integer("stargazers_count").notNull().default(0),
  ownerLogin: text("owner_login"),
  ownerAvatarUrl: text("owner_avatar_url"),
  htmlUrl: text("html_url"),
  homepage: text("homepage"),
  language: text("language"),
  forksCount: integer("forks_count"),
  openIssuesCount: integer("open_issues_count"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  pushedAt: text("pushed_at"),
  latestCommitSha: text("latest_commit_sha"),
  latestCommitUrl: text("latest_commit_url"),
  latestCommitMessage: text("latest_commit_message"),
  latestCommitAuthorLogin: text("latest_commit_author_login"),
  latestCommitAuthorAvatarUrl: text("latest_commit_author_avatar_url"),
  latestCommitAuthorUrl: text("latest_commit_author_url"),
  latestCommitAuthorName: text("latest_commit_author_name"),
  latestCommitAt: text("latest_commit_at"),
  fetchedAt: text("fetched_at").notNull()
});

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["repo_stargazers", "user_followers"] }).notNull(),
    value: text("value").notNull(),
    label: text("label").notNull(),
    githubRepoId: integer("github_repo_id").references(() => githubRepos.id),
    githubUserId: integer("github_user_id").references(() => githubUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    sourceKey: uniqueIndex("sources_kind_value_idx").on(table.kind, table.value)
  })
);

export const userSources = sqliteTable(
  "user_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    userSourceKey: uniqueIndex("user_sources_user_source_idx").on(table.userId, table.sourceId)
  })
);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  mode: text("mode", { enum: ["smart", "full", "profiles", "clear"] }).notNull().default("smart"),
  status: text("status", { enum: ["queued", "running", "success", "error"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  error: text("error"),
  scannedCount: integer("scanned_count").notNull().default(0),
  activeCount: integer("active_count").notNull().default(0),
  removedCount: integer("removed_count").notNull().default(0)
});

export const sourceMemberships = sqliteTable(
  "source_memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id),
    githubUserId: integer("github_user_id").notNull().references(() => githubUsers.id),
    starredAt: text("starred_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    removedAt: text("removed_at"),
    lastRunId: integer("last_run_id").notNull().references(() => syncRuns.id)
  },
  (table) => ({
    membershipKey: uniqueIndex("source_memberships_source_user_idx").on(table.sourceId, table.githubUserId)
  })
);
