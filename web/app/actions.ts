"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { recordAddition, recordBatchAdditions, type BatchPlacement } from "@/lib/db/library";
import { DEMO_COOKIE, resolveSession } from "@/lib/session";
import { SpotifyClient, SpotifyQuotaError, type TrackSummary } from "@/lib/spotify/client";
import { getValidAccessToken } from "@/lib/spotify/tokens";

export interface AddResult {
  ok: boolean;
  error?: "unauthenticated" | "quota-exhausted" | "failed";
}

const DEMO_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

/** Enter the read-only public demo (no Spotify login). */
export async function startDemoAction(): Promise<void> {
  const store = await cookies();
  store.set(DEMO_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DEMO_COOKIE_MAX_AGE_S,
  });
  redirect("/");
}

/** Leave the demo. */
export async function exitDemoAction(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  redirect("/");
}

/** Add the track to the playlist on Spotify, then mirror it locally. */
export async function addTrackAction(
  playlistId: string,
  track: TrackSummary,
): Promise<AddResult> {
  const session = await resolveSession();
  if (!session) {
    return { ok: false, error: "unauthenticated" };
  }
  // Demo is read-only: a demo visitor can't see playlist contents and owns
  // no real Spotify account, so "adding" is a no-op success — the UI shows
  // the added state without any Spotify write or DB change.
  if (session.isDemo) {
    return { ok: true };
  }
  try {
    const accessToken = await getValidAccessToken(session.userId);
    const snapshotId = await new SpotifyClient(accessToken).addTrackToPlaylist(
      playlistId,
      track.id,
    );
    await recordAddition(session.userId, playlistId, track, snapshotId);
    return { ok: true };
  } catch (error) {
    if (error instanceof SpotifyQuotaError) {
      console.warn(
        `addTrackAction: Spotify quota exhausted (retry after ${error.retryAfterSeconds}s)`,
      );
      return { ok: false, error: "quota-exhausted" };
    }
    console.error("addTrackAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export interface BatchCommitResult {
  ok: boolean;
  /** Track ids that were successfully committed, in case of a partial failure. */
  committedTrackIds: string[];
  error?: "unauthenticated" | "quota-exhausted" | "failed";
}

/**
 * Commit a batch of accepted (track, playlistId) placements: one bulk
 * Spotify write per destination playlist (up to 100 URIs each), then mirror
 * everything locally in a single transaction.
 *
 * Partial-failure semantics: playlists are committed to Spotify in sequence;
 * if one fails (e.g. quota runs out partway through), everything already
 * written to Spotify is still mirrored locally and reported as committed —
 * nothing is lost, and the remaining cards stay in the queue to retry later.
 */
export async function commitBatchAction(
  placements: BatchPlacement[],
): Promise<BatchCommitResult> {
  const session = await resolveSession();
  if (!session) {
    return { ok: false, committedTrackIds: [], error: "unauthenticated" };
  }
  if (placements.length === 0) {
    return { ok: true, committedTrackIds: [] };
  }
  // Demo is read-only: report every placement as committed without touching
  // Spotify or the DB, so the batch flow's success UI works end to end.
  if (session.isDemo) {
    return { ok: true, committedTrackIds: placements.map((p) => p.track.id) };
  }

  const byPlaylist = new Map<string, BatchPlacement[]>();
  for (const placement of placements) {
    const group = byPlaylist.get(placement.playlistId) ?? [];
    group.push(placement);
    byPlaylist.set(placement.playlistId, group);
  }

  try {
    const accessToken = await getValidAccessToken(session.userId);
    const client = new SpotifyClient(accessToken);
    const snapshotIds: Record<string, string> = {};
    const committed: BatchPlacement[] = [];
    let quotaError: SpotifyQuotaError | undefined;

    for (const [playlistId, group] of byPlaylist) {
      try {
        snapshotIds[playlistId] = await client.addTracksToPlaylist(
          playlistId,
          group.map((p) => p.track.id),
        );
        committed.push(...group);
      } catch (error) {
        if (error instanceof SpotifyQuotaError) {
          quotaError = error;
          break; // stop issuing further writes; mirror what already succeeded
        }
        throw error;
      }
    }

    if (committed.length > 0) {
      await recordBatchAdditions(session.userId, committed, snapshotIds);
    }

    if (quotaError) {
      console.warn(
        `commitBatchAction: quota exhausted after committing ${committed.length}/${placements.length} (retry after ${quotaError.retryAfterSeconds}s)`,
      );
      return {
        ok: false,
        committedTrackIds: committed.map((p) => p.track.id),
        error: "quota-exhausted",
      };
    }
    return { ok: true, committedTrackIds: committed.map((p) => p.track.id) };
  } catch (error) {
    console.error("commitBatchAction failed", error);
    return { ok: false, committedTrackIds: [], error: "failed" };
  }
}
