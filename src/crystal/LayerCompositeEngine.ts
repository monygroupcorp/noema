// =============================================================================
// LayerCompositeEngine — deterministic z-order PNG compositing
// =============================================================================
//
// The substance of the "layer-composite" runtime (spec §4a): stack N image
// layers bottom→top onto a canvas and flatten to a PNG. Deterministic and
// host-side — no GPU, no model. Behind an interface so the cursor can be tested
// with a trivial fake (and so the jimp dependency loads lazily, only when an
// actual composite runs).

export interface LayerCompositeEngine {
  /**
   * Composite `layers` (encoded images) bottom→top — layers[0] is the base,
   * each subsequent layer drawn over it at the origin. Returns a PNG buffer.
   * Canvas defaults to the largest layer's dimensions unless overridden.
   */
  composite(layers: Buffer[], opts?: { width?: number; height?: number }): Promise<Buffer>
}

/** jimp-backed engine (pure-JS; no native build). */
export class JimpLayerCompositeEngine implements LayerCompositeEngine {
  async composite(layers: Buffer[], opts?: { width?: number; height?: number }): Promise<Buffer> {
    if (layers.length === 0) throw new Error('layer-composite: at least one layer is required')
    const { Jimp } = await import('jimp')

    const imgs = []
    for (const buf of layers) imgs.push(await Jimp.read(buf))

    const width = opts?.width ?? Math.max(...imgs.map((i) => i.bitmap.width))
    const height = opts?.height ?? Math.max(...imgs.map((i) => i.bitmap.height))

    // Transparent canvas, then draw each layer at the origin, in order.
    const canvas = new Jimp({ width, height, color: 0x00000000 })
    for (const img of imgs) canvas.composite(img, 0, 0)

    return canvas.getBuffer('image/png')
  }
}
