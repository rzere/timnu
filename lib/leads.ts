import type { AiArkEmail, AiArkPerson } from "./aiark";

export interface Lead {
  id: string;
  name: string;
  masked: boolean;
  title: string;
  headline: string;
  seniority: string;
  location: string;
  linkedin: string | null;
  company: {
    name: string;
    domain: string | null;
    industry: string;
    employees: number | null;
    description: string;
  };
  fit: Fit;
  email?: { address: string; type: string; generic: boolean } | null;
}

export interface Fit {
  score: number; // 0..1
  source: "jev" | "heuristic";
  reasons: string[];
}

export function cleanDomain(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return d || null;
}

export function toLead(p: AiArkPerson, masked: boolean): Omit<Lead, "fit"> {
  const profile = p.profile ?? {};
  const c = p.company ?? {};
  const name = profile.full_name ?? [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return {
    id: p.id,
    name: name || "Unknown",
    masked,
    title: profile.title ?? "",
    headline: profile.headline ?? "",
    seniority: p.department?.seniority ?? "",
    location: p.location?.short ?? p.location?.default ?? "",
    linkedin: p.link?.linkedin ?? null,
    company: {
      name: c.summary?.name ?? "",
      domain: cleanDomain(c.link?.domain ?? c.link?.website),
      industry: c.summary?.industry ?? c.industries?.[0] ?? "",
      employees: c.summary?.staff?.total ?? null,
      description: (c.summary?.description ?? "").slice(0, 600),
    },
  };
}

export function bestEmail(outputs: AiArkEmail[] | undefined): Lead["email"] {
  const valid = (outputs ?? []).filter((e) => e.found && e.status === "VALID" && e.address);
  // Prefer deliverable personal addresses: SMTP over catch-all, non-generic over role inboxes.
  valid.sort((a, b) => rank(a) - rank(b));
  const e = valid[0];
  return e ? { address: e.address!, type: e.domainType ?? "UNKNOWN", generic: !!e.generic } : null;
}

const rank = (e: AiArkEmail) => (e.domainType === "SMTP" ? 0 : 1) + (e.generic ? 2 : 0);
