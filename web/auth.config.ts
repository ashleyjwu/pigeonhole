import type { NextAuthConfig } from "next-auth";
import Spotify from "next-auth/providers/spotify";

import { upsertUserWithAccount } from "@/lib/db/accounts";

/** Least-privilege scopes for pigeonhole (see spec requirement 2.1). */
const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-currently-playing",
  "user-library-read",
  "user-read-private",
].join(" ");

/**
 * Shared Auth.js configuration.
 *
 * Consumed by BOTH `auth.ts` (NextAuth helpers: auth/signIn/signOut) and the
 * route handler, which calls @auth/core's Auth() directly (see
 * app/api/auth/[...nextauth]/route.ts for why). Because the route handler
 * bypasses NextAuth's env inference, everything is explicit here: secret,
 * client id/secret, basePath.
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET,
  basePath: "/api/auth",
  trustHost: true,
  providers: [
    Spotify({
      clientId: process.env.AUTH_SPOTIFY_ID,
      clientSecret: process.env.AUTH_SPOTIFY_SECRET,
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: { scope: SPOTIFY_SCOPES },
      },
    }),
  ],
  callbacks: {
    /**
     * On first sign-in (when `account` is present), persist the user and the
     * encrypted tokens, then keep only our internal user id in the JWT.
     * Spotify tokens themselves never enter the session cookie.
     */
    async jwt({ token, account, profile }) {
      if (account) {
        if (!account.access_token || !account.refresh_token) {
          throw new Error("Spotify OAuth response is missing tokens");
        }
        const claims = (profile ?? {}) as Record<string, unknown>;
        const displayName =
          typeof claims.display_name === "string" ? claims.display_name : null;
        const email = typeof claims.email === "string" ? claims.email : null;
        token.userId = await upsertUserWithAccount({
          spotifyId: account.providerAccountId,
          displayName,
          email,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessExpiresAt: new Date((account.expires_at ?? 0) * 1000),
          scope: account.scope ?? "",
        });
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.userId = token.userId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
