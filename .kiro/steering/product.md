# Product: pigeonhole

## What it is
pigeonhole helps a Spotify user file songs into the right playlist. The owner has
~250 playlists (many with cryptic names) and ~5,000 liked songs. When they hear a
song they like, deciding which playlist it belongs in is slow. pigeonhole recommends
the best-fit existing playlists for any track and adds it in one tap.

## The core insight
Playlists are classified by their **contents** (artists, genres, era, popularity,
track co-occurrence), not their names. Obscure playlist names don't matter — the
system infers what each playlist is "about" from the tracks already in it.

## Primary users
- The owner first (dogfooded): a heavy Spotify user with many playlists.
- Later: other Spotify users, limited to the dev-mode allowlist (~25) unless/until
  Spotify grants extended quota.

## Core features
1. **Hero flow — currently playing:** show the song playing now plus the top-3
   suggested playlists, add with one tap.
2. **Search flow:** search any track, get suggestions, add.
3. **Batch flow:** sort unfiled Liked Songs into existing playlists, with review.
4. **Feedback loop:** accept/dismiss refines future suggestions.

## Explicit non-goals
- No BPM/audio-feature dependence in the core (Spotify deprecated audio-features for
  new apps). Workout/cadence playlists are out of scope for this product.
- No auto-generated playlist names or labels (explicitly cut by the owner).
- Not a social app or general-purpose recommender (for now).

## Success metric
- Offline: precision@3 and MRR on held-out **real** placements (songs the owner
  actually filed). Produce a headline accuracy number for the README.
- Product: the owner actually uses it to file songs day to day.
