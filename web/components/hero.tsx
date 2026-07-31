"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AddResult } from "@/app/actions";
import { addTrackAction } from "@/app/actions";
import type { NowPlayingPayload } from "@/app/api/now-playing/route";
import type { TrackSummary } from "@/lib/spotify/client";

const POLL_INTERVAL_MS = 10_000;

type AddState = "idle" | "adding" | "added" | "error" | "quota";

export function Hero() {
  const [payload, setPayload] = useState<NowPlayingPayload | null>(null);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  const trackIdRef = useRef<string | null>(null);
  // Quota exhaustion is terminal for this session; the poller checks this ref
  // so it stops spending requests once we know the quota is gone.
  const quotaExhaustedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/now-playing");
      const data = (await response.json()) as NowPlayingPayload;
      setPayload(data);
      quotaExhaustedRef.current = data.state === "quota-exhausted";
      const trackId = data.state === "playing" ? data.track.id : null;
      if (trackId !== trackIdRef.current) {
        trackIdRef.current = trackId;
        setAddStates({});
      }
    } catch {
      // transient network failure: keep the last known state
    }
  }, []);

  useEffect(() => {
    // Initial load via a 0ms timer keeps state updates out of the effect body
    // (react-hooks/set-state-in-effect) while polling handles refreshes.
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => {
      // Be gentle with the API quota: poll only while the tab is visible.
      if (document.visibilityState === "visible" && !quotaExhaustedRef.current) {
        void refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  async function handleAdd(playlistId: string, track: TrackSummary) {
    setAddStates((s) => ({ ...s, [playlistId]: "adding" }));
    const result: AddResult = await addTrackAction(playlistId, track);
    const next: AddState = result.ok
      ? "added"
      : result.error === "quota-exhausted"
        ? "quota"
        : "error";
    setAddStates((s) => ({ ...s, [playlistId]: next }));
  }

  if (payload === null) {
    return <StatusCard title="Connecting..." body="Checking what's playing." />;
  }
  if (payload.state === "unauthenticated") {
    return <StatusCard title="Signed out" body="Sign in with Spotify to get started." />;
  }
  if (payload.state === "quota-exhausted") {
    return (
      <StatusCard
        title="Spotify quota exhausted"
        body="The dev-mode API quota is spent for now. pigeonhole will work again when the window resets."
      />
    );
  }
  if (payload.state === "nothing-playing") {
    return (
      <StatusCard
        title="Nothing playing"
        body="Play a song on Spotify and it will show up here with playlist suggestions."
      />
    );
  }

  const { track, suggestions } = payload;
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex items-center gap-4 rounded-2xl bg-neutral-900 p-4">
        {track.albumImageUrl ? (
          <Image
            src={track.albumImageUrl}
            alt=""
            width={80}
            height={80}
            unoptimized
            className="h-20 w-20 rounded-lg object-cover"
          />
        ) : (
          <div className="h-20 w-20 rounded-lg bg-neutral-800" />
        )}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-green-400">Now playing</p>
          <p className="truncate text-lg font-semibold">{track.name}</p>
          <p className="truncate text-sm text-neutral-400">
            {track.artistNames.join(", ")}
            {track.releaseYear ? ` · ${track.releaseYear}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          File it under
        </p>
        {Object.values(addStates).includes("quota") && (
          <p className="rounded-lg bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
            Spotify&apos;s write quota is used up for now. Adds will work again
            when the daily window resets.
          </p>
        )}
        {suggestions.length === 0 ? (
          <p className="text-sm text-neutral-400">
            No playlist looks like a fit for this one yet.
          </p>
        ) : (
          suggestions.map((suggestion) => {
            const state: AddState = suggestion.isMember
              ? "added"
              : (addStates[suggestion.playlistId] ?? "idle");
            return (
              <div
                key={suggestion.playlistId}
                className="flex items-center justify-between gap-3 rounded-xl bg-neutral-900 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{suggestion.playlistName}</p>
                  <p className="truncate text-xs text-neutral-500">{suggestion.reason}</p>
                </div>
                <button
                  type="button"
                  disabled={state !== "idle" && state !== "error"}
                  onClick={() => void handleAdd(suggestion.playlistId, track)}
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
          })
        )}
      </div>
    </div>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="w-full max-w-md rounded-2xl bg-neutral-900 p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-neutral-400">{body}</p>
    </div>
  );
}
