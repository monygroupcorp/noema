// =============================================================================
// weightAddress — does the registry know where a weight's file lives?
// =============================================================================
//
// A registry record is the only thing that says where a weight downloads from: the Compiler
// hands a pod `sources[0].uri` and nothing downstream re-checks it. A record with no source is
// a name without a file. Legacy LoRAs migrated from the old platform arrive in that state when
// the old document carried no download URL (`legacyToIntella` leaves `sources` empty and warns),
// and they keep their trigger words, so a prompt still resolves them and a picker still lists
// them — and the run dies at compile with a message that names a database id.
//
// One predicate, used by every place that offers or resolves a weight a user adds to a run.
// =============================================================================

import type { Intella } from '../types/intelligendi.js'

/** True when at least one source carries a non-empty download URI. */
export function hasDownloadAddress(intella: Pick<Intella, 'sources'>): boolean {
  return Array.isArray(intella.sources) && intella.sources.some(s => typeof s?.uri === 'string' && s.uri !== '')
}
