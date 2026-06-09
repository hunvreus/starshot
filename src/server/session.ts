import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { auth } from "./auth";

export async function getSession(req: Request) {
  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });
}

export async function requireSession(req: Request) {
  const session = await getSession(req);
  if (!session?.user) throw new Error("Not authenticated");
  return session;
}

export async function getGithubAccessToken(req: Request) {
  const session = await requireSession(req);
  const token = await auth.api.getAccessToken({
    headers: fromNodeHeaders(req.headers),
    body: {
      providerId: "github"
    }
  });

  if (!token.accessToken) throw new Error("GitHub account is not linked");

  return {
    token: token.accessToken,
    github: token.accessToken,
    session
  };
}
