import { afterEach, describe, expect, it, vi } from "vitest";
import { IcpSchema } from "@/lib/icp";
import { bestEmail, cleanDomain, csvCell, safeLinkedin, toLead } from "@/lib/leads";
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

describe("untrusted third-party values", () => {
  it("only keeps https LinkedIn URLs", () => {
    expect(safeLinkedin("https://www.linkedin.com/in/someone")).toBe("https://www.linkedin.com/in/someone");
    expect(safeLinkedin("javascript:alert(1)")).toBeNull();
    expect(safeLinkedin("https://evil.example/linkedin.com/")).toBeNull();
  });

  it("neutralizes spreadsheet formulas in CSV cells", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("Head of Product")).toBe('"Head of Product"');
    expect(csvCell(0.94)).toBe('"0.94"');
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

  it("calls TypeSafe with noul questions and combines the answers with code weights", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            buyer_role: { type: "noul", noul: 0.9 },
            company_need: { type: "noul", noul: 0.5 },
            icp_match: { type: "noul", noul: 1 },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { leads, jevError } = await scoreLeads(icp, [toLead(preview, true)], "ts_test_key");
    expect(jevError).toBeUndefined();
    // 0.5 * 0.9 + 0.3 * 0.5 + 0.2 * 1 = 0.8
    expect(leads[0].fit).toMatchObject({ score: 0.8, source: "jev" });
    expect(leads[0].fit.reasons[0]).toBe("Jev: buyer role 0.90, company need 0.50, ICP match 1.00");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ts_test_key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-latest");
    expect(Object.values(body.questions).every((q) => (q as { type: string }).type === "noul")).toBe(true);
    expect(body.state.candidate).toMatchObject({ title: "Head of Product", company: { name: "Acme Analytics" } });
    expect(body.state.seller).toMatchObject({ offer: "Product analytics", target_buyer_titles: ["Head of Product"] });
  });

  it("falls back to the heuristic when Jev fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const { leads, jevError } = await scoreLeads(icp, [toLead(preview, true)], "ts_test_key");
    expect(jevError).toMatch(/503/);
    expect(leads[0].fit.source).toBe("heuristic");
  });
});
