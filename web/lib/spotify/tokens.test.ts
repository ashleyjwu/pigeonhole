import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAccountForUser, updateAccountTokens } from "@/lib/db/accounts";
import { getValidAccessToken } from "./tokens";

vi.mock("@/lib/db/accounts", () => ({
  getAccountForUser: vi.fn(),
  updateAccountTokens: vi.fn(),
}));

const mockedGetAccount = vi.mocked(getAccountForUser);
const mockedUpdateTokens = vi.mocked(updateAccountTokens);

function account(expiresInMs: number) {
  return {
    userId: "user-1",
    accessToken: "stored-access",
    refreshToken: "stored-refresh",
    accessExpiresAt: new Date(Date.now() + expiresInMs),
    scope: "user-read-private",
  };
}

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SPOTIFY_ID", "client-id");
  vi.stubEnv("AUTH_SPOTIFY_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getValidAccessToken", () => {
  it("returns the stored token while still fresh", async () => {
    mockedGetAccount.mockResolvedValue(account(10 * 60_000));
    const fetchSpy = fetchReturning(200, {});
    await expect(getValidAccessToken("user-1", fetchSpy)).resolves.toBe("stored-access");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedUpdateTokens).not.toHaveBeenCalled();
  });

  it("refreshes when the token is within the expiry margin", async () => {
    mockedGetAccount.mockResolvedValue(account(30_000)); // < 60s margin
    const fetchSpy = fetchReturning(200, { access_token: "new-access", expires_in: 3600 });
    await expect(getValidAccessToken("user-1", fetchSpy)).resolves.toBe("new-access");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchSpy).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=stored-refresh");

    expect(mockedUpdateTokens).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accessToken: "new-access", refreshToken: undefined }),
    );
  });

  it("persists a rotated refresh token when Spotify sends one", async () => {
    mockedGetAccount.mockResolvedValue(account(-1000)); // already expired
    const fetchSpy = fetchReturning(200, {
      access_token: "new-access",
      expires_in: 3600,
      refresh_token: "rotated-refresh",
    });
    await getValidAccessToken("user-1", fetchSpy);
    expect(mockedUpdateTokens).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ refreshToken: "rotated-refresh" }),
    );
  });

  it("throws when the refresh request fails", async () => {
    mockedGetAccount.mockResolvedValue(account(-1000));
    await expect(
      getValidAccessToken("user-1", fetchReturning(400, { error: "invalid_grant" })),
    ).rejects.toThrow(/HTTP 400/);
    expect(mockedUpdateTokens).not.toHaveBeenCalled();
  });

  it("throws when no account exists", async () => {
    mockedGetAccount.mockResolvedValue(null);
    await expect(getValidAccessToken("missing", fetchReturning(200, {}))).rejects.toThrow(
      /No Spotify account/,
    );
  });

  it("throws when client credentials are missing", async () => {
    vi.stubEnv("AUTH_SPOTIFY_ID", "");
    mockedGetAccount.mockResolvedValue(account(-1000));
    await expect(getValidAccessToken("user-1", fetchReturning(200, {}))).rejects.toThrow(
      /not set/,
    );
  });
});
