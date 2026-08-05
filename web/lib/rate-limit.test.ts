import { describe, expect, it } from "vitest";

import {
  checkAccessRequestLimit,
  checkDemoSearchLimit,
  clientIpFrom,
} from "./rate-limit";

// Each test uses a unique IP so the module-level counters don't bleed
// across tests.

describe("clientIpFrom", () => {
  it("takes the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIpFrom(h)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "9.9.9.9" });
    expect(clientIpFrom(h)).toBe("9.9.9.9");
  });

  it("returns 'unknown' when no ip header is present", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("checkDemoSearchLimit", () => {
  it("allows up to 10 requests per IP then blocks with reason per-ip", () => {
    const ip = "demo-test-a";
    for (let i = 0; i < 10; i++) {
      expect(checkDemoSearchLimit(ip).allowed).toBe(true);
    }
    const blocked = checkDemoSearchLimit(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("per-ip");
  });

  it("tracks each IP independently", () => {
    const a = "demo-test-b";
    const b = "demo-test-c";
    for (let i = 0; i < 10; i++) checkDemoSearchLimit(a);
    // b is fresh, so its first request is still allowed.
    expect(checkDemoSearchLimit(b).allowed).toBe(true);
  });
});

describe("checkAccessRequestLimit", () => {
  it("allows 3 requests per IP then blocks", () => {
    const ip = "req-test-a";
    expect(checkAccessRequestLimit(ip)).toBe(true);
    expect(checkAccessRequestLimit(ip)).toBe(true);
    expect(checkAccessRequestLimit(ip)).toBe(true);
    expect(checkAccessRequestLimit(ip)).toBe(false);
  });
});
