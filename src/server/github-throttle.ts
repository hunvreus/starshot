import { env } from "./env";

type RateState = {
  remaining: number;
  resetAt: number;
  resource: string;
  updatedAt: number;
};

type Waiter = {
  token: string;
  resolve: (release: () => void) => void;
};

const states = new Map<string, RateState>();
const tokenActive = new Map<string, number>();
const waiters: Waiter[] = [];
let active = 0;
let throttleQueue = Promise.resolve();

const resetBufferMs = 2000;

function tokenKey(token: string) {
  return token;
}

function msUntil(resetAt: number) {
  return Math.max(resetAt + resetBufferMs - Date.now() + jitterMs(), 1000);
}

function jitterMs() {
  return Math.floor(Math.random() * 500);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maxGlobalConcurrency() {
  return Math.max(1, Math.floor(env.githubHttpConcurrency));
}

function maxTokenConcurrency() {
  return Math.max(1, Math.floor(env.githubTokenConcurrency));
}

function throttleDelay(state: RateState | undefined) {
  if (!state || state.resource !== "core") return 0;
  if (state.remaining <= env.githubRateLimitPauseFloor) return msUntil(state.resetAt);
  if (state.remaining <= env.githubRateLimitSlowFloor) return 1000;
  return 0;
}

function canStart(token: string) {
  return active < maxGlobalConcurrency() && (tokenActive.get(token) ?? 0) < maxTokenConcurrency();
}

function releaseSlot(token: string) {
  active = Math.max(0, active - 1);
  const nextTokenActive = Math.max(0, (tokenActive.get(token) ?? 0) - 1);
  if (nextTokenActive === 0) tokenActive.delete(token);
  else tokenActive.set(token, nextTokenActive);
  pumpWaiters();
}

function pumpWaiters() {
  for (let index = 0; index < waiters.length; index += 1) {
    const waiter = waiters[index];
    if (!canStart(waiter.token)) continue;

    waiters.splice(index, 1);
    index -= 1;
    active += 1;
    tokenActive.set(waiter.token, (tokenActive.get(waiter.token) ?? 0) + 1);
    waiter.resolve(() => releaseSlot(waiter.token));
  }
}

function acquireSlot(token: string) {
  return new Promise<() => void>((resolve) => {
    waiters.push({ token, resolve });
    pumpWaiters();
  });
}

async function waitForBudgetAndReserve(token: string) {
  const key = tokenKey(token);
  const current = throttleQueue.then(async () => {
    const state = states.get(key);
    const delay = throttleDelay(state);
    if (delay > 0) await sleep(delay);
    if (state?.resource === "core") {
      state.remaining = Math.max(0, state.remaining - 1);
      state.updatedAt = Date.now();
    }
  });
  throttleQueue = current.catch(() => undefined);
  await current;
}

export async function acquireGithubRequest(token: string) {
  const key = tokenKey(token);
  const release = await acquireSlot(key);
  try {
    await waitForBudgetAndReserve(token);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export function retryAfterDelay(headers: Headers) {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000 + jitterMs();

  const remaining = headers.get("x-ratelimit-remaining");
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (remaining === "0" && Number.isFinite(reset)) return msUntil(reset * 1000);

  return null;
}

export function observeGithubRateLimit(token: string, headers: Headers) {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  const resource = headers.get("x-ratelimit-resource") ?? "core";

  if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return;

  states.set(tokenKey(token), {
    remaining,
    resetAt: reset * 1000,
    resource,
    updatedAt: Date.now()
  });
}

export function getGithubRateLimitStatus(token: string) {
  const state = states.get(tokenKey(token));
  if (!state || state.resource !== "core") {
    return {
      remaining: null,
      resetAt: null,
      resource: "core",
      status: "normal" as const,
      updatedAt: null
    };
  }

  const status =
    state.remaining <= env.githubRateLimitPauseFloor
      ? "paused"
      : state.remaining <= env.githubRateLimitSlowFloor
        ? "slowing"
        : "normal";

  return {
    remaining: state.remaining,
    resetAt: new Date(state.resetAt).toISOString(),
    resource: state.resource,
    status,
    updatedAt: new Date(state.updatedAt).toISOString()
  };
}
