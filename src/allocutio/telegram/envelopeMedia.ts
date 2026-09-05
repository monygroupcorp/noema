// =============================================================================
// envelopeMedia — what media a Telegram message carries, and of what kind
// =============================================================================
// Telegram wraps the same file in different fields depending on how the host sent
// it: a compressed image arrives as `photo`, the same image sent uncompressed as
// `document`, a clip as `video`, a GIF as `animation`, a recorded note as `voice`,
// a round one as `video_note`.
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

/** Classify a MIME type. Anything that is not media resolves to null. */
function mimeTypeKind(mimeType: string | undefined): EnvelopeMediaType | null {
  if (mimeType === undefined) return null
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return null
}

/**
 * Classify a filename by its extension. `mime_type` is optional in the Bot API — the
 * sending client fills it, and not every client does — so a file named `shot.png`
 * would otherwise be dropped for want of a header the host never controlled. An
 * unknown extension resolves to null, not to an image: this decides whether a file
 * is media at all, and a `.zip` is not.
 */
function fileNameKind(fileName: string | undefined): EnvelopeMediaType | null {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
  if (/^(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/.test(ext)) return 'image'
  if (/^(mp4|webm|mov|m4v|mkv|avi)$/.test(ext)) return 'video'
  if (/^(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/.test(ext)) return 'audio'
  return null
}

/** What Porta type a `document` can fill, or null if it is not media at all. */
function documentType(document: { mime_type?: string; file_name?: string }): EnvelopeMediaType | null {
  return mimeTypeKind(document.mime_type) ?? fileNameKind(document.file_name)
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
  // A round video message: the video counterpart of a voice note, always an mp4.
  if (message.video_note) return { fileId: message.video_note.file_id, type: 'video' }
  if (message.document) {
    const type = documentType(message.document)
    if (type !== null) return { fileId: message.document.file_id, type }
  }

  return null
}
