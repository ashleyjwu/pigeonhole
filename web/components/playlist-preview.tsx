"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PlaylistPreviewPayload } from "@/app/api/playlists/[id]/preview/route";
import type { PlaylistPreview, PlaylistPreviewTrack } from "@/lib/db/playlists";
import { swatchColorForSeed } from "@/lib/util";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; preview: PlaylistPreview }
  | { status: "error" };

const HOVER_DELAY_MS = 300;
// No sized measurement of the popover itself (it hasn't rendered yet when we
// decide placement); a generous estimate covers the tallest realistic case
// (cover + name + description + 3 tracks) without needing a second render.
const ESTIMATED_POPOVER_HEIGHT_PX = 260;

// Module-level cache: re-hovering the same playlist within a session never
// re-fetches, even across unmounts (switching hero/search/batch tabs).
// `null` caches a confirmed "not found" so a broken id isn't retried forever.
const previewCache = new Map<string, PlaylistPreview | null>();

function usePlaylistPreviewState(playlistId: string) {
  const cached = previewCache.get(playlistId);
  const [state, setState] = useState<LoadState>(
    cached === undefined
      ? { status: "idle" }
      : cached
        ? { status: "loaded", preview: cached }
        : { status: "error" },
  );
  const requestedRef = useRef(cached !== undefined);

  const ensureLoaded = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    setState({ status: "loading" });
    void fetch(`/api/playlists/${playlistId}/preview`)
      .then((r) => r.json() as Promise<PlaylistPreviewPayload>)
      .then((data) => {
        if (data.state === "found") {
          previewCache.set(playlistId, data.preview);
          setState({ status: "loaded", preview: data.preview });
        } else {
          previewCache.set(playlistId, null);
          setState({ status: "error" });
        }
      })
      .catch(() => {
        requestedRef.current = false; // allow a retry on the next open
        setState({ status: "error" });
      });
  }, [playlistId]);

  return { state, ensureLoaded };
}

/**
 * Shared open/close/placement logic for the preview popover, independent of
 * which DOM element acts as the trigger — a plain name in SuggestionList vs
 * a dedicated info button in Batch (where the row is already a tap target
 * for accepting the suggestion, so it can't also toggle the preview).
 */
function usePreviewPopover(playlistId: string) {
  const { state, ensureLoaded } = usePlaylistPreviewState(playlistId);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const containerRef = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const computePlacement = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPlacement(
      rect.bottom + ESTIMATED_POPOVER_HEIGHT_PX > window.innerHeight ? "above" : "below",
    );
  }, []);

  const openNow = useCallback(() => {
    ensureLoaded();
    computePlacement();
    setOpen(true);
  }, [ensureLoaded, computePlacement]);

  const closeNow = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    setOpen(false);
  }, []);

  const onMouseEnter = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(openNow, HOVER_DELAY_MS);
  }, [openNow]);

  const onMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    closeNow();
  }, [closeNow]);

  // Dismiss on outside tap/click — covers touch, where a non-native-control
  // trigger may never receive blur (iOS Safari in particular doesn't always
  // focus plain elements on tap even with tabIndex).
  useEffect(() => {
    if (!open) return;
    function onPointerDownOutside(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        closeNow();
      }
    }
    document.addEventListener("pointerdown", onPointerDownOutside);
    return () => document.removeEventListener("pointerdown", onPointerDownOutside);
  }, [open, closeNow]);

  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  return {
    state,
    open,
    placement,
    containerRef,
    handlers: {
      onMouseEnter,
      onMouseLeave,
      onFocus: openNow,
      onBlur: closeNow,
      onClick: openNow,
    },
  };
}

function PlaylistPreviewCard({ state }: { state: LoadState }) {
  if (state.status === "error") {
    return null;
  }

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="w-72 animate-pulse rounded-xl bg-neutral-900 p-3 shadow-lg shadow-black/40">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 rounded-lg bg-neutral-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-neutral-800" />
            <div className="h-2.5 w-1/3 rounded bg-neutral-800" />
          </div>
        </div>
      </div>
    );
  }

  const { preview } = state;
  return (
    <div className="w-72 rounded-xl bg-neutral-900 p-3 shadow-lg shadow-black/40">
      <div className="flex items-center gap-3">
        {preview.imageUrl ? (
          <Image
            src={preview.imageUrl}
            alt=""
            width={56}
            height={56}
            unoptimized
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-lg bg-neutral-800" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{preview.playlistName}</p>
          <p className="text-xs text-neutral-500">
            {preview.trackCount} {preview.trackCount === 1 ? "track" : "tracks"}
          </p>
        </div>
      </div>

      {preview.description && (
        <p className="mt-3 line-clamp-2 text-xs italic text-neutral-400">{preview.description}</p>
      )}

      {preview.tracks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-neutral-800 pt-3">
          {preview.tracks.map((track, i) => (
            <PreviewTrackRow key={i} track={track} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single track row with a color-swatch thumbnail standing in for real
 *  per-track album art (not stored locally — only the playlist-level cover
 *  is synced). The swatch is deterministic per track name, so it doesn't
 *  shift between renders. */
function PreviewTrackRow({ track }: { track: PlaylistPreviewTrack }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white/70 ${swatchColorForSeed(track.name)}`}
      >
        {track.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-neutral-200">{track.name}</p>
        <p className="truncate text-[11px] text-neutral-500">{track.artistNames.join(", ")}</p>
      </div>
    </div>
  );
}

/**
 * Wraps static playlist-name text (e.g. in SuggestionList, where the name
 * isn't otherwise interactive) and makes the wrapper itself the hover/
 * focus/tap trigger for the preview popover.
 */
export function PlaylistHoverPreview({
  playlistId,
  children,
  className,
}: {
  playlistId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { state, open, placement, containerRef, handlers } = usePreviewPopover(playlistId);
  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement | null>}
      className={`relative inline-block max-w-full ${className ?? ""}`}
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label="Show playlist preview"
      {...handlers}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={`absolute left-0 z-20 ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"}`}
        >
          <PlaylistPreviewCard state={state} />
        </div>
      )}
    </div>
  );
}

/**
 * A small standalone "i" trigger for contexts where the row itself is
 * already a tap target for something else (Batch's accept buttons) — a
 * real, separate <button> so it never nests inside another control.
 */
export function PlaylistPreviewInfoButton({
  playlistId,
  className,
}: {
  playlistId: string;
  className?: string;
}) {
  const { state, open, placement, containerRef, handlers } = usePreviewPopover(playlistId);
  return (
    <span
      ref={containerRef as React.RefObject<HTMLSpanElement | null>}
      className="relative inline-block"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label="Show playlist preview"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200 ${className ?? ""}`}
        onMouseEnter={handlers.onMouseEnter}
        onMouseLeave={handlers.onMouseLeave}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        onClick={(e) => {
          // Stop the click from bubbling to the accept button this sits
          // next to — previewing must never also accept the suggestion.
          e.stopPropagation();
          handlers.onClick();
        }}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute left-0 z-20 ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"}`}
        >
          <PlaylistPreviewCard state={state} />
        </div>
      )}
    </span>
  );
}
