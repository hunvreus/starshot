export type TargetKind = "repo_stargazers" | "user_followers";
export type SyncMode = "smart" | "full" | "profiles" | "clear";

export type AuthStatus = {
  authenticated: boolean;
  login: string | null;
  image: string | null;
  oauthConfigured: boolean;
  error: string | null;
};

export type Target = {
  id: number;
  kind: TargetKind;
  value: string;
  label: string;
  createdAt: string;
  description?: string | null;
  stargazersCount?: number | null;
  ownerLogin?: string | null;
  ownerAvatarUrl?: string | null;
  htmlUrl?: string | null;
  homepage?: string | null;
  language?: string | null;
  forksCount?: number | null;
  openIssuesCount?: number | null;
  repoCreatedAt?: string | null;
  repoUpdatedAt?: string | null;
  pushedAt?: string | null;
  latestCommitSha?: string | null;
  latestCommitUrl?: string | null;
  latestCommitMessage?: string | null;
  latestCommitAuthorLogin?: string | null;
  latestCommitAuthorAvatarUrl?: string | null;
  latestCommitAuthorUrl?: string | null;
  latestCommitAuthorName?: string | null;
  latestCommitAt?: string | null;
  avatarUrl?: string | null;
  name?: string | null;
  company?: string | null;
  location?: string | null;
  bio?: string | null;
  email?: string | null;
  twitterUsername?: string | null;
  blog?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  profileCreatedAt?: string | null;
  profileUpdatedAt?: string | null;
};

export type SyncRun = {
  id: number;
  targetId: number;
  mode: SyncMode;
  status: "queued" | "running" | "success" | "error" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  scannedCount: number;
  activeCount: number;
  removedCount: number;
};

export type GithubRateLimitStatus = {
  remaining: number | null;
  resetAt: string | null;
  resource: string;
  status: "normal" | "slowing" | "paused";
  updatedAt: string | null;
};

export type UserRow = {
  id: number;
  membershipId: number;
  sourceId: number;
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
  starredAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  inactiveAt: string | null;
  lastRunId: number;
  normalizedLocation: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodedAt: string | null;
};

export const userRowFields = [
  "id",
  "membershipId",
  "sourceId",
  "login",
  "avatarUrl",
  "name",
  "company",
  "location",
  "email",
  "bio",
  "twitterUsername",
  "followersCount",
  "followingCount",
  "publicRepos",
  "publicGists",
  "blog",
  "hireable",
  "createdAt",
  "updatedAt",
  "fetchedAt",
  "starredAt",
  "firstSeenAt",
  "lastSeenAt",
  "inactiveAt",
  "lastRunId",
  "normalizedLocation",
  "country",
  "countryCode",
  "latitude",
  "longitude",
  "geocodedAt"
] as const satisfies ReadonlyArray<keyof UserRow>;

export type UsersPage = {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
};

export type Stats = {
  totalActive: number;
  totalInactive: number;
  total: number;
  geocoded: number;
  weekNew: number;
  previousWeekNew: number;
  weekChange: number | null;
  countries: Array<{ label: string; count: number }>;
  locations: Array<{ login: string; label: string; latitude: number; longitude: number }>;
  trend: Array<{ date: string; cumulativeCount: number; newCount: number }>;
};

export type RepoSearchResult = {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
  stargazersCount: number;
  ownerAvatarUrl: string;
};

export type ProfileSearchResult = {
  id: number;
  login: string;
  avatarUrl: string;
  type: string;
  bio: string | null;
  followersCount: number | null;
};
