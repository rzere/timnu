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

/** The text Jev evaluates for one lead. */
export function jevState(icp: Icp, lead: Candidate): string {
  const want = [
    `Seller offers: ${icp.offer}`,
    `Target buyer titles: ${icp.titles.join(", ")}`,
    icp.seniority.length && `Target seniority: ${icp.seniority.join(", ")}`,
    icp.industries.length && `Target industries: ${icp.industries.join(", ")}`,
    icp.sizes.length && `Target company sizes (employees): ${icp.sizes.join(", ")}`,
    icp.locations.length && `Target locations: ${icp.locations.join(", ")}`,
  ].filter(Boolean);
  const c = lead.company;
  const have = [
    `Candidate title: ${lead.title}`,
    lead.headline && `Candidate headline: ${lead.headline}`,
    lead.seniority && `Candidate seniority: ${lead.seniority}`,
    lead.location && `Candidate location: ${lead.location}`,
    `Company: ${c.name}${c.industry ? ` (${c.industry})` : ""}${c.employees != null ? `, ${c.employees} employees` : ""}`,
    c.description && `Company description: ${c.description}`,
  ].filter(Boolean);
  return [...want, "", ...have].join("\n");
}

export const JEV_QUESTION =
  "Is this candidate a likely buyer or decision maker for what the seller offers, at a company that fits the target profile?";

interface JevAnswer {
  probability?: number;
  noul?: number;
  value?: number;
}

/**
 * Scores one lead with Jev through the Vercel AI Gateway.
 * https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev
 */
export async function jevFit(gatewayKey: string, icp: Icp, lead: Candidate, signal?: AbortSignal): Promise<number> {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "typesafe-ai/jev",
      state: jevState(icp, lead),
      questions: { fit: { type: "boolean", instructions: JEV_QUESTION } },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Jev error ${res.status}`);
  const json = (await res.json()) as { answers?: Record<string, JevAnswer> };
  const a = json.answers?.fit;
  const p = a?.probability ?? a?.noul ?? a?.value;
  if (typeof p !== "number" || Number.isNaN(p)) throw new Error("Jev returned no probability");
  return Math.min(1, Math.max(0, p));
}

/** Scores every lead: Jev when a gateway key is available, the heuristic otherwise or on failure. */
export async function scoreLeads(icp: Icp, leads: Candidate[], gatewayKey?: string): Promise<{ leads: Lead[]; jevError?: string }> {
  const scored: Lead[] = leads.map((l) => ({ ...l, fit: heuristicFit(icp, l) }));
  let jevError: string | undefined;
  if (gatewayKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      await mapLimit(scored, 5, async (lead) => {
        try {
          const p = await jevFit(gatewayKey, icp, lead, controller.signal);
          lead.fit = { score: round(p), source: "jev", reasons: lead.fit.reasons };
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
