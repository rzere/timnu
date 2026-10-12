/**
 * Where keys come from:
 *  - Self-hosted / open source: AIARK_API_KEY (and optionally TYPESAFE_API_KEY for Jev) in .env.local.
 *  - Public hosted deployment: the same env vars hold a shared demo key, and TIMNU_DEMO=1
 *    caps what anonymous visitors can spend.
 *  - Any visitor may paste their own AI Ark key in the app (sent per request in a header,
 *    never stored server-side). Requests using a visitor's own key are not capped.
 */

export interface Access {
  aiarkKey: string;
  /** TypeSafe API key for Jev scoring. */
  jevKey?: string;
  /** True when the request runs on the deployment's shared key under demo limits. */
  demo: boolean;
  limits: DemoLimits;
}

export interface DemoLimits {
  maxPages: number;
  allowReveal: boolean;
  allowLookalikes: boolean;
  /** Top-ranked leads per consult to reveal automatically (name, LinkedIn, verified email). */
  autoReveal: number;
}

type Env = Record<string, string | undefined>;

const flag = (v?: string) => v === "1" || v?.toLowerCase() === "true";

/** A whole number in [0, 25]; falls back when unset or invalid. */
const count = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isInteger(n) ? Math.min(25, Math.max(0, n)) : fallback;
};

export function fullLimits(env: Env = process.env): DemoLimits {
  return { maxPages: Infinity, allowReveal: true, allowLookalikes: true, autoReveal: count(env.TIMNU_AUTO_REVEAL, 10) };
}

export function demoLimits(env: Env = process.env): DemoLimits {
  return {
    maxPages: Math.max(1, Number(env.TIMNU_DEMO_MAX_PAGES) || 2),
    allowReveal: flag(env.TIMNU_DEMO_ALLOW_REVEAL),
    allowLookalikes: flag(env.TIMNU_DEMO_ALLOW_LOOKALIKES),
    autoReveal: count(env.TIMNU_DEMO_AUTO_REVEAL, 5),
  };
}

const KEY_RE = /^[A-Za-z0-9_\-.]{8,200}$/;

export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `bucket` separates rate limits: "unlock" is one request per star collected, so in demo mode it
 * allows (requests per hour × stars per run), the same credit ceiling as before.
 */
export function resolveAccess(headers: Headers, env: Env = process.env, bucket: "default" | "unlock" = "default"): Access {
  const own = headers.get("x-aiark-key")?.trim();
  const ownJev = headers.get("x-typesafe-key")?.trim();
  if (own && !KEY_RE.test(own)) throw new AccessError(400, "That doesn't look like an AI Ark API key.");
  if (ownJev && !KEY_RE.test(ownJev)) throw new AccessError(400, "That doesn't look like a TypeSafe API key.");

  const demo = flag(env.TIMNU_DEMO);
  if (own) {
    // Own-key requests aren't rate limited, so in demo mode they don't get the server's TypeSafe key either.
    return { aiarkKey: own, jevKey: ownJev || (demo ? undefined : serverJevKey(env)), demo: false, limits: fullLimits(env) };
  }
  const jevKey = ownJev || serverJevKey(env);

  const shared = env.AIARK_API_KEY?.trim();
  if (!shared) {
    throw new AccessError(401, "No AI Ark key. Set AIARK_API_KEY in .env.local, or paste your key in the app.");
  }
  if (demo) {
    const perHour = Number(env.TIMNU_DEMO_REQUESTS_PER_HOUR) || 10;
    rateLimit(`${bucket}:${clientIp(headers)}`, bucket === "unlock" ? perHour * Math.max(1, demoLimits(env).autoReveal) : perHour);
  }
  return { aiarkKey: shared, jevKey, demo, limits: demo ? demoLimits(env) : fullLimits(env) };
}

/** True when this request would run on the shared demo key (used to skip work without spending the rate limit). */
export function isSharedDemo(headers: Headers, env: Env = process.env): boolean {
  return flag(env.TIMNU_DEMO) && !headers.get("x-aiark-key")?.trim();
}

export function describeConfig(env: Env = process.env) {
  return {
    serverKey: !!env.AIARK_API_KEY?.trim(),
    jev: !!serverJevKey(env),
    demo: flag(env.TIMNU_DEMO),
    limits: flag(env.TIMNU_DEMO) ? { ...demoLimits(env) } : null,
    /** Leads revealed per consult on the server key, and with a visitor's own key. */
    autoReveal: { server: flag(env.TIMNU_DEMO) ? demoLimits(env).autoReveal : fullLimits(env).autoReveal, own: fullLimits(env).autoReveal },
  };
}

/** TYPESAFE_API_KEY, with AI_GATEWAY_API_KEY accepted as a legacy name for the same TypeSafe key. */
function serverJevKey(env: Env): string | undefined {
  return env.TYPESAFE_API_KEY?.trim() || env.AI_GATEWAY_API_KEY?.trim() || undefined;
}

function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/**
 * Best-effort, per-instance limiter for the shared demo key. Serverless instances don't share
 * memory, so pair it with your host's rate limiting (e.g. a Vercel Firewall rule) in production.
 */
const hits = new Map<string, number[]>();
export function rateLimit(id: string, perHour: number, now = Date.now()) {
  const recent = (hits.get(id) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= perHour) {
    throw new AccessError(429, "The demo oracle needs a rest. Paste your own AI Ark key to keep going.");
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > 10_000) hits.clear();
}
