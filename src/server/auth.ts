import { betterAuth } from "better-auth";
import { sqlite } from "./db";
import { env, getBaseUrl } from "./env";

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  secret: env.betterAuthSecret,
  database: sqlite,
  socialProviders: {
    github: {
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
      scope: ["read:user"]
    }
  }
});
