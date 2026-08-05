import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// =============================================================================
// FfmpegEngine — deterministic media post-processing (spec §4a)
// =============================================================================
//
// The substance of the "ffmpeg" host-side runtime. SAFETY: callers never supply
// raw ffmpeg arguments or filtergraphs — that would be command injection. The
// engine accepts a small set of BOUNDED operations and builds a fixed argument
// vector for each. New operations are added here, deliberately, not by the user.
//
// Behind an interface so the cursor unit-tests with a fake (no ffmpeg binary,
// no temp files, no spawning).

/** Assemble an ordered set of frames into a video at a given frame rate. */
export interface FramesToVideoOp {
  op: 'frames-to-video'
  /** Ordered frame images (PNG/JPEG), in playback order. */
  frames: Buffer[]
  /** Frames per second (1–60). */
  fps: number
  format: 'mp4' | 'webm'
}

export type FfmpegOp = FramesToVideoOp

export interface FfmpegResult {
  bytes: Buffer
  contentType: string
  ext: string
}

export interface FfmpegEngine {
  run(op: FfmpegOp): Promise<FfmpegResult>
}

const VIDEO_FORMATS: Record<FramesToVideoOp['format'], { ext: string; contentType: string; codecArgs: string[] }> = {
  // yuv420p + even-dimension scaling = broad player compatibility.
  mp4: { ext: 'mp4', contentType: 'video/mp4', codecArgs: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'] },
  webm: { ext: 'webm', contentType: 'video/webm', codecArgs: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p'] },
}

/** ffmpeg-binary-backed engine. Writes inputs to a temp dir, spawns ffmpeg with a
 *  FIXED arg vector, reads the output, and always cleans up. */
export class SpawnFfmpegEngine implements FfmpegEngine {
  constructor(private readonly bin = 'ffmpeg') {}

  async run(op: FfmpegOp): Promise<FfmpegResult> {
    switch (op.op) {
      case 'frames-to-video':
        return this._framesToVideo(op)
    }
  }

  private async _framesToVideo(op: FramesToVideoOp): Promise<FfmpegResult> {
    if (op.frames.length === 0) throw new Error('ffmpeg frames-to-video: at least one frame is required')
    const fps = Math.min(60, Math.max(1, Math.round(op.fps)))
    const fmt = VIDEO_FORMATS[op.format]
    if (!fmt) throw new Error(`ffmpeg: unsupported format "${op.format}"`)

    const dir = await mkdtemp(join(tmpdir(), 'noema-ffmpeg-'))
    try {
      // Frames as zero-padded PNGs so ffmpeg's %05d pattern reads them in order.
      for (let i = 0; i < op.frames.length; i++) {
        await writeFile(join(dir, `frame-${String(i).padStart(5, '0')}.png`), op.frames[i])
      }
      const outPath = join(dir, `out.${fmt.ext}`)
      const args = [
        '-y',
        '-framerate', String(fps),
        '-i', join(dir, 'frame-%05d.png'),
        ...fmt.codecArgs,
        outPath,
      ]
      await this._spawn(args)
      const bytes = await readFile(outPath)
      return { bytes, contentType: fmt.contentType, ext: fmt.ext }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private _spawn(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += String(d) })
      proc.on('error', reject)
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
      )
    })
  }
}
