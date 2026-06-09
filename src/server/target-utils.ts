import type { TargetKind } from "../lib/types";

export function normalizeTarget(kind: TargetKind, value: string) {
  const trimmed = value.trim();

  if (kind === "repo_stargazers") {
    if (!/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
      throw new Error("Repository must use owner/repo format");
    }
    return trimmed;
  }

  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) {
    throw new Error("GitHub username can only contain letters, numbers, and hyphens");
  }
  return trimmed;
}

export function targetLabel(_kind: TargetKind, value: string) {
  return value;
}
