import { sqlite } from "./db";
import { env } from "./env";
import { geocodeUserIfNeeded } from "./geocode";
import { getLatestCommit, getRepo, getUser, type GithubCommitResult, type GithubRepoListResult, type GithubRepoSearchResult, type GithubUser } from "./github";
import { nowIso } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

type CachedGithubUser = {
  id: number;
  login: string;
  avatarUrl: string | null;
  name: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitterUsername: string | null;
  followersCount: number | null;
  followingCount: number | null;
  publicRepos: number | null;
  publicGists: number | null;
  blog: string | null;
  hireable: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
};

type CachedGithubRepo = {
  id: number;
  fullName: string;
  description: string | null;
  private: number;
  stargazersCount: number;
  ownerLogin: string | null;
  ownerAvatarUrl: string | null;
  htmlUrl: string | null;
  homepage: string | null;
  language: string | null;
  forksCount: number | null;
  openIssuesCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
  latestCommitSha: string | null;
  latestCommitUrl: string | null;
  latestCommitMessage: string | null;
  latestCommitAuthorLogin: string | null;
  latestCommitAuthorAvatarUrl: string | null;
  latestCommitAuthorUrl: string | null;
  latestCommitAuthorName: string | null;
  latestCommitAt: string | null;
  fetchedAt: string;
};

function ttlMs(days: number) {
  return Math.max(0, days) * DAY_MS;
}

function isFresh(fetchedAt: string | null | undefined, ttlDays: number) {
  if (!fetchedAt) return false;
  const ttl = ttlMs(ttlDays);
  return ttl === 0 || Date.now() - new Date(fetchedAt).getTime() < ttl;
}

function hasHydratedProfile(user: CachedGithubUser) {
  return Boolean(user.avatarUrl) && user.followersCount != null && user.followingCount != null;
}

export function upsertGithubUser(user: GithubUser) {
  sqlite
    .prepare(
      `INSERT INTO github_users (
        id, login, avatar_url, name, company, location, email, bio, twitter_username,
        followers_count, following_count, public_repos, public_gists, blog,
        hireable, created_at, updated_at, fetched_at
      ) VALUES (
        @id, @login, @avatarUrl, @name, @company, @location, @email, @bio, @twitterUsername,
        @followers, @following, @publicRepos, @publicGists, @blog,
        @hireable, @createdAt, @updatedAt, @fetchedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        login = excluded.login,
        avatar_url = excluded.avatar_url,
        name = excluded.name,
        company = excluded.company,
        location = excluded.location,
        email = excluded.email,
        bio = excluded.bio,
        twitter_username = excluded.twitter_username,
        followers_count = excluded.followers_count,
        following_count = excluded.following_count,
        public_repos = excluded.public_repos,
        public_gists = excluded.public_gists,
        blog = excluded.blog,
        hireable = excluded.hireable,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        fetched_at = excluded.fetched_at`
    )
    .run({
      id: user.id,
      login: user.login,
      avatarUrl: user.avatar_url,
      name: user.name,
      company: user.company,
      location: user.location,
      email: user.email,
      bio: user.bio,
      twitterUsername: user.twitter_username,
      followers: user.followers,
      following: user.following,
      publicRepos: user.public_repos,
      publicGists: user.public_gists,
      blog: user.blog,
      hireable: user.hireable == null ? null : Number(user.hireable),
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      fetchedAt: nowIso()
    });
}

export function getCachedGithubUserByLogin(login: string) {
  return sqlite
    .prepare(
      `SELECT
        id,
        login,
        avatar_url AS avatarUrl,
        name,
        company,
        location,
        email,
        bio,
        twitter_username AS twitterUsername,
        followers_count AS followersCount,
        following_count AS followingCount,
        public_repos AS publicRepos,
        public_gists AS publicGists,
        blog,
        hireable,
        created_at AS createdAt,
        updated_at AS updatedAt,
        fetched_at AS fetchedAt
      FROM github_users
      WHERE lower(login) = lower(?)`
    )
    .get(login) as CachedGithubUser | undefined;
}

export async function ensureFreshGithubUser(token: string, login: string) {
  const cached = getCachedGithubUserByLogin(login);
  if (cached && hasHydratedProfile(cached) && isFresh(cached.fetchedAt, env.githubProfileCacheTtlDays)) {
    await geocodeUserIfNeeded(cached.id, cached.location);
    return cached;
  }

  const user = await getUser(token, login);
  upsertGithubUser(user);
  await geocodeUserIfNeeded(user.id, user.location);
  return getCachedGithubUserByLogin(user.login);
}

export function upsertGithubRepo(repo: GithubRepoListResult | GithubRepoSearchResult, latestCommit?: GithubCommitResult | null) {
  sqlite
    .prepare(
      `INSERT INTO github_repos (
        id, full_name, description, private, stargazers_count, owner_login, owner_avatar_url,
        html_url, homepage, language, forks_count, open_issues_count, created_at, updated_at, pushed_at,
        latest_commit_sha, latest_commit_url, latest_commit_message,
        latest_commit_author_login, latest_commit_author_avatar_url, latest_commit_author_url,
        latest_commit_author_name, latest_commit_at, fetched_at
      ) VALUES (
        @id, @fullName, @description, @private, @stargazersCount, @ownerLogin, @ownerAvatarUrl,
        @htmlUrl, @homepage, @language, @forksCount, @openIssuesCount, @createdAt, @updatedAt, @pushedAt,
        @latestCommitSha, @latestCommitUrl, @latestCommitMessage,
        @latestCommitAuthorLogin, @latestCommitAuthorAvatarUrl, @latestCommitAuthorUrl,
        @latestCommitAuthorName, @latestCommitAt, @fetchedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        description = excluded.description,
        private = excluded.private,
        stargazers_count = excluded.stargazers_count,
        owner_login = excluded.owner_login,
        owner_avatar_url = excluded.owner_avatar_url,
        html_url = excluded.html_url,
        homepage = excluded.homepage,
        language = excluded.language,
        forks_count = excluded.forks_count,
        open_issues_count = excluded.open_issues_count,
        created_at = COALESCE(excluded.created_at, github_repos.created_at),
        updated_at = excluded.updated_at,
        pushed_at = excluded.pushed_at,
        latest_commit_sha = excluded.latest_commit_sha,
        latest_commit_url = excluded.latest_commit_url,
        latest_commit_message = excluded.latest_commit_message,
        latest_commit_author_login = excluded.latest_commit_author_login,
        latest_commit_author_avatar_url = excluded.latest_commit_author_avatar_url,
        latest_commit_author_url = excluded.latest_commit_author_url,
        latest_commit_author_name = excluded.latest_commit_author_name,
        latest_commit_at = excluded.latest_commit_at,
        fetched_at = excluded.fetched_at`
    )
    .run({
      id: repo.id,
      fullName: repo.full_name,
      description: repo.description,
      private: Number(repo.private),
      stargazersCount: repo.stargazers_count,
      ownerLogin: repo.owner.login,
      ownerAvatarUrl: repo.owner.avatar_url,
      htmlUrl: repo.html_url,
      homepage: repo.homepage,
      language: repo.language,
      forksCount: repo.forks_count,
      openIssuesCount: repo.open_issues_count,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      latestCommitSha: latestCommit?.sha ?? null,
      latestCommitUrl: latestCommit?.html_url ?? null,
      latestCommitMessage: latestCommit?.commit.message ?? null,
      latestCommitAuthorLogin: latestCommit?.author?.login ?? null,
      latestCommitAuthorAvatarUrl: latestCommit?.author?.avatar_url ?? null,
      latestCommitAuthorUrl: latestCommit?.author?.html_url ?? null,
      latestCommitAuthorName: latestCommit?.commit.author?.name ?? null,
      latestCommitAt: latestCommit?.commit.author?.date ?? null,
      fetchedAt: nowIso()
    });
}

export function getCachedGithubRepoByFullName(fullName: string) {
  return sqlite
    .prepare(
      `SELECT
        id,
        full_name AS fullName,
        description,
        private,
        stargazers_count AS stargazersCount,
        owner_login AS ownerLogin,
        owner_avatar_url AS ownerAvatarUrl,
        html_url AS htmlUrl,
        homepage,
        language,
        forks_count AS forksCount,
        open_issues_count AS openIssuesCount,
        created_at AS createdAt,
        updated_at AS updatedAt,
        pushed_at AS pushedAt,
        latest_commit_sha AS latestCommitSha,
        latest_commit_url AS latestCommitUrl,
        latest_commit_message AS latestCommitMessage,
        latest_commit_author_login AS latestCommitAuthorLogin,
        latest_commit_author_avatar_url AS latestCommitAuthorAvatarUrl,
        latest_commit_author_url AS latestCommitAuthorUrl,
        latest_commit_author_name AS latestCommitAuthorName,
        latest_commit_at AS latestCommitAt,
        fetched_at AS fetchedAt
      FROM github_repos
      WHERE lower(full_name) = lower(?)`
    )
    .get(fullName) as CachedGithubRepo | undefined;
}

export async function ensureFreshGithubRepo(token: string, fullName: string) {
  const cached = getCachedGithubRepoByFullName(fullName);
  if (cached && isFresh(cached.fetchedAt, env.githubRepoCacheTtlDays)) return cached;

  const repo = await getRepo(token, fullName);
  const latestCommit = await getLatestCommit(token, fullName);
  upsertGithubRepo(repo, latestCommit);
  return getCachedGithubRepoByFullName(repo.full_name);
}
