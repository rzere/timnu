import { describe, expect, it } from "vitest";
import { IcpSchema, splitList, toPeopleFilters } from "@/lib/icp";

describe("splitList", () => {
  it("splits on commas, semicolons and newlines, trimming and de-duplicating", () => {
    expect(splitList(" Head of Product, VP Product;\nhead of product ,, CPO ")).toEqual(["Head of Product", "VP Product", "CPO"]);
  });
});

describe("IcpSchema", () => {
  it("requires at least one title", () => {
    expect(IcpSchema.safeParse({ offer: "x", titles: [] }).success).toBe(false);
  });

  it("normalizes lookalike domains and rejects junk", () => {
    const ok = IcpSchema.parse({ offer: "x", titles: ["CTO"], lookalikes: ["https://www.PostHog.com/pricing"] });
    expect(ok.lookalikes).toEqual(["posthog.com"]);
    expect(IcpSchema.safeParse({ offer: "x", titles: ["CTO"], lookalikes: ["not a domain"] }).success).toBe(false);
  });
});

describe("toPeopleFilters", () => {
  it("maps answers onto AI Ark's filter shape", () => {
    const icp = IcpSchema.parse({
      offer: "analytics",
      titles: ["Head of Product"],
      seniority: ["head", "vp"],
      industries: ["software development"],
      sizes: ["51-200", "5001+"],
      locations: ["United States"],
    });
    expect(toPeopleFilters(icp, ["4446fca0-f6b2-5c42-7783-92f7a1eeac7f"])).toEqual({
      contact: {
        experience: { latest: { title: { any: { include: { mode: "SMART", content: ["Head of Product"] } } } } },
        seniority: { any: { include: ["head", "vp"] } },
        location: { any: { include: ["United States"] } },
        company: { latest: { any: { include: ["4446fca0-f6b2-5c42-7783-92f7a1eeac7f"] } } },
      },
      account: {
        industries: { any: { include: { mode: "SMART", content: ["software development"] } } },
        employeeSize: { type: "RANGE", range: [{ start: 51, end: 200 }, { start: 5001 }] },
      },
    });
  });

  it("omits optional filters that weren't answered", () => {
    const f = toPeopleFilters(IcpSchema.parse({ offer: "x", titles: ["CTO"] }));
    expect(f.account).toEqual({});
    expect(Object.keys(f.contact)).toEqual(["experience"]);
  });
});
