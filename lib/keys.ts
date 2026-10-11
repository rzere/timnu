/**
 * Where keys come from:
 *  - Self-hosted / open source: AIARK_API_KEY (and optionally AI_GATEWAY_API_KEY) in .env.local.
 *  - Public hosted deployment: the same env vars hold a shared demo key, and TIMNU_DEMO=1
 *    caps what anonymous visitors can spend.
 *  - Any visitor may paste their own AI Ark key in the app (sent per request in a header,
 *    never stored server-side). Requests using a visitor's own key are not capped.
 */

export interface Access {
  aiarkKey: string;
  gatewayKey?: string;
  /** True when the request runs on the deployment's shared key under demo limits. */
  demo: boolean;
  limits: DemoLimits;
}

export interface DemoLimits {
  maxPages: number;
  allowReveal: boolean;
  allowLookalikes: boolean;
}

const UNLIMITED: DemoLimits = { maxPages: Infinity, allowReveal: true, allowLookalikes: true };

type Env = Record<string, string | undefined>;

const flag = (v?: string) => v === "1" || v?.toLowerCase() === "true";

export function demoLimits(env: Env = process.env): DemoLimits {
  return {
    maxPages: Math.max(1, Number(env.TIMNU_DEMO_MAX_PAGES) || 2),
    allowReveal: flag(env.TIMNU_DEMO_ALLOW_REVEAL),
    allowLookalikes: flag(env.TIMNU_DEMO_ALLOW_LOOKALIKES),
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

export function resolveAccess(headers: Headers, env: Env = process.env): Access {
  const own = headers.get("x-aiark-key")?.trim();
  const ownGateway = headers.get("x-gateway-key")?.trim();
  if (own && !KEY_RE.test(own)) throw new AccessError(400, "That doesn't look like an AI Ark API key.");
  if (ownGateway && !KEY_RE.test(ownGateway)) throw new AccessError(400, "That doesn't look like an AI Gateway key.");

  const gatewayKey = ownGateway || env.AI_GATEWAY_API_KEY || undefined;
  if (own) return { aiarkKey: own, gatewayKey, demo: false, limits: UNLIMITED };

  const shared = env.AIARK_API_KEY?.trim();
  if (!shared) {
    throw new AccessError(401, "No AI Ark key. Set AIARK_API_KEY in .env.local, or paste your key in the app.");
  }
  const demo = flag(env.TIMNU_DEMO);
  if (demo) rateLimit(clientIp(headers), Number(env.TIMNU_DEMO_REQUESTS_PER_HOUR) || 10);
  return { aiarkKey: shared, gatewayKey, demo, limits: demo ? demoLimits(env) : UNLIMITED };
}

export function describeConfig(env: Env = process.env) {
  return {
    serverKey: !!env.AIARK_API_KEY?.trim(),
    jev: !!env.AI_GATEWAY_API_KEY?.trim(),
    demo: flag(env.TIMNU_DEMO),
    limits: flag(env.TIMNU_DEMO) ? { ...demoLimits(env) } : null,
  };
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
