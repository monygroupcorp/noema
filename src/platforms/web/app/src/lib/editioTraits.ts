// editio trait model (editio-overview.md §data model). A trait = 4 required fields + 1 optional:
// category (axis) · title (public face, SHOWS ON NFT) · value (the typed mechanism that feeds
// the modus: prompt | image·ref | number·cfg) · rarity (weighted %) · motif (optional family).
// The display-vs-mechanism split (title shown, value is a recipe) is what makes a NOEMA trait
// different from a static layer asset. No backend yet. TODO(backend: trait records + combo math).

export type ValueKind = 'prompt' | 'image' | 'number';
export interface Trait {
  id: string;
  title: string;          // public face
  rarity: number | null;  // weighted % (null = the one always-on/default)
  kind: ValueKind;
  value: string;          // the mechanism payload (prompt fragment / ref file / number)
  tint?: string;          // preview tile tint
}
export interface Category { id: string; name: string; color: string; traits: Trait[] }

export const VALUE_LABEL: Record<ValueKind, string> = { prompt: 'prompt', image: 'image · ref', number: 'number · cfg' };

export const GARDEN: { collection: string; categories: Category[] } = {
  collection: 'Glasswork Saints',
  categories: [
    { id: 'background', name: 'Background', color: '#5b8cff', traits: [
      { id: 'cobalt', title: 'Cobalt Field', rarity: 30, kind: 'prompt', value: '"deep cobalt gradient, soft grain"', tint: '#2b3a5e' },
      { id: 'arcane', title: 'Arcane Dusk', rarity: 26, kind: 'prompt', value: '"violet dusk, faint glyphs"', tint: '#3a2f5e' },
      { id: 'frost', title: 'Frost Pane', rarity: 24, kind: 'prompt', value: '"frosted glass, pale light"', tint: '#2f4a5e' },
      { id: 'ember', title: 'Ember Haze', rarity: 20, kind: 'prompt', value: '"warm ember haze"', tint: '#5e3a2b' },
    ] },
    { id: 'base', name: 'Base', color: '#5fd0a8', traits: [
      { id: 'glass-saint', title: 'Glass Saint', rarity: 40, kind: 'prompt', value: '"translucent glass figure"', tint: '#2c4a44' },
      { id: 'iron-saint', title: 'Iron Saint', rarity: 35, kind: 'prompt', value: '"forged iron figure"', tint: '#34343a' },
      { id: 'mist-saint', title: 'Mist Saint', rarity: 25, kind: 'prompt', value: '"figure of drifting mist"', tint: '#3a3f44' },
    ] },
    { id: 'outfit', name: 'Outfit', color: '#5b8cff', traits: [
      { id: 'wizard-robe', title: 'Wizard Robe', rarity: 10, kind: 'prompt', value: '"flowing arcane robe, glass-thread embroidery"', tint: '#3a2f5e' },
      { id: 'plate-armor', title: 'Plate Armor', rarity: 12, kind: 'prompt', value: '"polished steel plate, etched circuitry"', tint: '#3a3f4a' },
      { id: 'hoodie', title: 'Hoodie', rarity: 22, kind: 'prompt', value: '"oversized tech hoodie, matte"', tint: '#5e4a3a' },
      { id: 'cathedral-cape', title: 'Cathedral Cape', rarity: 8, kind: 'image', value: 'cape_ref_07.png · canny shape', tint: '#2b3a5e' },
      { id: 'tunic', title: 'Plain Tunic', rarity: 30, kind: 'prompt', value: '"simple linen tunic"', tint: '#3a3a3f' },
      { id: 'heavy-detail', title: 'Heavy Detail', rarity: null, kind: 'number', value: '7.5', tint: '#2c2c33' },
    ] },
    { id: 'headwear', name: 'Headwear', color: '#5fd0a8', traits: Array.from({ length: 9 }, (_, i) => (
      { id: `hw${i}`, title: ['Wizard Hat', 'Iron Crown', 'Halo Ring', 'Hood', 'Circlet', 'Visor', 'Antlers', 'Bare', 'Veil'][i], rarity: [12, 8, 6, 18, 10, 9, 5, 22, 10][i], kind: 'prompt' as const, value: '"…"', tint: '#33406b' })) },
    { id: 'aura', name: 'Aura', color: '#5fd0a8', traits: [
      { id: 'verdant', title: 'Verdant Ring', rarity: 34, kind: 'prompt', value: '"glowing green halo"', tint: '#2c5d54' },
      { id: 'azure', title: 'Azure Ring', rarity: 36, kind: 'prompt', value: '"glowing blue halo"', tint: '#2c4a5d' },
      { id: 'none', title: 'No Aura', rarity: 30, kind: 'prompt', value: '"no aura"', tint: '#2c2c33' },
    ] },
    { id: 'render', name: 'Render', color: '#c79a4e', traits: [
      { id: 'crisp', title: 'Crisp', rarity: 40, kind: 'number', value: '7.5', tint: '#4d3a2c' },
      { id: 'soft', title: 'Soft', rarity: 30, kind: 'number', value: '5.0', tint: '#3a3a2c' },
      { id: 'sharp', title: 'Sharp', rarity: 30, kind: 'number', value: '9.0', tint: '#4d4a2c' },
    ] },
  ],
};

// total combination space = product of per-category trait counts
export const combinations = (cats: Category[]) => cats.reduce((n, c) => n * Math.max(1, c.traits.length), 1);
