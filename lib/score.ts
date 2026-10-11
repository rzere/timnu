import type { Icp } from "./icp";
import { SIZE_BANDS } from "./icp";
import type { Fit, Lead } from "./leads";

type Candidate = Omit<Lead, "fit">;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+ ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
const STOP = new Set(["of", "and", "the", "for", "at", "in", "&", "to"]);

/** Share of the best-matching wanted phrase's words found in `have`. */
function overlap(wanted: string[], have: string): number {
  const got = new Set(words(have));
  let best = 0;
  for (const phrase of wanted) {
    const w = words(phrase);
    if (!w.length) continue;
    best = Math.max(best, w.filter((x) => got.has(x)).length / w.length);
  }
  return best;
}

/**
 * Free, deterministic fit score. AI Ark already filtered on titles, industry,
 * size and location, so this mostly ranks how closely each lead matches.
 */
export function heuristicFit(icp: Icp, lead: Candidate): Fit {
  const reasons: string[] = [];
  const parts: Array<[weight: number, value: number]> = [];

  const title = Math.max(overlap(icp.titles, lead.title), 0.8 * overlap(icp.titles, lead.headline));
  parts.push([0.5, title]);
  if (title >= 0.99) reasons.push(`Title matches “${lead.title}”`);
  else if (title > 0) reasons.push(`Title is close: “${lead.title || lead.headline}”`);

  if (icp.seniority.length) {
    const ok = icp.seniority.includes(lead.seniority as Icp["seniority"][number]);
    parts.push([0.2, ok ? 1 : 0]);
    if (ok) reasons.push(`Seniority: ${lead.seniority.replace("_", "-")}`);
  }

  if (icp.sizes.length && lead.company.employees != null) {
    const n = lead.company.employees;
    const ok = icp.sizes.some((s) => {
      const b: { start: number; end?: number } = SIZE_BANDS[s];
      return n >= b.start && (b.end === undefined || n <= b.end);
    });
    parts.push([0.15, ok ? 1 : 0.4]);
    if (ok) reasons.push(`${n.toLocaleString("en-US")} employees`);
  }

  if (icp.industries.length) {
    const ind = overlap(icp.industries, `${lead.company.industry} ${lead.company.description}`);
    parts.push([0.15, Math.max(ind, 0.5)]); // AI Ark's SMART match already vouched for it
    if (ind > 0 && lead.company.industry) reasons.push(`Industry: ${lead.company.industry}`);
  }

  const total = parts.reduce((s, [w]) => s + w, 0);
  const score = parts.reduce((s, [w, v]) => s + w * v, 0) / total;
  return { score: round(score), source: "heuristic", reasons };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Structured state for one lead; questions refer to its fields by name. */
export function jevState(icp: Icp, lead: Candidate) {
  const c = lead.company;
  return {
    seller: {
      offer: icp.offer,
      target_buyer_titles: icp.titles,
      ...(icp.seniority.length && { target_seniority: icp.seniority }),
      ...(icp.industries.length && { target_industries: icp.industries }),
      ...(icp.sizes.length && { target_company_sizes: icp.sizes.map((s) => `${s} employees`) }),
      ...(icp.locations.length && { target_locations: icp.locations }),
    },
    candidate: {
      title: lead.title,
      ...(lead.headline && { headline: lead.headline }),
      ...(lead.seniority && { seniority: lead.seniority }),
      ...(lead.location && { location: lead.location }),
      company: {
        name: c.name,
        ...(c.industry && { industry: c.industry }),
        ...(c.employees != null && { employees: c.employees }),
        ...(c.description && { description: c.description }),
      },
    },
  };
}

/**
 * Atomic yes/no ("noul") questions, combined with weights in code, following TypeSafe's
 * composite-scoring pattern: https://docs.typesafe.ai/patterns/composite-scoring
 */
export const JEV_QUESTIONS = {
  buyer_role: {
    weight: 0.5,
    label: "buyer role",
    instructions:
      "Is `candidate` in a role that would decide on, or champion, buying what `seller.offer` describes?",
  },
  company_need: {
    weight: 0.3,
    label: "company need",
    instructions: "Would `candidate.company` plausibly need what `seller.offer` describes?",
  },
  icp_match: {
    weight: 0.2,
    label: "ICP match",
    instructions:
      "Does `candidate` match the seller's target profile (`seller` titles, seniority, industries, company sizes and locations, where given)?",
  },
} as const;
type JevQuestion = keyof typeof JEV_QUESTIONS;

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

/** Scores one lead with Jev (TypeSafe). Returns the weighted fit and each atomic answer. */
export async function jevFit(
  apiKey: string,
  icp: Icp,
  lead: Candidate,
  signal?: AbortSignal,
): Promise<{ score: number; parts: Record<JevQuestion, number> }> {
  const questions = Object.fromEntries(
    Object.entries(JEV_QUESTIONS).map(([id, q]) => [id, { type: "noul", instructions: q.instructions }]),
  );
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: jevState(icp, lead), questions }),
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new Error("TypeSafe rejected the API key");
  if (res.status === 429) throw new Error("TypeSafe rate limit hit");
  if (!res.ok) throw new Error(`Jev error ${res.status}`);
  const json = (await res.json()) as { answers?: Record<string, { noul?: number }> };

  const parts = {} as Record<JevQuestion, number>;
  let score = 0;
  for (const [id, q] of Object.entries(JEV_QUESTIONS) as [JevQuestion, (typeof JEV_QUESTIONS)[JevQuestion]][]) {
    const p = json.answers?.[id]?.noul;
    if (typeof p !== "number" || Number.isNaN(p)) throw new Error("Jev returned no answer");
    parts[id] = Math.min(1, Math.max(0, p));
    score += q.weight * parts[id];
  }
  return { score, parts };
}

/** Scores every lead: Jev when a TypeSafe key is available, the heuristic otherwise or on failure. */
export async function scoreLeads(icp: Icp, leads: Candidate[], jevKey?: string): Promise<{ leads: Lead[]; jevError?: string }> {
  const scored: Lead[] = leads.map((l) => ({ ...l, fit: heuristicFit(icp, l) }));
  let jevError: string | undefined;
  if (jevKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      await mapLimit(scored, 5, async (lead) => {
        try {
          const { score, parts } = await jevFit(jevKey, icp, lead, controller.signal);
          const why = (Object.keys(parts) as JevQuestion[]).map((id) => `${JEV_QUESTIONS[id].label} ${parts[id].toFixed(2)}`);
          lead.fit = { score: round(score), source: "jev", reasons: [`Jev: ${why.join(", ")}`] };
        } catch (e) {
          jevError ??= e instanceof Error ? e.message : String(e);
        }
      });
    } finally {
      clearTimeout(timer);
    }
  }
  scored.sort((a, b) => b.fit.score - a.fit.score);
  return { leads: scored, jevError };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
