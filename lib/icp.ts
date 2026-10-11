import { z } from "zod";

export const SENIORITIES = [
  "founder", "owner", "partner", "c_suite", "vp", "director",
  "head", "manager", "senior", "mid-level", "entry", "intern",
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const SIZE_BANDS = {
  "1-10": { start: 1, end: 10 },
  "11-50": { start: 11, end: 50 },
  "51-200": { start: 51, end: 200 },
  "201-1000": { start: 201, end: 1000 },
  "1001-5000": { start: 1001, end: 5000 },
  "5001+": { start: 5001 },
} as const satisfies Record<string, { start: number; end?: number }>;
export type SizeBand = keyof typeof SIZE_BANDS;
const SIZE_BAND_KEYS = Object.keys(SIZE_BANDS) as [SizeBand, ...SizeBand[]];

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (maxItems: number, maxLen = 80) =>
  z.array(text(maxLen)).max(maxItems).default([]);

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
  .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Not a domain"));

/** What the iPad asks. Everything maps onto AI Ark filters. */
export const IcpSchema = z.object({
  offer: text(400),
  titles: list(10).refine((t) => t.length > 0, "Tell Timnu who signs the check"),
  seniority: z.array(z.enum(SENIORITIES)).max(12).default([]),
  industries: list(10),
  sizes: z.array(z.enum(SIZE_BAND_KEYS)).max(6).default([]),
  locations: list(10),
  lookalikes: z.array(domain).max(5).default([]),
});
export type Icp = z.infer<typeof IcpSchema>;

/** Splits "a, b; c\nd" into trimmed, de-duplicated values. */
export function splitList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

type Json = Record<string, unknown>;
const smart = (content: string[]) => ({ any: { include: { mode: "SMART", content } } });

/**
 * Builds the AI Ark `account` + `contact` filter body for People Preview/Search.
 * `companyIds` (from a lookalike Company Search) narrows people to those accounts.
 */
export function toPeopleFilters(icp: Icp, companyIds: string[] = []): { account: Json; contact: Json } {
  const contact: Json = {
    experience: { latest: { title: smart(icp.titles) } },
  };
  if (icp.seniority.length) contact.seniority = { any: { include: icp.seniority } };
  if (icp.locations.length) contact.location = { any: { include: icp.locations } };
  if (companyIds.length) contact.company = { latest: { any: { include: companyIds.slice(0, 300) } } };

  return { account: toAccountFilters(icp), contact };
}

/** Company attributes shared by People and Company Search. */
export function toAccountFilters(icp: Icp): Json {
  const account: Json = {};
  if (icp.industries.length) account.industries = smart(icp.industries);
  if (icp.sizes.length) {
    account.employeeSize = { type: "RANGE", range: icp.sizes.map((s) => ({ ...SIZE_BANDS[s] })) };
  }
  return account;
}
