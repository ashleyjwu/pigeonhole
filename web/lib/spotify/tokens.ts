/**
 * Server-side Spotify access-token management.
 *
 * Always call `getValidAccessToken` before hitting the Spotify API: it returns
 * the stored token while fresh and transparently refreshes it (persisting the
 * result) once it is within the expiry margin.
 */

import { getAccountForUser, updateAccountTokens } from "@/lib/db/accounts";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Refresh this long before actual expiry to avoid mid-request 401s. */
const EXPIRY_MARGIN_MS = 60_000;

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export async function getValidAccessToken(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const account = await getAccountForUser(userId);
  if (!account) {
    throw new Error(`No Spotify account stored for user ${userId}`);
  }

  if (account.accessExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()) {
    return account.accessToken;
  }

  const clientId = process.env.AUTH_SPOTIFY_ID;
  const clientSecret = process.env.AUTH_SPOTIFY_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_SPOTIFY_ID / AUTH_SPOTIFY_SECRET are not set");
  }

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as RefreshResponse;
  await updateAccountTokens(userId, {
    accessToken: data.access_token,
    accessExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    // Spotify occasionally rotates the refresh token; persist it when sent.
    refreshToken: data.refresh_token,
  });
  return data.access_token;
}
