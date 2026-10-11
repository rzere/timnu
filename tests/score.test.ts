import { afterEach, describe, expect, it, vi } from "vitest";
import { IcpSchema } from "@/lib/icp";
import { bestEmail, cleanDomain, toLead } from "@/lib/leads";
import { heuristicFit, scoreLeads } from "@/lib/score";

const icp = IcpSchema.parse({
  offer: "Product analytics",
  titles: ["Head of Product"],
  seniority: ["head"],
  industries: ["software development"],
  sizes: ["51-200"],
});

// Shape of a People Preview person (AI Ark masks last names); values are made up.
const preview = {
  id: "001b2aed-3fd5-af5d-e0c1-398d492fe6ef",
  profile: { first_name: "Jordan", last_name: "Ex***e", title: "Head of Product", headline: "Head of Product @ Acme Analytics" },
  company: {
    id: "472bbb71-720a-7a03-799c-9dbdbbe74516",
    summary: { name: "Acme Analytics", industry: "software development", staff: { total: 69 } },
    link: { domain: "https://www.acme-analytics.example" },
  },
  location: { short: "Atlanta, Georgia" },
  department: { seniority: "head" },
};

describe("toLead", () => {
  it("maps a masked preview person", () => {
    const l = toLead(preview, true);
    expect(l).toMatchObject({ name: "Jordan Ex***e", masked: true, title: "Head of Product", seniority: "head", linkedin: null });
    expect(l.company).toMatchObject({ name: "Acme Analytics", domain: "acme-analytics.example", employees: 69 });
  });
});

describe("cleanDomain", () => {
  it("strips scheme, www and path", () => {
    expect(cleanDomain("https://www.Example.com/about")).toBe("example.com");
    expect(cleanDomain(undefined)).toBeNull();
  });
});

describe("heuristicFit", () => {
  it("scores an exact match highly and a mismatch lower", () => {
    const good = heuristicFit(icp, toLead(preview, true));
    const bad = heuristicFit(icp, toLead({ ...preview, profile: { title: "Office Manager" }, department: { seniority: "manager" } }, true));
    expect(good.score).toBeGreaterThan(0.9);
    expect(bad.score).toBeLessThan(0.5);
    expect(good.source).toBe("heuristic");
  });
});

describe("bestEmail", () => {
  it("prefers valid, non-generic SMTP addresses", () => {
    expect(
      bestEmail([
        { found: true, status: "VALID", address: "info@a.com", domainType: "SMTP", generic: true },
        { found: true, status: "VALID", address: "jo@a.com", domainType: "CATCH_ALL" },
        { found: true, status: "VALID", address: "jo.doe@a.com", domainType: "SMTP" },
        { found: false, status: "INVALID" },
      ]),
    ).toEqual({ address: "jo.doe@a.com", type: "SMTP", generic: false });
    expect(bestEmail([{ found: false }])).toBeNull();
  });
});

describe("scoreLeads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Jev probabilities when a gateway key is given", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answers: { fit: { probability: 0.42 } } }))));
    const { leads, jevError } = await scoreLeads(icp, [toLead(preview, true)], "gw_test_key");
    expect(jevError).toBeUndefined();
    expect(leads[0].fit).toMatchObject({ score: 0.42, source: "jev" });
  });

  it("falls back to the heuristic when Jev fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const { leads, jevError } = await scoreLeads(icp, [toLead(preview, true)], "gw_test_key");
    expect(jevError).toMatch(/503/);
    expect(leads[0].fit.source).toBe("heuristic");
  });
});
