"use server";

import { auth } from "@/auth";
import { recordAddition } from "@/lib/db/library";
import { SpotifyClient, SpotifyQuotaError, type TrackSummary } from "@/lib/spotify/client";
import { getValidAccessToken } from "@/lib/spotify/tokens";

export interface AddResult {
  ok: boolean;
  error?: "unauthenticated" | "quota-exhausted" | "failed";
}

/** Add the track to the playlist on Spotify, then mirror it locally. */
export async function addTrackAction(
  playlistId: string,
  track: TrackSummary,
): Promise<AddResult> {
  const session = await auth();
  if (!session?.userId) {
    return { ok: false, error: "unauthenticated" };
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
      return { ok: false, error: "quota-exhausted" };
    }
    console.error("addTrackAction failed", error);
    return { ok: false, error: "failed" };
  }
}
