// =============================================================================
// CORPUS — the training dataset
// =============================================================================
//
// "Corpus" = body/collection in Latin (2nd declension neuter).
// In classical Latin, a corpus was a body of work — a collection assembled
// for a purpose. In medieval scholarship, the Corpus Juris Civilis was the
// body of Roman law. Here: the body of examples assembled to train an Intella.
//
// A Corpus is the INPUT to a training run. It is not an Actum (execution record)
// and not an Intella (the model it produces). It is the material from which
// understanding is formed — Aristotle's hyle (matter) at the data level.
//
// Lifecycle:
//   nascens    → uploaded, not yet validated
//   validatus  → validated (schema check, image quality, min count met)
//   in usu     → actively being used in a training run
//   archivatus → archived — no longer active, weights may be preserved
// =============================================================================

export type CorpusStatus = 'nascens' | 'validatus' | 'in usu' | 'archivatus'

export type CorpusGenus =
  | 'imagines'    // image dataset — for training image generation models
  | 'textus'      // text dataset — for LLM fine-tuning
  | 'paria'       // paired dataset — image+caption, image+image, etc.

/**
 * Exemplar — a single labelled example within a Corpus.
 * "exemplar" = example/copy in Latin — the unit of which a corpus is made.
 */
export interface Exemplar {
  /** Storage reference — R2 key, URL, or volume path */
  ref: string
  /** "titulus" = label/caption in Latin — the annotation for this example */
  titulus?: string
  /** MIME type of the media */
  genus: string
}

/**
 * Corpus — a body of labelled examples assembled to train an Intella.
 *
 * Created by a user (the auctor). Validated before use. Referenced by
 * the training Actum that consumes it and by the resulting Intella (corpusId).
 */
export interface Corpus {
  id: string
  /** "nomen" = name in Latin */
  nomen: string
  genus: CorpusGenus

  /** "auctor" = author — the animaId of who assembled this corpus */
  auctor: string

  /** The labelled examples that make up this corpus */
  exemplaria: Exemplar[]
  /** Total number of examples — denormalised for quick access */
  numerus: number

  status: CorpusStatus

  /** "natum" = born — when this corpus was created */
  natum: Date
  /** "mutatum" = changed — when this corpus was last modified */
  mutatum: Date
}

/** "Corpora" — nominative plural of corpus (neuter 2nd declension) */
export type Corpora = Corpus[]

/**
 * Corporum — genitive plural "of the bodies."
 * The dataset store — what the platform knows how to load into a training run.
 */
export interface Corporum {
  find(id: string): Promise<Corpus | null>
  /**
   * Resolve a corpus by id THAT THIS CALLER MAY NAME — the access predicate lives in the
   * query, so a corpus the caller may not name is never loaded and there is no fetched record
   * for a later comparison to be skipped on.
   *
   * The predicate is: `auctor` is the caller, OR the corpus's access kind is `public` (the
   * single-axis Access union). A `Corpus` carries no access field today, so the public arm
   * matches nothing yet; it is written in the query so that adding the field is a schema
   * change rather than a re-derivation of who may read what.
   *
   * Returns null when no such corpus exists FOR THIS CALLER, so ids stay non-enumerable.
   */
  findOwned(id: string, auctor: string): Promise<Corpus | null>
  list(filter?: Partial<Pick<Corpus, 'auctor' | 'genus' | 'status'>>): Promise<Corpora>
  create(corpus: Omit<Corpus, 'id' | 'natum' | 'mutatum'>): Promise<Corpus>
  update(id: string, patch: Partial<Pick<Corpus, 'status' | 'exemplaria' | 'numerus' | 'mutatum'>>): Promise<Corpus>
}
