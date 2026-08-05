import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAccessRequestEmail } from "./email";

const REQUEST = { name: "Jamie", email: "jamie@example.com", message: "hi!" };

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.ACCESS_REQUEST_EMAIL;
});

describe("sendAccessRequestEmail", () => {
  it("does not call fetch when Resend is not configured", async () => {
    const fetchImpl = vi.fn();
    await sendAccessRequestEmail(REQUEST, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to Resend with auth and the request details when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.ACCESS_REQUEST_EMAIL = "owner@example.com";
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );

    await sendAccessRequestEmail(REQUEST, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    const url = call[0];
    const init = call[1]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.reply_to).toBe("jamie@example.com");
    expect(body.text).toContain("Jamie");
    expect(body.text).toContain("hi!");
  });

  it("throws when Resend returns a non-ok status", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.ACCESS_REQUEST_EMAIL = "owner@example.com";
    const fetchImpl = vi.fn(async () => new Response(null, { status: 422 }));

    await expect(
      sendAccessRequestEmail(REQUEST, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 422/);
  });
});
