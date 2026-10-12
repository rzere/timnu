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
    expect(a.limits).toEqual({ maxPages: 2, allowReveal: false, allowLookalikes: false, autoReveal: 5 });
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

describe("Jev key", () => {
  it("reads TYPESAFE_API_KEY, accepts AI_GATEWAY_API_KEY as a legacy name, and lets a visitor's key win", () => {
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123", TYPESAFE_API_KEY: "ts_server_1" }).jevKey).toBe("ts_server_1");
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123", AI_GATEWAY_API_KEY: "ts_legacy_1" }).jevKey).toBe("ts_legacy_1");
    expect(
      resolveAccess(h({ "x-typesafe-key": "ts_visitor_1" }), { AIARK_API_KEY: "server_key_123", TYPESAFE_API_KEY: "ts_server_1" }).jevKey,
    ).toBe("ts_visitor_1");
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123" }).jevKey).toBeUndefined();
  });
});

describe("demo mode and the server TypeSafe key", () => {
  it("doesn't lend the server's TypeSafe key to unmetered own-key requests", () => {
    const env = { AIARK_API_KEY: "server_key_123", TYPESAFE_API_KEY: "ts_server_1", TIMNU_DEMO: "1" };
    expect(resolveAccess(h({ "x-aiark-key": "visitor_key_456" }), env).jevKey).toBeUndefined();
    expect(resolveAccess(h({ "x-aiark-key": "visitor_key_456", "x-typesafe-key": "ts_visitor_1" }), env).jevKey).toBe("ts_visitor_1");
    expect(resolveAccess(h({ "x-aiark-key": "visitor_key_456" }), { ...env, TIMNU_DEMO: "" }).jevKey).toBe("ts_server_1");
  });
});

describe("auto-reveal budget", () => {
  it("defaults to 10 (own or server key) and 5 in demo, clamped to 0..25", () => {
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123" }).limits.autoReveal).toBe(10);
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123", TIMNU_AUTO_REVEAL: "0" }).limits.autoReveal).toBe(0);
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123", TIMNU_AUTO_REVEAL: "99" }).limits.autoReveal).toBe(25);
    expect(resolveAccess(h(), { AIARK_API_KEY: "server_key_123", TIMNU_AUTO_REVEAL: "lots" }).limits.autoReveal).toBe(10);
    const demo = { AIARK_API_KEY: "server_key_123", TIMNU_DEMO: "1", TIMNU_DEMO_AUTO_REVEAL: "3" };
    expect(resolveAccess(h({ "x-forwarded-for": "10.9.9.9" }), demo).limits.autoReveal).toBe(3);
    expect(resolveAccess(h({ "x-aiark-key": "visitor_key_456" }), demo).limits.autoReveal).toBe(10);
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
