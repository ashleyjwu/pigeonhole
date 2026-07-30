/**
 * Persistence for users and their encrypted Spotify tokens.
 *
 * Tokens are encrypted with AES-256-GCM before touching the database and
 * decrypted only server-side. Nothing here is ever sent to the client.
 */

import { decryptToken, encryptToken } from "@/lib/crypto";
import { getPool } from "@/lib/db/pool";

export interface UpsertUserInput {
  spotifyId: string;
  displayName: string | null;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  scope: string;
}

export interface SpotifyAccount {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  scope: string;
}

/** Create or update the user + account rows. Returns the internal user id. */
export async function upsertUserWithAccount(input: UpsertUserInput): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (spotify_id, display_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (spotify_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             email = EXCLUDED.email
       RETURNING id`,
      [input.spotifyId, input.displayName, input.email],
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      throw new Error("User upsert returned no row");
    }
    await client.query(
      `INSERT INTO spotify_accounts
         (user_id, access_token_enc, refresh_token_enc, access_expires_at, scope)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET access_token_enc = EXCLUDED.access_token_enc,
             refresh_token_enc = EXCLUDED.refresh_token_enc,
             access_expires_at = EXCLUDED.access_expires_at,
             scope = EXCLUDED.scope`,
      [
        userRow.id,
        encryptToken(input.accessToken),
        encryptToken(input.refreshToken),
        input.accessExpiresAt,
        input.scope,
      ],
    );
    await client.query("COMMIT");
    return userRow.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Fetch the account with decrypted tokens, or null if none exists. */
export async function getAccountForUser(userId: string): Promise<SpotifyAccount | null> {
  const result = await getPool().query<{
    access_token_enc: Buffer;
    refresh_token_enc: Buffer;
    access_expires_at: Date;
    scope: string;
  }>(
    `SELECT access_token_enc, refresh_token_enc, access_expires_at, scope
     FROM spotify_accounts WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    userId,
    accessToken: decryptToken(row.access_token_enc),
    refreshToken: decryptToken(row.refresh_token_enc),
    accessExpiresAt: row.access_expires_at,
    scope: row.scope,
  };
}

/** Store a refreshed access token (and rotated refresh token, when Spotify sends one). */
export async function updateAccountTokens(
  userId: string,
  update: { accessToken: string; accessExpiresAt: Date; refreshToken?: string },
): Promise<void> {
  if (update.refreshToken) {
    await getPool().query(
      `UPDATE spotify_accounts
       SET access_token_enc = $2, access_expires_at = $3, refresh_token_enc = $4
       WHERE user_id = $1`,
      [userId, encryptToken(update.accessToken), update.accessExpiresAt, encryptToken(update.refreshToken)],
    );
  } else {
    await getPool().query(
      `UPDATE spotify_accounts
       SET access_token_enc = $2, access_expires_at = $3
       WHERE user_id = $1`,
      [userId, encryptToken(update.accessToken), update.accessExpiresAt],
    );
  }
}
