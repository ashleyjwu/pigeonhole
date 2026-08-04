"use client";

import type { AddResult } from "@/app/actions";
import { addTrackAction } from "@/app/actions";
import { PlaylistHoverPreview } from "@/components/playlist-preview";
import type { AnnotatedSuggestion } from "@/lib/suggest";
import type { TrackSummary } from "@/lib/spotify/client";

export type AddState = "idle" | "adding" | "added" | "error" | "quota";

export interface SuggestionListProps {
  track: TrackSummary;
  suggestions: AnnotatedSuggestion[];
  addStates: Record<string, AddState>;
  onAddStateChange: (playlistId: string, state: AddState) => void;
  emptyMessage?: string;
}

/** The shared "playlist row + Add button" list used by the hero and search
 *  flows — same suggestions API, same add action, same visual language. */
export function SuggestionList({
  track,
  suggestions,
  addStates,
  onAddStateChange,
  emptyMessage = "No playlist looks like a fit for this one yet.",
}: SuggestionListProps) {
  async function handleAdd(playlistId: string) {
    onAddStateChange(playlistId, "adding");
    const result: AddResult = await addTrackAction(playlistId, track);
    onAddStateChange(
      playlistId,
      result.ok ? "added" : result.error === "quota-exhausted" ? "quota" : "error",
    );
  }

  if (suggestions.length === 0) {
    return <p className="text-sm text-neutral-400">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {suggestions.map((suggestion) => {
        const state: AddState = suggestion.isMember
          ? "added"
          : (addStates[suggestion.playlistId] ?? "idle");
        return (
          <div
            key={suggestion.playlistId}
            className="flex items-center justify-between gap-3 rounded-xl bg-neutral-900 px-4 py-3"
          >
            <div className="min-w-0">
              <PlaylistHoverPreview playlistId={suggestion.playlistId} className="max-w-full">
                <p className="truncate font-medium">{suggestion.playlistName}</p>
              </PlaylistHoverPreview>
              <p className="truncate text-xs text-neutral-500">{suggestion.reason}</p>
            </div>
            <button
              type="button"
              disabled={state !== "idle" && state !== "error"}
              onClick={() => void handleAdd(suggestion.playlistId)}
              className={
                state === "added"
                  ? "rounded-full bg-neutral-800 px-4 py-1.5 text-sm text-green-400"
                  : state === "adding"
                    ? "rounded-full bg-neutral-800 px-4 py-1.5 text-sm text-neutral-400"
                    : state === "quota"
                      ? "rounded-full bg-amber-900/40 px-4 py-1.5 text-sm text-amber-300"
                      : state === "error"
                        ? "rounded-full bg-red-900/40 px-4 py-1.5 text-sm text-red-300 hover:bg-red-900/60"
                        : "rounded-full bg-green-500 px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-green-400"
              }
            >
              {state === "added"
                ? suggestion.isMember
                  ? "In playlist"
                  : "Added"
                : state === "adding"
                  ? "Adding..."
                  : state === "quota"
                    ? "Quota hit"
                    : state === "error"
                      ? "Retry"
                      : "Add"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Small helper for components managing add-state as
 *  Record<trackId, Record<playlistId, AddState>>. */
export function setNestedAddState(
  states: Record<string, Record<string, AddState>>,
  trackId: string,
  playlistId: string,
  state: AddState,
): Record<string, Record<string, AddState>> {
  return {
    ...states,
    [trackId]: { ...states[trackId], [playlistId]: state },
  };
}
