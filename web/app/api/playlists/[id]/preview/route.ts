import { NextResponse } from "next/server";

import { getPlaylistPreview, type PlaylistPreview } from "@/lib/db/playlists";
import { resolveSession } from "@/lib/session";

export type PlaylistPreviewPayload =
  | { state: "unauthenticated" }
  | { state: "not-found" }
  | { state: "found"; preview: PlaylistPreview };

/**
 * Playlist preview for the hover/focus popover. Pure Postgres — no Spotify
 * calls, so this never touches API quota and can be fetched freely on
 * hover. Scoped to the signed-in user's own playlists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<PlaylistPreviewPayload>> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const preview = await getPlaylistPreview(session.userId, id);
  if (!preview) {
    return NextResponse.json({ state: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ state: "found", preview });
}
