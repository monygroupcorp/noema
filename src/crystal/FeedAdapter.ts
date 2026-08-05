// =============================================================================
// FeedAdapter — publish an artifact to our feed
// =============================================================================
//
// The smallest publication adapter and the on-ramp for the whole spine: it puts
// an artifact (an Actum, for #1) forth onto OUR public feed. custody = 'ours'.
//
// The feed itself is SERVED from the Editionum store (`listFeed` — published,
// visibility 'feed', newest first); this adapter is the seam that mints the
// destination handle and is where a dedicated feed backend (fan-out, cache,
// ranking) would later live. For #1 the handle is a stable `feed:<uuid>` post id.
// Retract is a real capability here (feed = revocable): flipping the Editio to
// 'retracted' removes it from `listFeed`, so the adapter's retract is a no-op
// beyond that status change.
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'

export class FeedAdapter implements PublicationAdapter {
  readonly key = 'feed'

  async publish(_artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    // The feed is backed by the Editionum store; the adapter mints its post id.
    return { externalRef: `feed:${uuidv4()}` }
  }

  async retract(): Promise<void> {
    // Feed entries are served by `listFeed`, which filters on status:'published'.
    // The spine flips the Editio to 'retracted' (excluding it); nothing else to do.
  }
}
