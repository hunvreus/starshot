import type { AuthStatus, GithubRateLimitStatus, ProfileSearchResult, RepoSearchResult, Stats, SyncMode, SyncRun, Target, TargetKind, UsersPage } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getAuthStatus() {
  return request<AuthStatus>("/api/session/status");
}

export function getTargets() {
  return request<Target[]>("/api/targets");
}

export function createTarget(kind: TargetKind, value: string) {
  return request<Target>("/api/targets", {
    method: "POST",
    body: JSON.stringify({ kind, value })
  });
}

export function removeTarget(targetId: number) {
  return request<{ ok: true }>(`/api/targets/${targetId}`, { method: "DELETE" });
}

export function searchRepos(q: string) {
  return request<RepoSearchResult[]>(`/api/github/repos?q=${encodeURIComponent(q)}`);
}

export function searchProfiles(q: string) {
  return request<ProfileSearchResult[]>(`/api/github/profiles?q=${encodeURIComponent(q)}`);
}

export function getViewerRepos() {
  return request<RepoSearchResult[]>("/api/github/viewer-repos");
}

export function getViewerProfile() {
  return request<ProfileSearchResult>("/api/github/viewer-profile");
}

export function getRuns() {
  return request<SyncRun[]>("/api/runs");
}

export function getRateLimitStatus() {
  return request<GithubRateLimitStatus>("/api/github/rate-limit-status");
}

export function startSync(targetId: number, mode: SyncMode = "smart") {
  return request<SyncRun>(`/api/targets/${targetId}/sync`, {
    method: "POST",
    body: JSON.stringify({ mode })
  });
}

export function getUsers(params: { targetId?: number; q?: string; active?: string; page?: number; pageSize?: number; sort?: string; direction?: string }) {
  const search = new URLSearchParams();
  if (params.targetId) search.set("targetId", String(params.targetId));
  if (params.q) search.set("q", params.q);
  if (params.active) search.set("active", params.active);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.sort) search.set("sort", params.sort);
  if (params.direction) search.set("direction", params.direction);
  return request<UsersPage>(`/api/users?${search.toString()}`);
}

export function getStats(targetId?: number) {
  const search = new URLSearchParams();
  if (targetId) search.set("targetId", String(targetId));
  return request<Stats>(`/api/stats?${search.toString()}`);
}
