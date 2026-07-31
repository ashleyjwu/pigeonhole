"use client";

import { useRef, useState } from "react";

import type { SearchPayload } from "@/app/api/search/route";
import { setNestedAddState, SuggestionList, type AddState } from "@/components/suggestion-list";

const DEBOUNCE_MS = 400;

export function Search() {
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [addStates, setAddStates] = useState<Record<string, Record<string, AddState>>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function onQueryChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setPayload(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => void runSearch(value), DEBOUNCE_MS);
  }

  async function runSearch(value: string) {
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = (await response.json()) as SearchPayload;
      setPayload(data);
    } catch {
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search a song..."
        aria-label="Search for a song"
        className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-green-500"
      />

      {loading && <p className="text-sm text-neutral-500">Searching...</p>}

      {payload?.state === "quota-exhausted" && (
        <p className="rounded-lg bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          Spotify&apos;s search quota is used up for now. Try again after the
          daily window resets.
        </p>
      )}

      {payload?.state === "results" &&
        (payload.results.length === 0 ? (
          <p className="text-sm text-neutral-400">No tracks found.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {payload.results.map(({ track, suggestions }) => (
              <div key={track.id} className="flex flex-col gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{track.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {track.artistNames.join(", ")}
                  </p>
                </div>
                <SuggestionList
                  track={track}
                  suggestions={suggestions}
                  addStates={addStates[track.id] ?? {}}
                  onAddStateChange={(playlistId, state) =>
                    setAddStates((s) => setNestedAddState(s, track.id, playlistId, state))
                  }
                  emptyMessage="No playlist looks like a fit for this one."
                />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
