"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { commitBatchAction } from "@/app/actions";
import type { BatchCard, BatchPayload } from "@/app/api/batch/route";
import { PlaylistPreviewInfoButton } from "@/components/playlist-preview";
import type { BatchPlacement } from "@/lib/db/library";
import type { Suggestion } from "@/lib/scoring/types";
import { shuffle } from "@/lib/util";

type Decision =
  | { kind: "accept"; suggestion: Suggestion }
  | { kind: "skip" };

type CommitState = "idle" | "committing" | "done" | "partial" | "error";

const SWIPE_THRESHOLD_PX = 80;

export function Batch() {
  const [payload, setPayload] = useState<BatchPayload | null>(null);
  // Card display order, independent of the order the API returned them in
  // -- lets Shuffle reorder without needing a re-fetch. Seeded from the
  // payload once it loads (see the effect below).
  const [orderedCards, setOrderedCards] = useState<BatchCard[]>([]);
  const [cursor, setCursor] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [commitState, setCommitState] = useState<CommitState>("idle");
  const [committedCount, setCommittedCount] = useState(0);
  // Brief per-decision confirmation so tapping Add/Skip visibly does
  // something, instead of the only feedback being "the next card appeared".
  const [lastDecisionLabel, setLastDecisionLabel] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/batch")
      .then((r) => r.json() as Promise<BatchPayload>)
      .then((data) => {
        setPayload(data);
        setOrderedCards(data.state === "cards" ? data.cards : []);
      })
      .catch(() => setPayload(null));
  }, []);

  useEffect(() => {
    if (lastDecisionLabel === null) return;
    const timeout = setTimeout(() => setLastDecisionLabel(null), 1800);
    return () => clearTimeout(timeout);
  }, [lastDecisionLabel]);

  const cards = orderedCards;
  const current = cards[cursor];
  const accepted = useMemo(
    () =>
      Array.from(decisions.entries())
        .filter(([, d]) => d.kind === "accept")
        .length,
    [decisions],
  );

  function decide(trackId: string, decision: Decision) {
    setDecisions((prev) => new Map(prev).set(trackId, decision));
    setLastDecisionLabel(
      decision.kind === "accept" ? `Queued for ${decision.suggestion.playlistName}` : "Skipped",
    );
    setCursor((c) => c + 1);
  }

  // Reshuffles only the not-yet-reviewed cards (from `cursor` onward),
  // leaving already-decided ones in place -- re-rolling doesn't lose or
  // touch progress, and can be tapped again any time during review.
  function handleShuffle() {
    setOrderedCards((prev) => [...prev.slice(0, cursor), ...shuffle(prev.slice(cursor))]);
  }

  async function handleCommit() {
    const placements: BatchPlacement[] = [];
    for (const card of cards) {
      const decision = decisions.get(card.track.id);
      if (decision?.kind === "accept") {
        placements.push({ track: card.track, playlistId: decision.suggestion.playlistId });
      }
    }
    if (placements.length === 0) return;

    setCommitState("committing");
    const result = await commitBatchAction(placements);
    setCommittedCount(result.committedTrackIds.length);
    setCommitState(result.ok ? "done" : result.error === "quota-exhausted" ? "partial" : "error");
  }

  if (payload === null) {
    return <StatusCard title="Loading..." body="Finding unfiled songs." />;
  }
  if (payload.state === "unauthenticated") {
    return <StatusCard title="Signed out" body="Sign in with Spotify to get started." />;
  }
  if (cards.length === 0) {
    return (
      <StatusCard
        title="Nothing to file"
        body="Every liked song is already in a playlist."
      />
    );
  }

  if (commitState !== "idle") {
    return (
      <CommitSummary
        state={commitState}
        acceptedCount={accepted}
        committedCount={committedCount}
        onDone={() => {
          setDecisions(new Map());
          setCursor(0);
          setCommitState("idle");
          void fetch("/api/batch")
            .then((r) => r.json() as Promise<BatchPayload>)
            .then((data) => {
              setPayload(data);
              setOrderedCards(data.state === "cards" ? data.cards : []);
            });
        }}
      />
    );
  }

  if (!current) {
    return (
      <ReviewSummary
        totalCards={cards.length}
        acceptedCount={accepted}
        onCommit={() => void handleCommit()}
        onReviewAgain={() => setCursor(0)}
      />
    );
  }

  const remaining = cards.length - cursor;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between">
        <p className="text-xs text-neutral-500">
          {cursor + 1} of {cards.length} · {accepted} queued so far
        </p>
        {remaining > 1 && (
          <button
            type="button"
            onClick={handleShuffle}
            className="flex items-center gap-1 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
            aria-label={`Shuffle the remaining ${remaining} songs`}
          >
            <ShuffleIcon />
            Shuffle
          </button>
        )}
      </div>
      <Card
        key={current.track.id}
        card={current}
        acceptedCount={accepted}
        onAccept={(suggestion) => decide(current.track.id, { kind: "accept", suggestion })}
        onSkip={() => decide(current.track.id, { kind: "skip" })}
        onCommit={() => void handleCommit()}
      />
      {/* Visible confirmation that the last tap actually registered. */}
      <p
        className={`h-4 text-xs text-green-400 transition-opacity ${
          lastDecisionLabel ? "opacity-100" : "opacity-0"
        }`}
      >
        {lastDecisionLabel ?? "\u00A0"}
      </p>
    </div>
  );
}

function Card({
  card,
  acceptedCount,
  onAccept,
  onSkip,
  onCommit,
}: {
  card: BatchCard;
  acceptedCount: number;
  onAccept: (suggestion: Suggestion) => void;
  onSkip: () => void;
  onCommit: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const top = card.suggestions[0];

  function onPointerDown(e: React.PointerEvent) {
    dragStartRef.current = e.clientX;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragStartRef.current === null) return;
    setDragX(e.clientX - dragStartRef.current);
  }
  function onPointerUp() {
    if (dragX > SWIPE_THRESHOLD_PX && top) {
      onAccept(top);
    } else if (dragX < -SWIPE_THRESHOLD_PX) {
      onSkip();
    }
    dragStartRef.current = null;
    setDragX(0);
  }

  const rotation = dragX / 20;
  const bias = dragX > 20 ? "accept" : dragX < -20 ? "skip" : null;

  return (
    <div
      role="group"
      aria-label={`${card.track.name} by ${card.track.artistNames.join(", ")}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ transform: `translateX(${dragX}px) rotate(${rotation}deg)` }}
      className="w-full cursor-grab touch-none select-none rounded-2xl bg-neutral-900 p-5 transition-transform active:cursor-grabbing"
    >
      <div className="flex items-center gap-4">
        {card.track.albumImageUrl ? (
          <Image
            src={card.track.albumImageUrl}
            alt=""
            width={72}
            height={72}
            unoptimized
            className="h-18 w-18 rounded-lg object-cover"
          />
        ) : (
          <div className="h-18 w-18 rounded-lg bg-neutral-800" />
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{card.track.name}</p>
          <p className="truncate text-sm text-neutral-400">
            {card.track.artistNames.join(", ")}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {card.suggestions.length === 0 ? (
          <p className="text-sm text-neutral-500">No playlist looks like a fit — skip it.</p>
        ) : (
          card.suggestions.map((s, i) => (
            <div
              key={s.playlistId}
              className={
                i === 0
                  ? "flex items-center justify-between rounded-xl bg-neutral-800 px-4 py-2.5 ring-1 ring-green-500/40 hover:ring-green-500"
                  : "flex items-center justify-between rounded-xl bg-neutral-800/60 px-4 py-2 hover:bg-neutral-800"
              }
            >
              {/* A real <button> (not the whole row) accepts the
                  suggestion, so the separate preview info button doesn't
                  end up nested inside it. */}
              <button
                type="button"
                onClick={() => onAccept(s)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <span className="truncate text-sm font-medium">{s.playlistName}</span>
                <span className="shrink-0 text-xs text-neutral-500">{s.reason}</span>
              </button>
              <PlaylistPreviewInfoButton playlistId={s.playlistId} className="ml-2" />
            </div>
          ))
        )}
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onSkip}
          className={
            bias === "skip"
              ? "rounded-full bg-red-900/60 px-5 py-2 font-medium text-red-200"
              : "rounded-full border border-neutral-700 px-5 py-2 text-neutral-400 hover:border-neutral-500"
          }
        >
          Skip
        </button>
        {/* Tap a suggestion above to queue this track; this button commits
            everything queued so far — it does NOT accept the top suggestion
            for this card (that was confusing next to three explicit
            choices), so it's only enabled once something is queued. */}
        <button
          type="button"
          disabled={acceptedCount === 0}
          onClick={onCommit}
          className="rounded-full bg-green-500 px-5 py-2 font-semibold text-black transition hover:bg-green-400 disabled:opacity-40"
        >
          Add {acceptedCount || ""} to playlists
        </button>
      </div>
    </div>
  );
}

function ReviewSummary({
  totalCards,
  acceptedCount,
  onCommit,
  onReviewAgain,
}: {
  totalCards: number;
  acceptedCount: number;
  onCommit: () => void;
  onReviewAgain: () => void;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl bg-neutral-900 p-6 text-center">
      <p className="font-semibold">All caught up</p>
      <p className="mt-1 text-sm text-neutral-400">
        Reviewed {totalCards} songs — {acceptedCount} ready to file.
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          type="button"
          onClick={onReviewAgain}
          className="rounded-full border border-neutral-700 px-5 py-2 text-sm text-neutral-300 hover:border-neutral-500"
        >
          Review again
        </button>
        <button
          type="button"
          disabled={acceptedCount === 0}
          onClick={onCommit}
          className="rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-black hover:bg-green-400 disabled:opacity-40"
        >
          Add {acceptedCount} to playlists
        </button>
      </div>
    </div>
  );
}

function CommitSummary({
  state,
  acceptedCount,
  committedCount,
  onDone,
}: {
  state: CommitState;
  acceptedCount: number;
  committedCount: number;
  onDone: () => void;
}) {
  if (state === "committing") {
    return <StatusCard title="Adding songs..." body={`Filing ${acceptedCount} tracks.`} />;
  }
  const title =
    state === "done" ? "Done" : state === "partial" ? "Quota reached" : "Something went wrong";
  const body =
    state === "done"
      ? `Added ${committedCount} songs to your playlists.`
      : state === "partial"
        ? `Added ${committedCount} of ${acceptedCount} before Spotify's write quota ran out. The rest are still saved as liked songs — try again after the quota resets.`
        : "The batch commit failed. Nothing further was changed; you can try again.";
  return (
    <div className="w-full max-w-md rounded-2xl bg-neutral-900 p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-neutral-400">{body}</p>
      <button
        type="button"
        onClick={onDone}
        className="mt-5 rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-black hover:bg-green-400"
      >
        Continue
      </button>
    </div>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M4 6h3.5l7 12H18M4 18h3.5l1.6-2.7M18 6h-3.9l-1 1.7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15.5 4l3 2-3 2M15.5 16l3 2-3 2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
