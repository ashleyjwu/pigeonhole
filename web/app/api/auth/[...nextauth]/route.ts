import { Auth } from "@auth/core";

import { authConfig } from "@/auth.config";

/**
 * OAuth route handler, calling @auth/core directly with a plain Request.
 *
 * Why not NextAuth's `handlers`: the Next.js dev server reconstructs
 * `NextRequest.url` with its internal default hostname (`localhost`) even when
 * the browser is on `127.0.0.1`, and re-wrapping in NextRequest re-normalizes
 * the URL right back — so the OAuth token-exchange redirect_uri disagrees with
 * the authorization leg and Spotify rejects it (invalid_grant). A plain
 * `Request` preserves its URL exactly, and anchoring it on AUTH_URL keeps
 * every derived URL on one origin. When AUTH_URL is unset (e.g. Vercel, where
 * forwarded headers are correct), this is a pass-through.
 */
function anchoredRequest(request: Request): Request {
  const authUrl = process.env.AUTH_URL;
  if (!authUrl) {
    return request;
  }
  const { origin } = new URL(authUrl);
  const current = new URL(request.url);
  if (current.origin === origin) {
    return request;
  }
  return new Request(new URL(current.pathname + current.search, origin), request);
}

const handler = (request: Request): Promise<Response> =>
  Auth(anchoredRequest(request), authConfig);

export const GET = handler;
export const POST = handler;
