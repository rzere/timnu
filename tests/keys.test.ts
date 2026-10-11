import { describe, expect, it } from "vitest";
import { AccessError, rateLimit, resolveAccess } from "@/lib/keys";

const h = (o: Record<string, string> = {}) => new Headers(o);

describe("resolveAccess", () => {
  it("uses the server key, uncapped, when demo mode is off", () => {
    const a = resolveAccess(h(), { AIARK_API_KEY: "server_key_123" });
    expect(a).toMatchObject({ aiarkKey: "server_key_123", demo: false });
    expect(a.limits.maxPages).toBe(Infinity);
  });

  it("caps the shared key in demo mode", () => {
    const a = resolveAccess(h({ "x-forwarded-for": "10.0.0.1" }), { AIARK_API_KEY: "server_key_123", TIMNU_DEMO: "1" });
    expect(a.demo).toBe(true);
    expect(a.limits).toEqual({ maxPages: 2, allowReveal: false, allowLookalikes: false });
  });

  it("prefers a visitor's own key and lifts demo caps", () => {
    const a = resolveAccess(h({ "x-aiark-key": "visitor_key_456" }), { AIARK_API_KEY: "server_key_123", TIMNU_DEMO: "1" });
    expect(a).toMatchObject({ aiarkKey: "visitor_key_456", demo: false });
  });

  it("errors without any key, and on malformed keys", () => {
    expect(() => resolveAccess(h(), {})).toThrow(AccessError);
    expect(() => resolveAccess(h({ "x-aiark-key": "has spaces in it" }), {})).toThrow(/doesn't look like/);
  });
});

describe("rateLimit", () => {
  it("allows N requests per hour per client", () => {
    const t = 1_000_000;
    rateLimit("ip-a", 2, t);
    rateLimit("ip-a", 2, t + 1);
    expect(() => rateLimit("ip-a", 2, t + 2)).toThrow(AccessError);
    expect(() => rateLimit("ip-a", 2, t + 3_600_001)).not.toThrow();
  });
});
