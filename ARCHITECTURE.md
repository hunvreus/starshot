# Architecture

## Runtime shape

starshot is a TypeScript web app. A Node/Express server serves explicit JSON API routes and Vite serves the React client during development.

The intended runtime is local: one Node process with a SQLite database at `data/starshot.sqlite`.

## Authentication

Better Auth manages local users, sessions, and linked GitHub OAuth accounts.

starshot uses a GitHub OAuth App with minimal scopes for login and GitHub API access. A local user owns source links, while public GitHub entity data and source membership data are shared globally.

## Data flow

1. Add a source: repository stargazers or user followers.
2. Start an update run.
3. The server reconciles the GitHub membership list for that source.
4. Membership rows are inserted, reactivated, or marked removed.
5. Public user profile metadata is refreshed by separate profile refresh runs.
6. Search, stats, charts, and CSV export read from SQLite.

## Sync invariants

Follower and stargazer lists are reconciled as source memberships. A completed full reconciliation marks users missing from the authoritative GitHub list as removed instead of assuming pagination positions are stable.

Update runs are queued in SQLite. The request creates or returns a `queued`/`running` run and returns immediately. An in-process scheduler claims queued runs up to `SYNC_CONCURRENCY`, defaulting to 4 for local use. If the process restarts mid-update, stale `running` rows are moved back to `queued` on startup.

Sync runs have four modes: `smart`, `full`, `profiles`, and `clear`. `smart` is the default update mode.

Repository smart sync fetches GitHub's current stargazer total, probes newest stargazers with GraphQL `STARRED_AT DESC`, and computes the expected removal count from the local active count, newly observed stargazers, and GitHub's total. It stops early when counts already match or when the scanned prefix exactly explains the expected removals. If the proof is incomplete, it falls back to full reconciliation.

Follower smart sync performs full reconciliation when exact inactive marking is required. GitHub follower lists do not expose stable follow timestamps, so a bounded head probe can add obvious new followers but cannot prove old removals safely.

The optimized repository update probe scans up to `UPDATE_PROBE_MAX_PAGES` pages and stops after `SYNC_KNOWN_BOUNDARY_COUNT` consecutive known active stargazers when that is enough to prove the delta.

Full sync refreshes source metadata, fetches the complete GitHub list, and marks missing active memberships inactive. Clear mode deletes local membership rows for the source without calling GitHub, so the next update rebuilds from GitHub. Profile refresh runs are separate and update stale cached GitHub user profiles with bounded concurrency controlled by `GITHUB_PROFILE_CONCURRENCY`.

GitHub HTTP concurrency is process-wide. `GITHUB_HTTP_CONCURRENCY` caps total in-flight GitHub requests, defaulting to 40, and `GITHUB_TOKEN_CONCURRENCY` caps in-flight GitHub requests per token. GitHub rate-limit throttling is also token-aware: every GitHub response updates the in-memory budget for that token. Requests slow down below `GITHUB_RATE_LIMIT_SLOW_FLOOR` and pause until reset below `GITHUB_RATE_LIMIT_PAUSE_FLOOR`. The limiter optimistically reserves one remaining request before dispatch, honors `Retry-After` on `403`/`429`, and adds a small reset buffer with jitter. This coordinates simultaneous update runs inside one Node process, but it is not cross-process coordination.

## Cache freshness

- `GITHUB_PROFILE_CACHE_TTL_DAYS` defaults to 90.
- `GITHUB_REPO_CACHE_TTL_DAYS` defaults to 1.
- `GEOCODING_CACHE_TTL_DAYS` defaults to 0, meaning geocodes do not expire.
- A TTL of 0 keeps cached records indefinitely.

## Location normalization

Geocoding is optional and controlled by environment variables. The supported provider is OpenStreetMap Nominatim. When enabled, profile refresh stores normalized location text, country, country code, latitude, longitude, and geocode timestamp on each GitHub user. The raw GitHub location remains unchanged.

## Persistence

SQLite is initialized from the single SQL migration file at `src/server/db/migration.sql`. Drizzle schema definitions live in `src/server/db/schema.ts` for typed model shape.

Public GitHub data is normalized into shared cache tables:

- `github_users`: public profile cache shared across sources and local users.
- `github_repos`: public repository metadata cache shared across local users.
- `sources`: canonical watched repositories/profiles.
- `user_sources`: per-local-user links to shared sources.
- `source_memberships`: shared stargazer/follower rows for each source.
- `sync_runs`: SQLite-backed sync queue, attempts, and counts.

## React

React Server Components are intentionally not used.
