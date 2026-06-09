import dotenv from "dotenv";

dotenv.config();

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubProfileCacheTtlDays: numberEnv("GITHUB_PROFILE_CACHE_TTL_DAYS", 90),
  githubRepoCacheTtlDays: numberEnv("GITHUB_REPO_CACHE_TTL_DAYS", 1),
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "starshot-local-dev-secret-change-me",
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "",
  geocodingEnabled: process.env.GEOCODING_ENABLED === "true",
  geocodingProvider: process.env.GEOCODING_PROVIDER ?? "nominatim",
  geocodingEmail: process.env.GEOCODING_EMAIL ?? "",
  geocodingCacheTtlDays: numberEnv("GEOCODING_CACHE_TTL_DAYS", 0),
  githubProfileConcurrency: numberEnv("GITHUB_PROFILE_CONCURRENCY", 16),
  syncConcurrency: numberEnv("SYNC_CONCURRENCY", 4),
  githubHttpConcurrency: numberEnv("GITHUB_HTTP_CONCURRENCY", 40),
  githubTokenConcurrency: numberEnv("GITHUB_TOKEN_CONCURRENCY", 10),
  githubRateLimitSlowFloor: numberEnv("GITHUB_RATE_LIMIT_SLOW_FLOOR", 500),
  githubRateLimitPauseFloor: numberEnv("GITHUB_RATE_LIMIT_PAUSE_FLOOR", 100),
  syncKnownBoundaryCount: numberEnv("SYNC_KNOWN_BOUNDARY_COUNT", 200),
  updateProbeMaxPages: numberEnv("UPDATE_PROBE_MAX_PAGES", 5),
  port: Number(process.env.PORT ?? "5173"),
  host: process.env.HOST ?? "127.0.0.1"
};

export function getBaseUrl() {
  if (env.betterAuthUrl) return env.betterAuthUrl;
  return `http://${env.host}:${env.port}`;
}
