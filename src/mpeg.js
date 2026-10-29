/**
 * Just enough MPEG audio parsing to cut a radio stream where a decoder will
 * accept it.
 *
 * Verified against real streams — FIP, Radio Paradise and SomaFM all scan with no bytes rejected.
 *
 * `decodeAudioData` wants whole frames. A stream arrives in chunks that fall
 * wherever the network puts them, so each read has to be trimmed back to the
 * last complete frame and the remainder carried forward.
 */

/** Layer III bitrates in kbps, by index. 0 is free-form and 15 is invalid. */
const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]

/** Sample rates by version bits, then by index. Index 3 is reserved. */
const RATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
}

/**
 * Reads the frame starting at `at`, or null if there is not one there.
 *
 * Strict on purpose: a stream is full of bytes that resemble a sync word, and
 * accepting one desynchronises every frame after it.
 */
export function frameHeader(bytes, at) {
  if (at + 4 > bytes.length) return null
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null

  const version = (bytes[at + 1] >> 3) & 0x03
  const layer = (bytes[at + 1] >> 1) & 0x03
  const rates = RATES[version]
  if (!rates || layer !== 1) return null // Layer III only; version 1 is reserved

  const bitrate = (version === 3 ? BITRATE_V1 : BITRATE_V2)[(bytes[at + 2] >> 4) & 0x0f]
  const sampleRate = rates[(bytes[at + 2] >> 2) & 0x03]
  if (!bitrate || !sampleRate) return null

  const samples = version === 3 ? 1152 : 576
  const padding = (bytes[at + 2] >> 1) & 0x01
  return {
    length: Math.floor((samples / 8) * bitrate * 1000 / sampleRate) + padding,
    sampleRate,
    samples,
  }
}

/**
 * Index just past the last whole frame, or 0 if there is not one.
 *
 * Walks frame to frame rather than searching, so a byte that merely looks like
 * a sync word inside frame data is never mistaken for a boundary.
 */
export function lastFrameEnd(bytes) {
  let at = 0
  let end = 0

  // Find the first real frame; a stream can open mid-frame or behind an ID3 tag.
  while (at + 4 <= bytes.length && !frameHeader(bytes, at)) at++

  while (at + 4 <= bytes.length) {
    const frame = frameHeader(bytes, at)
    if (!frame) {
      at++
      continue
    }
    if (at + frame.length > bytes.length) break
    at += frame.length
    end = at
  }
  return end
}

/**
 * Measures what a lump of stream holds, so the decoder's answer can be checked
 * against it. Returns `{ start, frames, samples, sampleRate }` — the offset of
 * the first real frame (a lump can open behind a tag), how many whole frames
 * follow, the samples they carry, and the file's own rate, which is rarely the
 * AudioContext's.
 *
 * `decodeAudioData` returns more samples than the frames contain. An MP3
 * decoder has a startup delay it emits as leading silence, and it has no way to
 * know that this lump is the middle of something — every lump is decoded as
 * though it were a whole file. That silence is inaudible in one clip and
 * ruinous in a stream: it lands between every lump and the next, roughly once a
 * second and a half, for as long as a station plays.
 *
 * Knowing the true sample count turns the delay into arithmetic. Whatever the
 * decoder returned beyond this is what to skip, so nothing has to be assumed
 * about which decoder it is or how much it adds.
 */
export function scan(bytes) {
  let at = 0
  while (at + 4 <= bytes.length && !frameHeader(bytes, at)) at++
  const start = at

  let frames = 0
  let samples = 0
  let sampleRate = 0
  while (at + 4 <= bytes.length) {
    const frame = frameHeader(bytes, at)
    if (!frame) {
      at++
      continue
    }
    if (at + frame.length > bytes.length) break
    frames++
    samples += frame.samples
    sampleRate = frame.sampleRate
    at += frame.length
  }
  return { start, frames, samples, sampleRate }
}

/**
 * The trailing frames of a lump that a following frame could reach back into.
 *
 * Sized from `bytes` rather than a frame count, because that is what the format
 * bounds: `main_data_begin` is nine bits, so a frame may borrow from up to 511
 * bytes behind it however long a frame happens to be. One extra frame beyond
 * that, since the reach is measured from the frame's own start.
 */
export function reservoirTail(bytes, reach = 512) {
  const first = frameHeader(bytes, scan(bytes).start)
  const frames = first ? Math.ceil(reach / first.length) + 1 : 2
  return tailFrames(bytes, frames)
}

/**
 * The last `count` whole frames of a lump, to hand a decoder as warm-up.
 *
 * A Layer III frame is not self-contained. The format lets a frame borrow space
 * from the ones before it — the bit reservoir — so the first frames of a lump
 * cut out of the middle of a stream refer to bytes that were in the previous
 * lump, and decode wrong. One clip is inaudible; once a second and a half, for
 * an hour, is not.
 *
 * Feeding those frames again at the head of the next lump gives the decoder
 * what they refer to. The audio they produce is a duplicate of what has already
 * been heard, and `streamSlice` is what drops it — counted, not measured. They
 * are music, so anything that looked for them by looking for silence would stop
 * at their first sample and leave them to play.
 */
export function tailFrames(bytes, count) {
  if (count <= 0) return new Uint8Array(0)
  const starts = []

  let at = 0
  while (at + 4 <= bytes.length && !frameHeader(bytes, at)) at++
  while (at + 4 <= bytes.length) {
    const frame = frameHeader(bytes, at)
    if (!frame) {
      at++
      continue
    }
    if (at + frame.length > bytes.length) break
    starts.push(at)
    at += frame.length
  }

  if (starts.length <= count) return bytes.slice(starts[0] ?? bytes.length, at)
  return bytes.slice(starts[starts.length - count], at)
}

/**
 * Works out which part of a decoded lump is new: `{ skip, plays }`, both in
 * samples at the context's rate.
 *
 * What comes back from the decoder is the warm-up frames, then this lump, with
 * the decoder's startup silence in front of both and — on decoders that pad to
 * a whole frame — padding after. Only the middle has not been heard.
 *
 * `silence` reports how many of the first `limit` decoded samples are silent,
 * so the delay can be measured rather than assumed: charging the whole excess
 * to the front would cut real audio off every lump, and charging none of it
 * would leave the silence in. It is asked only about the delay, never about the
 * warm-up, because those frames are music — a scan that ran into them would
 * stop there and leave them to play, which is the sound of every lump
 * stammering.
 *
 * `fed` must be scanned BEFORE the decode call: `decodeAudioData` detaches the
 * ArrayBuffer it is given, and a scan of a detached view reports no frames at
 * all, which would leave the warm-up unaccounted for and play it.
 */
export function streamSlice({ decoded, contextRate, fresh, fed, silence }) {
  const ratio = fresh.sampleRate ? contextRate / fresh.sampleRate : 1
  const real = fresh.sampleRate ? Math.round(fresh.samples * ratio) : decoded
  const warmed = Math.max(0, Math.round((fed.samples - fresh.samples) * ratio))

  const excess = Math.max(0, decoded - real - warmed)
  const delay = Math.min(excess, Math.max(0, silence(excess)))
  const skip = Math.min(Math.max(0, decoded - 1), delay + warmed)
  return { skip, plays: Math.max(0, Math.min(real, decoded - skip)) }
}
