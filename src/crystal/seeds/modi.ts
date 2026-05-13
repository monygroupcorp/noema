import type { Modus } from '../../types/modus.js'
import { hashModus } from '../hashModus.js'

// =============================================================================
// Canonical Third-Party Tool Modi
//
// These seed the noema.modi collection so they are available for the
// FlowEngine's ExecuteFlow to browse and launch.
//
// contentHash is computed via hashModus() — excludes natum/mutatum/contentHash
// itself so the hash covers only the functional definition.
// =============================================================================

function make(def: Omit<Modus, 'contentHash'>): Modus {
  const withPlaceholder = { ...def, contentHash: '' }
  return { ...withPlaceholder, contentHash: hashModus(withPlaceholder) }
}

export const MODUS_CHATGPT: Modus = make({
  id: 'modus.chatgpt',
  nomen: 'ChatGPT — text generation',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    model:       { type: 'text',  required: false, default: 'gpt-4o',  description: 'OpenAI model ID' },
    temperature: { type: 'float', required: false, default: 0.7,       description: 'Sampling temperature' },
  },

  exitus: {
    response: { type: 'text', description: 'Generated text response' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const MODUS_DALLE_III: Modus = make({
  id: 'modus.dalle-iii',
  nomen: 'DALL·E 3 — image generation',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 50n,

  aditus: {
    prompt:  { type: 'text', required: true,  description: 'Image description' },
    size:    { type: 'text', required: false, default: '1024x1024', description: 'Image dimensions' },
    quality: { type: 'text', required: false, default: 'standard',  description: 'standard or hd' },
  },

  exitus: {
    imageUrl: { type: 'image', description: 'URL of the generated image' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const MODUS_JOYCAPTION: Modus = make({
  id: 'modus.joycaption',
  nomen: 'JoyCaption — image captioning',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'huggingface',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 5n,

  aditus: {
    __spaceUrl:   { type: 'text',  required: true,  default: 'fancyfeast/joy-caption-pre-alpha', description: 'HuggingFace space URL' },
    image:        { type: 'image', required: true,  description: 'Image to caption' },
    caption_type: { type: 'text',  required: false, default: 'Descriptive', description: 'Caption style' },
  },

  exitus: {
    caption: { type: 'text', description: 'Generated caption' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const CANONICAL_MODI: Modus[] = [
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_JOYCAPTION,
]
