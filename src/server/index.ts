import express from "express";
import { toNodeHandler } from "better-auth/node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { z } from "zod";
import { env, getBaseUrl } from "./env";
import { migrate } from "./db";
import { auth } from "./auth";
import { getGithubAccessToken, getSession, requireSession } from "./session";
import { createTarget, linkCachedTarget, listTargets, removeTarget } from "./targets";
import { getViewer, getViewerRepos, searchGithubProfiles, searchGithubRepos } from "./github";
import { ensureFreshGithubRepo, ensureFreshGithubUser, upsertGithubRepo, upsertGithubUser } from "./github-cache";
import { clearOrphanedRuns, listRuns, startSync, startSyncScheduler } from "./sync";
import { getStats, listAllUsers, listUsers } from "./search";
import { getGithubRateLimitStatus } from "./github-throttle";
import { userRowFields, type UserRow } from "../lib/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

migrate();
clearOrphanedRuns();
startSyncScheduler();

app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

function sendError(response: express.Response, error: unknown) {
  response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

app.get("/api/session/status", async (request, response) => {
  const oauthConfigured = Boolean(env.githubClientId && env.githubClientSecret);

  if (!oauthConfigured) {
    response.json({
      authenticated: false,
      login: null,
      oauthConfigured: false,
      error: "GitHub OAuth is not configured"
    });
    return;
  }

  const session = await getSession(request);
  response.json({
    authenticated: Boolean(session?.user),
    login: session?.user?.name ?? session?.user?.email ?? null,
    image: session?.user?.image ?? null,
    oauthConfigured,
    error: null
  });
});

function toRepoResult(repo: Awaited<ReturnType<typeof getViewerRepos>>[number]) {
  return {
    id: repo.id,
    fullName: repo.full_name,
    description: repo.description,
    private: repo.private,
    stargazersCount: repo.stargazers_count,
    ownerAvatarUrl: repo.owner.avatar_url
  };
}

app.get("/api/targets", async (request, response) => {
  try {
    const session = await requireSession(request);
    response.json(await listTargets(session.user.id));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/github/repos", async (request, response) => {
  try {
    const { github } = await getGithubAccessToken(request);
    const repos = await searchGithubRepos(github, String(request.query.q ?? ""));
    await Promise.all(repos.map((repo) => upsertGithubRepo(repo)));
    response.json(repos.map(toRepoResult));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/github/viewer-repos", async (request, response) => {
  try {
    const { github } = await getGithubAccessToken(request);
    const repos = await getViewerRepos(github);
    await Promise.all(repos.map((repo) => upsertGithubRepo(repo)));
    response.json(repos.map(toRepoResult));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/github/viewer-profile", async (request, response) => {
  try {
    const { github } = await getGithubAccessToken(request);
    const viewer = await getViewer(github);
    await upsertGithubUser(viewer);
    response.json({
      id: viewer.id,
      login: viewer.login,
      avatarUrl: `https://github.com/${viewer.login}.png`,
      type: "User",
      bio: viewer.bio,
      followersCount: viewer.followers
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/github/profiles", async (request, response) => {
  try {
    const { github } = await getGithubAccessToken(request);
    const profiles = await searchGithubProfiles(github, String(request.query.q ?? ""));
    const hydratedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ensureFreshGithubUser(github, profile.login);
        return {
          id: profile.id,
          login: profile.login,
          avatarUrl: profile.avatar_url,
          type: profile.type,
          bio: user?.bio ?? null,
          followersCount: user?.followersCount ?? null
        };
      })
    );
    response.json(hydratedProfiles);
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/github/viewer-target", async (request, response) => {
  try {
    const { session, github } = await getGithubAccessToken(request);
    const viewer = await getViewer(github);
    upsertGithubUser(viewer);
    const target = await createTarget(session.user.id, "user_followers", viewer.login);
    linkCachedTarget("user_followers", viewer.login);
    response.json(target);
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/targets", async (request, response) => {
  try {
    const { session, github } = await getGithubAccessToken(request);
    const body = z
      .object({
        kind: z.enum(["repo_stargazers", "user_followers"]),
        value: z.string().min(1)
      })
      .parse(request.body);
    if (body.kind === "repo_stargazers") {
      await ensureFreshGithubRepo(github, body.value);
    } else {
      await ensureFreshGithubUser(github, body.value);
    }
    response.json(await createTarget(session.user.id, body.kind, body.value));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/runs", async (request, response) => {
  try {
    const session = await requireSession(request);
    response.json(await listRuns(session.user.id));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/github/rate-limit-status", async (request, response) => {
  try {
    const { github } = await getGithubAccessToken(request);
    response.json(getGithubRateLimitStatus(github));
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/targets/:id/sync", async (request, response) => {
  try {
    const { session } = await getGithubAccessToken(request);
    const body = z.object({ mode: z.enum(["smart", "full", "profiles", "clear"]).optional() }).parse(request.body ?? {});
    response.json(await startSync(session.user.id, Number(request.params.id), body.mode ?? "smart"));
  } catch (error) {
    sendError(response, error);
  }
});

app.delete("/api/targets/:id", async (request, response) => {
  try {
    const session = await requireSession(request);
    await removeTarget(session.user.id, Number(request.params.id));
    response.json({ ok: true });
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/users", async (request, response) => {
  try {
    const session = await requireSession(request);
    response.json(
      await listUsers(session.user.id, {
        targetId: request.query.targetId ? Number(request.query.targetId) : undefined,
        q: request.query.q ? String(request.query.q) : undefined,
        active: request.query.active ? String(request.query.active) : undefined,
        page: request.query.page ? Number(request.query.page) : undefined,
        pageSize: request.query.pageSize ? Number(request.query.pageSize) : undefined,
        sort: request.query.sort ? String(request.query.sort) : undefined,
        direction: request.query.direction ? String(request.query.direction) : undefined
      })
    );
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/stats", async (request, response) => {
  try {
    const session = await requireSession(request);
    response.json(await getStats(session.user.id, request.query.targetId ? Number(request.query.targetId) : undefined));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/export.csv", async (request, response) => {
  try {
    const session = await requireSession(request);
    const rows = (await listAllUsers(session.user.id, {
      targetId: request.query.targetId ? Number(request.query.targetId) : undefined,
      active: request.query.active ? String(request.query.active) : undefined
    })) as UserRow[];
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [userRowFields.join(","), ...rows.map((row) => userRowFields.map((field) => escape(row[field])).join(","))].join("\n");
    response.header("Content-Type", "text/csv");
    response.header("Content-Disposition", "attachment; filename=starshot.csv");
    response.send(csv);
  } catch (error) {
    sendError(response, error);
  }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(__dirname, "../../dist/client");
  app.use(express.static(dist));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(dist, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.listen(env.port, env.host, () => {
  console.log(`starshot running at ${getBaseUrl()}`);
});
