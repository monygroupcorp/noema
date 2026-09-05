// =============================================================================
// LOCUS — a run's place in the line for a warm pod
// =============================================================================
//
// "Locus" = a place, a position in an order. One record per run that asked for
// economy compute and found the warm pool empty: it holds the run's place until
// a pod running the right image falls idle.
//
// LATIN CASE ROLES IN THIS FILE:
//   Locus     (nominative singular) — one place in the line
//   Locorum   (genitive plural)     — "of the places"; the store
//
// WHY A RECORD AND NOT A QUERY. A waiting run is already an Actum in `nascens`
// with its signa locked, so the line could in principle be derived by scanning
// acta. It is not, for two reasons: the image a run needs is resolved from its
// Fundamentum (a second read per candidate on every pod release), and handing a
// freed pod to exactly one waiter needs an atomic claim, which a scan cannot
// give. The record carries the match key and is the thing that is claimed.
//
// IDENTITY-BLIND, like the Actum it points at. A place carries a run id and an
// image ref and nothing else: no anima, no commitment, no bearer token. Who is
// waiting is resolvable only the way it is for any run — through the ledger.
// =============================================================================

/** One run's place in the line for a warm pod. */
export interface Locus {
  id: string
  /** FK → Actum. The run that is waiting. Unique: a run holds one place. */
  actumId: string
  /**
   * The substrate image the run needs (`imageId:imageVersion`). Only a pod
   * already running this image can take it — that is the whole point of waiting
   * rather than cold-starting. Resolved once, at enqueue, from the flow's
   * Fundamentum, so a pod release does not re-resolve it per candidate.
   */
  imageRef: string
  /** When the run joined the line. The ordering key: first in, first out. */
  admissum: Date
  /**
   * Stamped when a freed pod claimed this place, cleared if the dispatch could
   * not be made. Its presence is what makes `claim` exclusive — a claimed place
   * is invisible to the next claimant, so two pods freeing at once cannot both
   * take the same run.
   */
  vocatum?: Date
}

/** Where a run stands in its line, as the user is shown it. */
export interface LocusPlace {
  /** 1-based position among the runs still waiting on the same image. */
  place: number
  /** How many runs are waiting on that image in total, this one included. */
  depth: number
}

/**
 * Locorum — genitive plural "of the places." The store that owns the line.
 *
 * Every method is scoped by `imageRef` where the answer depends on it: the line
 * for one image is a line, and the sum of all of them is not — a run waiting on
 * a Flux pod is not behind a run waiting on a WAN pod, and telling it that it is
 * would be a false position.
 */
export interface Locorum {
  /**
   * Put a run at the back of its image's line. Idempotent per run: a run already
   * holding a place keeps the place it has (and the `admissum` it has), so a
   * retried dispatch cannot send a waiter to the back of its own queue.
   */
  enqueue(input: { actumId: string; imageRef: string }): Promise<Locus>
  /** Where the run stands, or null when it holds no place. */
  place(actumId: string): Promise<LocusPlace | null>
  /**
   * Atomically take the oldest unclaimed place in `imageRef`'s line, stamping
   * `vocatum` in the same operation. Null when nothing is waiting. The caller
   * either dispatches the run and `remove`s the place, or `release`s it back.
   */
  claim(imageRef: string): Promise<Locus | null>
  /** Every place still waiting on `imageRef`, oldest first — claimed ones excluded. */
  waiting(imageRef: string): Promise<Locus[]>
  /** Distinct images with at least one run waiting on them. */
  images(): Promise<string[]>
  /** Give up a place. Idempotent: removing a place that is gone is not an error. */
  remove(actumId: string): Promise<void>
  /**
   * Return a claimed place to the line, keeping its `admissum` so the run resumes
   * the position it had. Used when the claim could not be dispatched — the pod
   * was taken in the meantime, or the dispatch threw.
   */
  release(id: string): Promise<void>
}
