// =============================================================================
// envelopeMedia — what media a Telegram message carries, and of what kind
// =============================================================================
// Telegram wraps the same file in different fields depending on how the host sent
// it: a compressed image arrives as `photo`, the same image sent uncompressed as
// `document`, a clip as `video`, a GIF as `animation`, a recorded note as `voice`.
// The flow engine does not care about the wrapper — it cares whether the URL is an
// image, a video or an audio clip, because that is what a Porta declares. This
// module is the map between the two, kept pure so it can be read and tested on its
// own.

import type { TelegramMedia } from './telegramTypes.js'

/** The Porta types an envelope can fill. Mirrors `Porta.type` in the modus schema. */
export type EnvelopeMediaType = 'image' | 'video' | 'audio'

export interface EnvelopeMedia {
  fileId: string
  type: EnvelopeMediaType
}

/** Classify a `document`'s MIME type. Anything that is not media resolves to null. */
function documentType(mimeType: string | undefined): EnvelopeMediaType | null {
  if (mimeType === undefined) return null
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return null
}

/**
 * The media a single message carries, or null if it carries none.
 *
 * Order is the order Telegram itself fills the fields — a message has exactly one
 * of these, so the sequence only settles the impossible case. A `document` is last
 * because it is the catch-all wrapper: a PDF or a zip is a document too, and one
 * that no Porta can take is no media at all.
 */
export function envelopeMedia(message: TelegramMedia | undefined): EnvelopeMedia | null {
  if (message === undefined) return null

  if (message.photo && message.photo.length > 0) {
    // Telegram sends one entry per size, ascending; the last is the highest res.
    return { fileId: message.photo[message.photo.length - 1].file_id, type: 'image' }
  }
  if (message.video) return { fileId: message.video.file_id, type: 'video' }
  // An animation is an mp4 without an audio track — a video to everything downstream.
  if (message.animation) return { fileId: message.animation.file_id, type: 'video' }
  if (message.audio) return { fileId: message.audio.file_id, type: 'audio' }
  if (message.voice) return { fileId: message.voice.file_id, type: 'audio' }
  if (message.document) {
    const type = documentType(message.document.mime_type)
    if (type !== null) return { fileId: message.document.file_id, type }
  }

  return null
}
