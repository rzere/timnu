/**
 * Minimal, typed AI Ark client (server-only). Docs: https://docs.ai-ark.com
 * Only the endpoints Timnu needs, with the costs from AI Ark's pricing table.
 */

const BASE = "https://api.ai-ark.com/api/developer-portal";

export const COST = {
  previewPage: 1, // flat per page of up to 100
  searchPerPerson: 0.5,
  companyPerResult: 0.1,
  emailFound: 1, // export/single, 0 when nothing found
} as const;

export class AiArkError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AiArkPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  trackId?: string | null;
}

/** The subset of AI Ark's person object Timnu reads. Preview masks last names. */
export interface AiArkPerson {
  id: string;
  identifier?: string;
  profile?: { first_name?: string; last_name?: string; full_name?: string; title?: string; headline?: string };
  link?: { linkedin?: string };
  location?: { short?: string; default?: string; country?: string };
  department?: { seniority?: string; departments?: string[] };
  company?: {
    id?: string;
    summary?: {
      name?: string;
      description?: string;
      industry?: string;
      staff?: { total?: number; range?: { start?: number; end?: number } };
    };
    link?: { domain?: string; website?: string; linkedin?: string };
    industries?: string[];
  };
  email?: { state?: string; output?: AiArkEmail[] };
}

export interface AiArkEmail {
  address?: string;
  found: boolean;
  status?: "VALID" | "INVALID";
  domainType?: "SMTP" | "CATCH_ALL" | "UNKNOWN";
  generic?: boolean;
  free?: boolean;
}

export interface AiArkCompany {
  id: string;
  summary?: { name?: string };
  link?: { domain?: string };
}

async function call<T>(key: string, path: string, init?: { body?: unknown }): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.body === undefined ? "GET" : "POST",
    headers: { "X-TOKEN": key, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  // AI Ark uses 404 for "no results / not found"; it is never charged.
  if (res.status === 404) return null;
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after")) || 0;
    throw new AiArkError(res.status, explain(res.status, await res.text().catch(() => ""), retry));
  }
  return (await res.json()) as T;
}

function explain(status: number, body: string, retryAfter: number): string {
  switch (status) {
    case 401:
      return "AI Ark rejected the API key.";
    case 402:
      return "The AI Ark account is out of credits.";
    case 429:
      return `AI Ark rate limit hit. Try again in ${retryAfter > 0 ? `${retryAfter}s` : "a moment"}.`;
    case 400:
      return `AI Ark refused the request: ${safeMessage(body)}`;
    default:
      return `AI Ark error ${status}.`;
  }
}

function safeMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string; error?: string };
    return String(j.message ?? j.error ?? "bad request").slice(0, 200);
  } catch {
    return "bad request";
  }
}

const emptyPage = <T>(): AiArkPage<T> => ({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 0 });

export function createAiArk(key: string) {
  return {
    credits: async () => (await call<{ total: number }>(key, "/v1/payments/credits"))?.total ?? 0,

    /** 1 credit per page; names come back masked. */
    previewPeople: async (filters: object, page: number, size = 25) =>
      (await call<AiArkPage<AiArkPerson>>(key, "/v1/people/preview", { body: { ...filters, page, size } })) ??
      emptyPage<AiArkPerson>(),

    /** 0.5 credits per returned person; same order as preview for the same filters. */
    searchPeople: async (filters: object, page: number, size = 25) =>
      (await call<AiArkPage<AiArkPerson>>(key, "/v1/people", { body: { ...filters, page, size } })) ??
      emptyPage<AiArkPerson>(),

    /** 0.1 credits per returned company. */
    lookalikeCompanies: async (domains: string[], account: object, size: number) =>
      (await call<AiArkPage<AiArkCompany>>(key, "/v1/companies", {
        body: { lookalikeDomains: domains, account, page: 0, size },
      })) ?? emptyPage<AiArkCompany>(),

    /** Full profile + verified email. 1 credit only when a valid email is found. */
    revealPerson: (id: string) => call<AiArkPerson>(key, "/v1/people/export/single", { body: { id } }),
  };
}
export type AiArk = ReturnType<typeof createAiArk>;
