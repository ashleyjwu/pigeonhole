/**
 * App-only Spotify access token via the Client Credentials flow — used for
 * public demo search, which hits /search (a non-user endpoint) with no user
 * login and no allowlist involvement.
 *
 * Uses a SEPARATE demo client id/secret when provided (DEMO_SPOTIFY_ID /
 * DEMO_SPOTIFY_SECRET) so demo traffic can be reasoned about and throttled
 * independently of the owner's personal app. Note: as of July 2026 Spotify
 * counts quota per developer ACCOUNT, so a separate client id does not fully
 * isolate quota — hence the rate limiting in lib/rate-limit.ts.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const EXPIRY_MARGIN_MS = 60_000;

let cached: { token: string; expiresAt: number } | undefined;

export async function getAppAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  const clientId = process.env.DEMO_SPOTIFY_ID ?? process.env.AUTH_SPOTIFY_ID;
  const clientSecret = process.env.DEMO_SPOTIFY_SECRET ?? process.env.AUTH_SPOTIFY_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "DEMO_SPOTIFY_ID / DEMO_SPOTIFY_SECRET (or AUTH_SPOTIFY_ID / AUTH_SPOTIFY_SECRET) are not set",
    );
  }

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    throw new Error(`Spotify client-credentials token failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cached.token;
}
