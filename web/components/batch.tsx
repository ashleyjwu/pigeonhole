"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { commitBatchAction } from "@/app/actions";
import type { BatchCard, BatchPayload } from "@/app/api/batch/route";
import type { BatchPlacement } from "@/lib/db/library";
import type { Suggestion } from "@/lib/scoring/types";

type Decision =
  | { kind: "accept"; suggestion: Suggestion }
  | { kind: "skip" };

type CommitState = "idle" | "committing" | "done" | "partial" | "error";

const SWIPE_THRESHOLD_PX = 80;

export function Batch() {
  const [payload, setPayload] = useState<BatchPayload | null>(null);
  const [cursor, setCursor] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [commitState, setCommitState] = useState<CommitState>("idle");
  const [committedCount, setCommittedCount] = useState(0);

  useEffect(() => {
    void fetch("/api/batch")
      .then((r) => r.json() as Promise<BatchPayload>)
      .then(setPayload)
      .catch(() => setPayload(null));
  }, []);

  const cards = payload?.state === "cards" ? payload.cards : [];
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
    setCursor((c) => c + 1);
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
            .then(setPayload);
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

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <p className="text-xs text-neutral-500">
        {cursor + 1} of {cards.length} · {accepted} filed so far
      </p>
      <Card
        key={current.track.id}
        card={current}
        onAccept={(suggestion) => decide(current.track.id, { kind: "accept", suggestion })}
        onSkip={() => decide(current.track.id, { kind: "skip" })}
      />
    </div>
  );
}

function Card({
  card,
  onAccept,
  onSkip,
}: {
  card: BatchCard;
  onAccept: (suggestion: Suggestion) => void;
  onSkip: () => void;
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
            <button
              key={s.playlistId}
              type="button"
              onClick={() => onAccept(s)}
              className={
                i === 0
                  ? "flex items-center justify-between rounded-xl bg-neutral-800 px-4 py-2.5 text-left ring-1 ring-green-500/40 hover:ring-green-500"
                  : "flex items-center justify-between rounded-xl bg-neutral-800/60 px-4 py-2 text-left hover:bg-neutral-800"
              }
            >
              <span className="truncate text-sm font-medium">{s.playlistName}</span>
              <span className="ml-3 shrink-0 text-xs text-neutral-500">{s.reason}</span>
            </button>
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
        <p className="text-xs text-neutral-500">
          Swipe right to add · left to skip
        </p>
        <button
          type="button"
          disabled={!top}
          onClick={() => top && onAccept(top)}
          className={
            bias === "accept"
              ? "rounded-full bg-green-500 px-5 py-2 font-semibold text-black"
              : "rounded-full bg-green-500/90 px-5 py-2 font-semibold text-black hover:bg-green-400"
          }
        >
          Add
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

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="w-full max-w-md rounded-2xl bg-neutral-900 p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-neutral-400">{body}</p>
    </div>
  );
}
