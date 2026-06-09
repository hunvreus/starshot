import { acquireGithubRequest, observeGithubRateLimit, retryAfterDelay } from "./github-throttle";

type LinkMap = Record<string, string>;

export type GithubListUser = {
  login: string;
  id: number;
  avatar_url: string | null;
};

export type Stargazer = {
  user: GithubListUser;
  starred_at: string;
};

export type GithubPage<T> = {
  rows: T[];
  hasNextPage: boolean;
  nextCursor: string | null;
};

export type GithubUser = {
  id: number;
  login: string;
  avatar_url: string | null;
  name: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitter_username: string | null;
  followers: number | null;
  following: number | null;
  public_repos: number | null;
  public_gists: number | null;
  blog: string | null;
  hireable: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type GithubRepoSearchResult = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  stargazers_count: number;
  homepage: string | null;
  language: string | null;
  forks_count: number | null;
  open_issues_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  pushed_at: string | null;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
};

export type GithubRepoListResult = GithubRepoSearchResult;

export type GithubCommitResult = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string | null;
      date: string | null;
    } | null;
  };
  author: {
    login: string;
    avatar_url: string;
    html_url: string;
  } | null;
};

export type GithubProfileSearchResult = {
  id: number;
  login: string;
  avatar_url: string;
  type: string;
};

function parseLinks(header: string | null): LinkMap {
  if (!header) return {};
  const links: LinkMap = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number) {
  const exponential = 1000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(30_000, exponential) + Math.floor(Math.random() * 500);
}

function isRetryableFetchError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error instanceof TypeError || /fetch failed|network|socket|terminated|timeout|ECONNRESET|ETIMEDOUT/i.test(error.message);
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const errorWithCode = error as Error & { code?: unknown };
  const code = typeof errorWithCode.code === "string" ? ` code=${errorWithCode.code}` : "";
  const cause = (error as { cause?: unknown }).cause;
  return cause ? `${error.name}: ${error.message}${code}; cause: ${errorDetail(cause)}` : `${error.name}: ${error.message}${code}`;
}

async function request<T>(
  token: string,
  url: string,
  accept = "application/vnd.github+json"
): Promise<{
  data: T;
  links: LinkMap;
}> {
  let attempt = 0;

  while (true) {
    const release = await acquireGithubRequest(token);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "starshot-local"
        }
      });
    } catch (error) {
      release();
      attempt += 1;
      if (attempt >= 5 || !isRetryableFetchError(error)) {
        throw new Error(`GitHub request failed after ${attempt.toLocaleString()} attempt(s) for ${url}: ${errorDetail(error)}`);
      }
      await sleep(retryDelay(attempt));
      continue;
    }

    release();
    observeGithubRateLimit(token, response.headers);

    if (response.status === 403 || response.status === 429) {
      const delay = retryAfterDelay(response.headers);
      if (delay != null) {
        await sleep(delay);
        continue;
      }
    }

    if ((response.status === 408 || response.status >= 500) && attempt < 5) {
      attempt += 1;
      await sleep(retryDelay(attempt));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body}`);
    }

    return {
      data: (await response.json()) as T,
      links: parseLinks(response.headers.get("link"))
    };
  }
}

async function graphqlRequest<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  let attempt = 0;

  while (true) {
    const release = await acquireGithubRequest(token);
    let response: Response;

    try {
      response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "starshot-local"
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      release();
      attempt += 1;
      if (attempt >= 5 || !isRetryableFetchError(error)) {
        throw new Error(`GitHub GraphQL request failed after ${attempt.toLocaleString()} attempt(s): ${errorDetail(error)}`);
      }
      await sleep(retryDelay(attempt));
      continue;
    }

    release();
    observeGithubRateLimit(token, response.headers);

    if (response.status === 403 || response.status === 429) {
      const delay = retryAfterDelay(response.headers);
      if (delay != null) {
        await sleep(delay);
        continue;
      }
    }

    if ((response.status === 408 || response.status >= 500) && attempt < 5) {
      attempt += 1;
      await sleep(retryDelay(attempt));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub GraphQL API ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL error: ${payload.errors.map((error) => error.message ?? "Unknown error").join("; ")}`);
    }
    if (!payload.data) throw new Error("GitHub GraphQL response did not include data");
    return payload.data;
  }
}

export async function validateToken(token: string) {
  try {
    const viewer = await getViewer(token);
    return { valid: true, login: viewer.login, error: null };
  } catch (error) {
    return {
      valid: false,
      login: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function paginate<T>(token: string, url: string, accept?: string) {
  const rows: T[] = [];
  let next: string | undefined = url;

  while (next) {
    const page: { data: T[]; links: LinkMap } = await request<T[]>(token, next, accept);
    rows.push(...page.data);
    next = page.links.next;
  }

  return rows;
}

export function getViewer(token: string) {
  return request<GithubUser>(token, "https://api.github.com/user").then((response) => response.data);
}

export function getViewerRepos(token: string) {
  return request<GithubRepoListResult[]>(
    token,
    "https://api.github.com/user/repos?sort=updated&direction=desc&per_page=8"
  ).then((response) => response.data);
}

export function getRepo(token: string, repo: string) {
  return request<GithubRepoSearchResult>(token, `https://api.github.com/repos/${repo}`).then((response) => response.data);
}

export async function getLatestCommit(token: string, repo: string) {
  try {
    const commits = await request<GithubCommitResult[]>(
      token,
      `https://api.github.com/repos/${repo}/commits?per_page=1`
    ).then((response) => response.data);
    return commits[0] ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("GitHub API 409")) return null;
    throw error;
  }
}

export function getStargazers(token: string, repo: string) {
  return paginate<Stargazer>(
    token,
    `https://api.github.com/repos/${repo}/stargazers?per_page=100`,
    "application/vnd.github.star+json"
  );
}

export async function getNewestStargazersPage(token: string, repo: string, cursor: string | null): Promise<GithubPage<Stargazer>> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("Repository source must be owner/name");

  const data = await graphqlRequest<{
    repository: {
      stargazers: {
        edges: Array<{
          starredAt: string;
          node: {
            databaseId: number | null;
            login: string;
            avatarUrl: string;
          } | null;
        } | null>;
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
  }>(
    token,
    `query StarshotNewestStargazers($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        stargazers(first: 100, after: $cursor, orderBy: { field: STARRED_AT, direction: DESC }) {
          edges {
            starredAt
            node {
              databaseId
              login
              avatarUrl
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }`,
    { owner, name, cursor }
  );

  if (!data.repository) throw new Error(`GitHub repository not found: ${repo}`);

  return {
    rows: data.repository.stargazers.edges.flatMap((edge) => {
      if (!edge?.node?.databaseId) return [];
      return [{
        user: {
          id: edge.node.databaseId,
          login: edge.node.login,
          avatar_url: edge.node.avatarUrl
        },
        starred_at: edge.starredAt
      }];
    }),
    hasNextPage: data.repository.stargazers.pageInfo.hasNextPage,
    nextCursor: data.repository.stargazers.pageInfo.endCursor
  };
}

export function getFollowers(token: string, login: string) {
  return paginate<GithubListUser>(token, `https://api.github.com/users/${login}/followers?per_page=100`);
}

export function getUser(token: string, login: string) {
  return request<GithubUser>(token, `https://api.github.com/users/${login}`).then((response) => response.data);
}

export function searchGithubRepos(token: string, query: string) {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return request<{ items: GithubRepoSearchResult[] }>(
    token,
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=8`
  ).then((response) => response.data.items);
}

export function searchGithubProfiles(token: string, query: string) {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return request<{ items: GithubProfileSearchResult[] }>(
    token,
    `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=8`
  ).then((response) => response.data.items);
}
