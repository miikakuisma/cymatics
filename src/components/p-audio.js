import { equalizerDefaults } from "../equalizer"
import { createBandFollower, createModulators, presetModulators } from '../element/modulate.js'
import { dynamicState } from '../dynamic-state.js'
import { host } from '../studio/host.js'
import { applyOffsets, binFrequencies, eqOffsets } from '../studio/eq-response.js'
import { playButtonAction } from '../studio/sources.js'
import { blend, freshSpectrum, idleSpectrum, idleWeight } from '../element/idle.js'
import { BINS, hasSignal } from '../element/scale.js'
import { guess } from 'web-audio-beat-detector'
import { lastFrameEnd, reservoirTail, scan, streamSlice } from '../mpeg'

const AudioCtx = window.AudioContext || window.webkitAudioContext

// --- Radio streaming ---
//
// A station is played twice over: the <audio> element makes the sound, and a
// separate fetch of the same URL is decoded by hand to feed the analyser.
//
// The obvious path — one element, `createMediaElementSource`, straight into the
// graph — does not work on Safari, which hands the analyser silence for
// cross-origin media even when the stream sends CORS headers. That leaves the
// plate dead on every iPhone and every Mac not running Chrome, which is why the
// radio menu used to be hidden on iOS outright.
//
// So the element gets no `crossorigin` attribute and needs no permission from
// the station to play it, and the copy is fetched under CORS rules purely to be
// looked at. A station that sends no CORS headers still plays; only the plate
// rests.

/** Bytes to gather before decoding a lump of stream. About a second and a half
 *  at 128kbps — enough that the decoder is not called for every network read,
 *  short enough that starting a station is not a wait. */
const STREAM_CHUNK = 24000

/** The first lump, kept short so the plate starts moving sooner. */
const STREAM_FIRST_CHUNK = 6000

/** Seconds of decoded stream allowed to sit ahead of the speakers when the
 *  graph is the one sounding it. Past this the backlog is dropped and the copy
 *  rejoins live — otherwise a phone that froze the clock in the background
 *  wakes to a fetch that drains minutes of audio, and holds every one of them
 *  in memory as decoded buffers. */
const STREAM_MAX_AHEAD = 4

/** And when the element is sounding it, so this backlog is nothing but the
 *  distance between the music and the picture.
 *
 *  A station opens by sending several seconds at once and then settles to real
 *  time, so whatever piles up in the first moments is a standing offset that
 *  never comes down on its own: measured at two to three seconds of the plate
 *  answering music that had already been heard. Dropping back to the live edge
 *  costs a scheduled lump, which is inaudible at a gain of zero and invisible
 *  in a spectrum. */
const STREAM_MAX_PLATE_AHEAD = 1

/** How far ahead of the clock a lump is scheduled when the element is sounding
 *  the station and these buffers only feed the plate. An underrun here costs a
 *  flat frame or two, so headroom is not worth the plate lagging the music. */
const PLATE_LEAD = 0.12

/** And when the graph itself is being heard, because the element refused. Every
 *  following lump starts where the last ended, so this first gap is the
 *  standing buffer for the rest of the session; if the main thread stalls
 *  longer than it, the join is audible as a click. */
const STREAM_LEAD = 1.0

/** How long a station's element is given to start before the graph takes over
 *  the sounding. A host that accepts a connection and then says nothing leaves
 *  `play()` pending for good. */
const ELEMENT_START_MS = 4000

/** And how much longer it is given before the station is called dead, once the
 *  copy has stopped being an answer. A station can take ten seconds to open —
 *  SomaFM does, while refusing the copy outright — and giving up at the race
 *  above would stop it a moment before it started playing. */
const ELEMENT_GRACE_MS = 8000

function concat(a, b) {
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a)
  joined.set(b, a.length)
  return joined
}

/**
 * `decodeAudioData` as a promise, whichever form the browser has.
 *
 * Safari only grew the promise-returning version in 14.1 and still accepts the
 * callback one everywhere; this is the whole reason the stream is decoded by
 * hand, so it is worth not assuming the newer spelling.
 */
function decodeAudio(ctx, bytes) {
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(bytes, resolve, reject)
    if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject)
  })
}

/** How many of a decoded buffer's first `limit` samples are silence. The
 *  decoder's own startup delay is emitted as true digital silence, so it can be
 *  measured instead of assumed. The threshold is well below anything audible
 *  and well above the noise a lossy decoder leaves behind. */
function leadingSilence(buffer, limit) {
  if (limit <= 0) return 0
  const data = buffer.getChannelData(0)
  const end = Math.min(limit, data.length)
  let at = 0
  while (at < end && Math.abs(data[at]) < 1e-4) at++
  return at
}

// Stations whose bytes can actually be read, not merely played. SomaFM's
// streams (Groove Salad, Deep Space One) used to be here and were dropped:
// they refuse any request carrying an `Origin` header, so the element plays
// them and the analyser's copy comes back 403 — the station sounds and the
// plate sits still. Anything added by hand still works that way; these are
// the ones shipped as a first impression, so they visualise.
const defaultStations = [
  { name: 'Progressive Trance Mix', url: 'https://progressive-trance-mix.stream.laut.fm/progressive-trance-mix' },
  { name: 'FIP Electro', url: 'https://icecast.radiofrance.fr/fipelectro-midfi.mp3' },
  { name: 'Radio Paradise Mellow', url: 'https://stream.radioparadise.com/mellow-192' },
  { name: 'Radio Ibiza', url: 'https://ice07.fluidstream.net/Ibiza.mp3' },
]

// Tone generator range and level. The slider covers 20 Hz – 10 kHz, every
// plate mode the figures can show, logarithmically; a typed frequency may go
// anywhere from 1 Hz to 20 kHz, to two decimals.
const TONE_MIN_HZ = 20
const TONE_MAX_HZ = 10000
const TONE_TYPED_MIN_HZ = 1
const TONE_TYPED_MAX_HZ = 20000
const TONE_STEPS = 1000
const TONE_VOLUME = 0.15
const toneToStep = (hz) => {
  const clamped = Math.min(Math.max(hz, TONE_MIN_HZ), TONE_MAX_HZ)
  return Math.round(TONE_STEPS * Math.log(clamped / TONE_MIN_HZ) / Math.log(TONE_MAX_HZ / TONE_MIN_HZ))
}
const stepToTone = (step) => Math.round(TONE_MIN_HZ * Math.pow(TONE_MAX_HZ / TONE_MIN_HZ, step / TONE_STEPS))
const typedTone = (text) => {
  // An emptied box (or anything a number field rejects, which reads as '') is
  // no value at all, not 0 Hz.
  if (String(text).trim() === '') return null
  const hz = Number(text)
  if (!Number.isFinite(hz)) return null
  return Math.round(Math.min(Math.max(hz, TONE_TYPED_MIN_HZ), TONE_TYPED_MAX_HZ) * 100) / 100
}

function getPlayBtn() {
  return document.querySelector('p-nav button[fn="play"]') || document.querySelector('.simple-play-btn')
}

function setPlayingState(playing) {
  const btn = document.querySelector('.simple-play-btn')
  if (btn) {
    if (playing) {
      btn.classList.add('playing')
      btn.innerHTML = icons.pause
    } else {
      btn.classList.remove('playing')
      btn.innerHTML = icons.play
    }
  }
}

export class PuhdeAudio extends HTMLElement {

	constructor() {
    super()
		this.open = 'false'
    this.playing = false
    this.audioSource = null
    this.looping = true
    this.audioTag = null
    this.mode = '' // file, stream, mic, oscillator
    this.eqInputNode = null
    this.context = null
    this.inputNode = null
    this.analyser = null
    this.micStream = null
    this.oscillatorNode = null
    this.oscFreq = 440            // the tone generator's last frequency, kept
                                  // between plays
    this.beatGrid = null          // array of beat timestamps in seconds
    this.playbackStartTime = 0    // audioContext.currentTime when .start() called
    this.streamTurn = null        // AbortController for the running stream copy
    this.streamNodes = new Set()  // decoded lumps scheduled but not yet ended
    this.streamNext = 0           // context time the next lump starts at
    this.streamAudible = false    // whether the element took the station
    this.streamCopyDead = false   // the analyser's copy has failed or ended
    this.streamElementDead = false // the element has failed or ended
    this.nextBeatIndex = 0        // pointer into beatGrid
  }

  async connectedCallback() {
  }

	static get observedAttributes() {
		return ['open']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
    this.render()
	}

  // --- Favorites ---

  getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('cymatics_radio_favorites')) || []
    } catch { return [] }
  }

  saveFavorites(favorites) {
    localStorage.setItem('cymatics_radio_favorites', JSON.stringify(favorites))
  }

  addFavorite(name, url) {
    const favorites = this.getFavorites()
    if (!favorites.find(f => f.url === url)) {
      favorites.push({ name, url })
      this.saveFavorites(favorites)
    }
  }

  removeFavorite(url) {
    const favorites = this.getFavorites().filter(f => f.url !== url)
    this.saveFavorites(favorites)
  }

  // --- Render ---

  // The tone generator: one sine, for finding what a single frequency does to
  // the plate. Other waveforms only added harmonics that crowded the figure.
  // The slider is logarithmic, as pitch is heard — linear, everything below
  // 1 kHz would sit in its first twentieth — and the box takes an exact value.
  renderOscillatorOverlay() {
    const freq = this.oscFreq
    this.innerHTML = `
      <div class="osc-overlay">
        <div class="osc-freq">
          <input type="range" min="0" max="${TONE_STEPS}" value="${toneToStep(freq)}" step="1" aria-label="Frequency" />
          <input type="number" class="osc-hz" min="${TONE_TYPED_MIN_HZ}" max="${TONE_TYPED_MAX_HZ}" step="any" value="${freq}" inputmode="decimal" aria-label="Frequency in hertz" />
          <span class="osc-unit">Hz</span>
        </div>
        <button class="osc-stop">Stop</button>
      </div>
    `
    const freqSlider = this.querySelector('.osc-freq input[type="range"]')
    const freqBox = this.querySelector('.osc-hz')
    freqSlider.addEventListener('input', (e) => {
      const v = stepToTone(parseFloat(e.target.value))
      this.setOscillatorFrequency(v)
      freqBox.value = v
    })
    // Follow the box as it is typed, but only rewrite it on commit (Enter or
    // leaving it), so a half-typed number is never corrected under the cursor.
    freqBox.addEventListener('input', () => {
      const v = typedTone(freqBox.value)
      if (v === null) return
      this.setOscillatorFrequency(v)
      freqSlider.value = toneToStep(v)
    })
    freqBox.addEventListener('change', () => {
      const v = typedTone(freqBox.value) ?? this.oscFreq
      this.setOscillatorFrequency(v)
      freqBox.value = v
      freqSlider.value = toneToStep(v)
    })
    freqBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') freqBox.blur() })
    this.querySelector('.osc-stop').addEventListener('click', () => {
      this.stopCurrentAudio()
      const pb = getPlayBtn()
      if (pb) pb.innerHTML = icons.play
    })
  }

  render() {
    if (this.open === 'true') {
      const navPlayBtn = document.querySelector('p-nav button[fn="play"]')
      if (navPlayBtn) navPlayBtn.classList.add('activated')
      const simpleUi = document.querySelector('.simple-ui')
      if (simpleUi) simpleUi.style.pointerEvents = 'none'
      const favorites = this.getFavorites()

      const offered = host().sources.list
      let html = `<div class="options">`
      if (offered.includes('music')) html += `<button fn="external">${host().sources.external.label}</button>`
      if (offered.includes('file')) html += `<button fn="file">Play File</button>`
      if (offered.includes('mic')) html += `<button fn="mic">Microphone</button>`
      if (offered.includes('tone')) html += `<button fn="oscillator">Tone Generator</button>`
      if (offered.includes('radio')) {

      // Favorites
      if (favorites.length > 0) {
        html += `<hr />`
        favorites.forEach(f => {
          html += `<button fn="stream" stream-url="${f.url}">${f.name} <span class="fav-remove" data-url="${f.url}">&times;</span></button>`
        })
      }

      // Default stations
      html += `<hr />`
      defaultStations.forEach(st => {
        const isFav = favorites.find(f => f.url === st.url)
        html += `<button fn="stream" stream-url="${st.url}">${st.name}${!isFav ? ` <span class="fav-add" data-name="${st.name}" data-url="${st.url}">+</span>` : ''}</button>`
      })

      // Add custom station
      html += `<hr />`
      html += `<button fn="add-station">+ Add Station</button>`
      }

      html += `</div>`

      this.innerHTML = html

      this.querySelector('button[fn="external"]')?.addEventListener('click', () => {
        this.playExternal()
        this.setAttribute('open', 'false')
      })
      this.querySelector('button[fn="file"]')?.addEventListener('click', () => {
        this.playFile()
        this.setAttribute('open', 'false')
      })
      this.querySelector('button[fn="mic"]')?.addEventListener('click', () => {
        this.playMicrophone()
        this.setAttribute('open', 'false')
      })
      this.querySelector('button[fn="oscillator"]')?.addEventListener('click', () => {
        this.setAttribute('open', 'false')
        this.playOscillator()
        this.renderOscillatorOverlay()
      })
      this.querySelectorAll('button[fn="stream"]').forEach(b => b.addEventListener('click', (e) => {
        if (e.target.classList.contains('fav-remove') || e.target.classList.contains('fav-add')) return
        this.setAttribute('open', 'false')
        this.playShoutcast(b.getAttribute('stream-url'))
      }))
      this.querySelector('button[fn="add-station"]')?.addEventListener('click', () => {
        this.showAddStationModal()
      })

      // Favorite add/remove handlers
      this.querySelectorAll('.fav-remove').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation()
        this.removeFavorite(e.target.getAttribute('data-url'))
        this.render()
      }))
      this.querySelectorAll('.fav-add').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation()
        this.addFavorite(e.target.getAttribute('data-name'), e.target.getAttribute('data-url'))
        this.render()
      }))

    } else {
      const navPlayBtn2 = document.querySelector('p-nav button[fn="play"]')
      if (navPlayBtn2) navPlayBtn2.classList.remove('activated')
      const simpleUi2 = document.querySelector('.simple-ui')
      if (simpleUi2) simpleUi2.style.pointerEvents = ''
      // Don't clear oscillator overlay when menu closes
      if (this.mode !== 'oscillator' || !this.playing) {
        this.innerHTML = ''
      }
    }
  }

  showAddStationModal() {
    const modal = document.createElement('div')
    modal.classList.add('add-station-modal', 'modal')
    modal.innerHTML = `
      <div class="modal">
        <div class="box">
          <h1>Add Radio Station</h1>
          <div class="search-section">
            <input type="text" placeholder="Search stations..." class="station-search" />
            <div class="search-results"></div>
          </div>
          <hr />
          <p style="color:#888;font-size:12px;margin:4px 0">Or add manually:</p>
          <input type="text" placeholder="Station name" class="station-name" />
          <input type="text" placeholder="Stream URL" class="station-url" />
          <button class="submit">Add</button>
        </div>
      </div>
    `
    s('#app').appendChild(modal)

    let searchTimeout = null
    const searchInput = modal.querySelector('.station-search')
    const resultsDiv = modal.querySelector('.search-results')

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout)
      const query = searchInput.value.trim()
      if (query.length < 2) { resultsDiv.innerHTML = ''; return }
      searchTimeout = setTimeout(async () => {
        resultsDiv.innerHTML = '<p style="color:#888;font-size:12px">Searching...</p>'
        try {
          const res = await fetch(`https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(query)}&limit=20&order=votes&reverse=true&hidebroken=true`)
          const stations = await res.json()
          if (stations.length === 0) {
            resultsDiv.innerHTML = '<p style="color:#888;font-size:12px">No stations found</p>'
            return
          }
          resultsDiv.innerHTML = stations.map(st =>
            `<div class="search-result" data-name="${st.name.replace(/"/g, '&quot;')}" data-url="${st.url_resolved || st.url}">
              <span class="sr-name">${st.name}</span>
              <span class="sr-meta">${st.country || ''}${st.tags ? ' · ' + st.tags.split(',').slice(0,3).join(', ') : ''}</span>
              <span class="sr-actions">
                <button class="sr-play" title="Play">&#9654;</button>
                <button class="sr-add" title="Add to favorites">+</button>
              </span>
            </div>`
          ).join('')
          resultsDiv.querySelectorAll('.sr-play').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const row = e.target.closest('.search-result')
              modal.remove()
              this.setAttribute('open', 'false')
              this.playShoutcast(row.getAttribute('data-url'))
            })
          })
          resultsDiv.querySelectorAll('.sr-add').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const row = e.target.closest('.search-result')
              this.addFavorite(row.getAttribute('data-name'), row.getAttribute('data-url'))
              btn.textContent = '✓'
              btn.disabled = true
            })
          })
        } catch {
          resultsDiv.innerHTML = '<p style="color:#f66;font-size:12px">Search failed</p>'
        }
      }, 400)
    })

    modal.querySelector('.submit').addEventListener('click', () => {
      const name = modal.querySelector('.station-name').value.trim()
      const url = modal.querySelector('.station-url').value.trim()
      if (name && url) {
        this.addFavorite(name, url)
        modal.remove()
        this.render()
      }
    })
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('modal')) {
        modal.remove()
      }
    })
    setTimeout(() => searchInput.focus())
  }

  stopCurrentAudio() {
    // Ahead of the `playing` guard: a station that is still connecting has not
    // set `playing` yet, and its fetch and its element would otherwise run on
    // under whatever is started next.
    this.stopStream()
    if (!this.playing) return
    if (this.mode === 'external') {
      this.unsubscribe?.()
      this.unsubscribe = null
      cancelAnimationFrame(this.externalFrame)
    }
    if (this.mode === 'file') {
      try { this.audioSource.stop() } catch {}
    } else if (this.mode === 'mic') {
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop())
        this.micStream = null
      }
    } else if (this.mode === 'oscillator') {
      if (this.oscillatorNode) {
        try { this.oscillatorNode.stop() } catch {}
        this.oscillatorNode = null
      }
      // The overlay goes with the tone, however it was stopped.
      this.innerHTML = ''
    }
    if (this.context) {
      this.context.close()
      this.context = null
    }
    this.playing = false
    setPlayingState(false)
    this.beatGrid = null
    this.nextBeatIndex = 0
    this.sendSilence()
  }

  async analyzeBeatGrid(buffer) {
    try {
      const { bpm, offset } = await guess(buffer)
      const beatInterval = 60 / bpm
      const beats = []
      for (let t = offset; t < buffer.duration; t += beatInterval) {
        beats.push(t)
      }
      this.beatGrid = beats
      this.nextBeatIndex = 0
      console.log(`Beat detection: ${bpm.toFixed(1)} BPM, ${beats.length} beats`)
    } catch (err) {
      console.warn('Beat detection failed, using spectral fallback:', err)
      this.beatGrid = null
    }
  }

  togglePlay() {
    if (this.playing) {
      this.stopCurrentAudio()
      const pb = getPlayBtn()
      if (pb) pb.innerHTML = icons.play
    } else if (playButtonAction({ playing: false, offered: host().sources.list }) === 'external') {
      // Music is the only source: follow it again.
      this.playExternal()
    } else {
      if (this.getAttribute('open') === 'true') {
        this.setAttribute('open', 'false')
      } else {
        this.setAttribute('open', 'true')
      }
    }
  }

  /**
   * Plays a station: the element sounds it, a second connection feeds the plate.
   *
   * See the notes at the top of this file for why it is two connections. The
   * two halves fail independently and on purpose — the station is heard if the
   * element can play it, the plate moves if the copy can be fetched under CORS
   * and decoded, and neither needs the other to have worked.
   */
  async playShoutcast(url) {
    this.stopCurrentAudio()
    this.mode = 'stream'
    const pb = getPlayBtn()
    if (pb) pb.innerHTML = `<img src="spinner.svg" width="22" height="22" />`

    // Both the context and the element have to be reached inside the click that
    // started this — iOS unlocks audio on a gesture and nothing later counts.
    this.context = new AudioCtx()
    this.context.resume()
    const turn = new AbortController()
    this.streamTurn = turn
    this.streamNext = 0
    this.streamAudible = false
    this.streamCopyDead = false
    this.streamElementDead = false

    // No `crossorigin` here. The element only has to make sound, and without
    // that attribute it plays a cross-origin stream freely; asking for CORS
    // would make a station that sends no headers fail to load at all, which is
    // what used to happen. The CORS request belongs to the copy alone.
    const el = document.createElement('audio')
    el.src = url
    this.audioTag = el

    // The element is allowed to be late. `play()` on a live stream stays
    // pending until the station actually starts, and one that takes longer than
    // the race below still starts eventually — measured at eight seconds on a
    // station that also had the copy's connection to serve. Without a handover
    // that is the station playing twice, a second or two apart, because the
    // fallback had already turned the graph up. So whenever the element gets
    // going it takes the sound, and the graph goes back to feeding the plate.
    el.onplaying = () => {
      if (this.streamTurn !== turn || this.streamAudible) return
      this.streamAudible = true
      el.muted = this.monitoring
      this.cleanOutputNode.gain.setValueAtTime(0, this.context.currentTime)
      // The copy was scheduled a second ahead to survive stalls while it was
      // the one being heard. Nothing downstream of it is audible now, so it
      // goes back to the short lead the plate wants.
      this.dropStreamBacklog()
      this.markStreamPlaying()
    }

    // The bus every decoded lump plays into, standing in for the single source
    // node the rest of this component expects.
    this.audioSource = this.context.createGain()
    this.playing = true
    setPlayingState(true)
    this.startCymatics()
    // Silent until the element has answered: if it takes the station, this path
    // stays at zero for good, because playing the copy as well would double the
    // music a fraction of a second out of step.
    this.cleanOutputNode.gain.setValueAtTime(0, this.context.currentTime)

    // The station going away — but only once the element is the one holding it.
    // An element that never took it has failed at nothing the copy needs, and
    // tearing the station down for its error would stop a stream that is about
    // to be heard perfectly well through the graph. What is left when both
    // halves have given up is nothing, and that does stop.
    const elementLost = () => {
      if (this.streamTurn !== turn) return
      this.streamElementDead = true
      if (this.streamAudible || this.streamCopyDead) this.stopCurrentAudio()
    }
    el.onerror = elementLost
    el.onended = elementLost

    // Bounded, because `play()` on a live stream stays pending until playback
    // actually starts, and a host that accepts the connection and then says
    // nothing leaves it pending for good.
    const audible = await Promise.race([
      el.play().then(() => true).catch(() => false),
      new Promise(r => setTimeout(() => r(false), ELEMENT_START_MS)),
    ])
    if (this.streamTurn !== turn) return
    // `onplaying` may have got there first, in which case the element has the
    // sound already and this answer is stale.
    if (!this.streamAudible) {
      this.streamAudible = audible
      if (!audible) {
        // An autoplay refusal, a codec the element will not have, or a station
        // slow enough to miss the race — the last of which `onplaying` above
        // takes back when it finally starts. Until then the graph makes the
        // sound: quieter on iOS, where Web Audio sits on the ringer's volume
        // curve rather than the media one, but sound.
        console.warn('Stream element has not started; sounding the decoded copy instead')
        this.cleanOutputNode.gain.setValueAtTime(this.monitoring ? 0 : 1, this.context.currentTime)
      }
    }
    if (this.streamAudible) this.markStreamPlaying()

    this.pumpStream(url, turn)
  }

  /** Swaps the spinner for the pause icon, once something is actually playing. */
  markStreamPlaying() {
    const pb = getPlayBtn()
    if (pb) {
      pb.innerHTML = icons.pause
      const svg = pb.querySelector('svg')
      if (svg) svg.style.fill = 'white'
    }
    setPlayingState(true)
  }

  /**
   * Reads the copy of the stream, cuts it on frame boundaries and decodes it.
   *
   * Runs for as long as the station does. Not awaited by the caller: it settles
   * when the stream ends or is stopped, and neither is news to anyone.
   */
  async pumpStream(url, turn) {
    let reader
    try {
      const res = await fetch(url, { signal: turn.signal })
      if (!res.ok) throw new Error(`Station returned ${res.status}`)
      // Safari below 14.1 has fetch but not a readable response body, and a
      // stream cannot be waited for in one piece.
      if (!res.body) throw new Error('This browser cannot read a stream as it arrives')
      reader = res.body.getReader()

      let pending = new Uint8Array(0)
      /** The previous lump's tail, re-fed to warm the decoder up. */
      let warm = new Uint8Array(0)
      /** Whether anything has reached the plate yet. */
      let decoded = false

      while (!turn.signal.aborted && this.streamTurn === turn) {
        const { done, value } = await reader.read()
        if (done) break

        pending = concat(pending, value)

        // Decode in useful lumps rather than per read: a read can be a few
        // hundred bytes, and a scheduled node per few hundred bytes is a lot of
        // nodes for a fraction of a second of sound. The first lump is kept
        // short so the plate has something to show while the rest arrives.
        if (pending.length < (decoded ? STREAM_CHUNK : STREAM_FIRST_CHUNK)) continue

        const cut = lastFrameEnd(pending)
        if (cut === 0) {
          // Nothing decodable — an AAC stream, or a wrapper this parser does not
          // know. Guard against `pending` growing for as long as the station
          // plays; the music is still being heard through the element.
          if (pending.length > STREAM_CHUNK * 4) {
            pending = new Uint8Array(0)
            // The warm-up frames belong to bytes that have just been thrown
            // away; splicing them onto whatever arrives next would hand the
            // decoder two unrelated runs joined together.
            warm = new Uint8Array(0)
          }
          continue
        }

        const fresh = pending.slice(0, cut)
        pending = pending.slice(cut)
        // The previous lump's last frames go in front, so the decoder has what
        // this lump's first frames borrowed from. See `reservoirTail`.
        const fed = warm.length ? concat(warm, fresh) : fresh
        warm = reservoirTail(fresh)
        if (await this.pushStreamChunk(fed, fresh, turn)) {
          if (!decoded && !this.streamAudible) this.markStreamPlaying()
          decoded = true
        }
      }
      // The read loop ending is the station ending — but only the element can
      // say that once the element is the one sounding it. The copy is a second
      // connection with a life of its own, and plenty of servers drop the
      // duplicate a few seconds in.
      this.copyLost(turn)
    } catch (err) {
      if (err?.name === 'AbortError') return
      // CORS decides whether this app may READ a stream; the element needs no
      // such permission to play one. So a failure here is the plate going dark,
      // not the station — SomaFM refuses any request carrying an `Origin`
      // header and plays perfectly well in the element regardless.
      console.warn('Stream copy failed, the plate rests:', err)
      this.copyLost(turn)
    } finally {
      reader?.cancel().catch(() => {})
    }
  }

  /**
   * The copy has stopped being an answer — it failed, or the connection ended.
   *
   * Only the plate goes dark, as long as the element is sounding the station or
   * might still start. "Might still start" is the case worth being patient
   * about: a station that refuses the copy usually refuses it within a few
   * hundred milliseconds, long before the element it is happily serving has
   * played its first sample.
   */
  copyLost(turn) {
    if (this.streamTurn !== turn) return
    this.streamCopyDead = true
    if (this.streamAudible) return
    if (this.streamElementDead) {
      this.stopCurrentAudio()
      return
    }
    setTimeout(() => {
      if (this.streamTurn === turn && !this.streamAudible) this.stopCurrentAudio()
    }, ELEMENT_GRACE_MS)
  }

  /**
   * One decoded lump, scheduled after the last. Reports whether a node was
   * actually scheduled, so the caller can tell "nothing has played yet" from
   * "played, then stopped".
   */
  async pushStreamChunk(fed, fresh, turn) {
    const ctx = this.context
    if (!ctx) return false
    // Both scans happen before the decode: `decodeAudioData` detaches the
    // ArrayBuffer it is handed, and a scan of a detached view finds no frames
    // at all — which would leave the warm-up unaccounted for and play it, once
    // every lump. `fresh` is measured on its own because it is the part that
    // has not been heard; everything the decoder returns beyond it is the
    // duplicated warm-up and the decoder's own startup silence.
    const freshSpan = scan(fresh)
    const fedSpan = scan(fed)

    let buffer
    try {
      buffer = await decodeAudio(ctx, fed.buffer)
    } catch {
      return false // a lump that will not decode; the next one usually will
    }
    if (!buffer) return false
    // The stream may have been stopped while that decode was in flight, taking
    // the graph these nodes would have played into with it.
    if (this.streamTurn !== turn || !this.audioSource || !this.context) return false

    const cut = streamSlice({
      decoded: buffer.length,
      contextRate: ctx.sampleRate,
      fresh: freshSpan,
      fed: fedSpan,
      silence: limit => leadingSilence(buffer, limit),
    })
    const plays = cut.plays / ctx.sampleRate

    // Resync rather than accumulate. `startAt` has a floor and no ceiling, so
    // any bias where less is played than arrives grows for the whole session and
    // nothing can bring it down. Live radio has nothing to gain from being far
    // behind, so past the ceiling the backlog is dropped and the copy rejoins
    // the present.
    const ceiling = this.streamAudible ? STREAM_MAX_PLATE_AHEAD : STREAM_MAX_AHEAD
    if (this.streamNext - ctx.currentTime > ceiling) this.dropStreamBacklog()

    // A lead no shorter than what the output buffer itself costs on this
    // device; `baseLatency` can be missing or absurd, and `start(NaN)` throws,
    // which would take the read loop with it.
    const base = ctx.baseLatency
    const safe = typeof base === 'number' && isFinite(base) && base > 0 ? base : 0
    const floor = this.streamAudible ? PLATE_LEAD : STREAM_LEAD
    const lead = Math.min(2, Math.max(floor, safe * 2 + 0.02))

    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(this.audioSource)
    const startAt = Math.max(ctx.currentTime + lead, this.streamNext)
    this.streamNext = startAt + plays
    node.onended = () => {
      node.disconnect()
      this.streamNodes.delete(node)
    }
    this.streamNodes.add(node)
    node.start(startAt, cut.skip / ctx.sampleRate, plays)
    return true
  }

  /** Drops every scheduled lump, keeping the connection. */
  dropStreamBacklog() {
    for (const node of this.streamNodes) {
      // Nulled before stopping: a node stopped before its scheduled start does
      // not fire onended on every engine, and one that never fires is never
      // disconnected.
      node.onended = null
      try { node.stop() } catch {}
      node.disconnect()
    }
    this.streamNodes.clear()
    this.streamNext = 0
  }

  /** Tears down both halves of a station. Safe to call when none is playing. */
  stopStream() {
    this.streamTurn?.abort()
    this.streamTurn = null
    this.dropStreamBacklog()
    this.streamAudible = false
    if (this.audioTag) {
      this.audioTag.onerror = null
      this.audioTag.onended = null
      this.audioTag.onplaying = null
      this.audioTag.pause()
      // Emptied and reloaded, or the element holds the connection open for as
      // long as the page lives.
      this.audioTag.removeAttribute('src')
      this.audioTag.load()
      this.audioTag = null
    }
  }

  playFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/flac,audio/aac,audio/opus,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus'
    input.onchange = (e) => {
      input.remove()
      const file = e.target.files?.[0]
      if (!file) return
      // Create and resume AudioContext synchronously here — file selection is a
      // user gesture on iOS, so this is the last safe moment to unlock audio.
      this.stopCurrentAudio()
      this.context = new AudioCtx()
      this.context.resume()
      this.mode = 'file'
      const pb = getPlayBtn()
      if (pb) pb.innerHTML = `<img src="spinner.svg" width="22" height="22" />`
      file.arrayBuffer()
        .then(ab => this.context.decodeAudioData(ab))
        .then(buffer => {
          this.audioSource = this.context.createBufferSource()
          this.audioSource.buffer = buffer
          this.audioSource.onended = () => {
            try { this.audioSource.stop() } catch {}
            const pb = getPlayBtn()
            if (pb) { pb.innerHTML = icons.play; if (pb.querySelector('svg')) pb.querySelector('svg').style.fill = 'white' }
            this.playing = false
            setPlayingState(false)
          }
          if (this.looping) {
            this.audioSource.loop = true
            this.audioSource.loopStart = 0
            this.audioSource.loopEnd = buffer.duration
          }
          this.audioSource.start()
          this.playbackStartTime = this.context.currentTime
          const pb2 = getPlayBtn()
          if (pb2) { pb2.innerHTML = icons.pause; if (pb2.querySelector('svg')) pb2.querySelector('svg').style.fill = 'white' }
          this.playing = true
          setPlayingState(true)
          this.startCymatics()
          // Analyze beats in background (don't block playback)
          this.analyzeBeatGrid(buffer)
        })
        .catch(err => {
          console.error('Audio file load failed:', err)
          const pb = getPlayBtn()
          if (pb) pb.innerHTML = icons.play
          try { this.context?.close() } catch {}
          this.context = null
          this.playing = false
          setPlayingState(false)
        })
    }
    input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none'
    document.body.appendChild(input)
    input.click()
    // Remove if the user cancels without selecting a file
    setTimeout(() => input.remove(), 30000)
  }

  async playFromFile(file) {
    this.playFromBuffer(await engine.api.fileToAudiobuffer(file))
  }

  async playFromBuffer(buffer) {
    this.stopCurrentAudio()
    this.mode = 'file'
    const pb = getPlayBtn()
    if (pb) pb.innerHTML = `<img src="spinner.svg" width="22" height="22" />`
    this.context = new AudioCtx()
    await this.context.resume()
    this.audioSource = this.context.createBufferSource()
    this.audioSource.buffer = buffer
    this.audioSource.onended = () => {
      this.audioSource.stop()
      const pb = getPlayBtn()
      if (pb) { pb.innerHTML = icons.play; if (pb.querySelector('svg')) pb.querySelector('svg').style.fill = 'white' }
      this.playing = false
      setPlayingState(false)
    }
    if (this.looping) {
      this.audioSource.loop = true
      this.audioSource.loopStart = 0
      this.audioSource.loopEnd = buffer.duration
    }
    this.audioSource.start()
    this.playbackStartTime = this.context.currentTime
    const pb2 = getPlayBtn()
    if (pb2) pb2.innerHTML = icons.pause
    this.playing = true
    setPlayingState(true)
    this.startCymatics()
    this.analyzeBeatGrid(buffer)
  }

  playMicrophone() {
    this.stopCurrentAudio()
    this.mode = 'mic'
    // Create and resume context synchronously within the user gesture (iOS requirement)
    this.context = new AudioCtx()
    this.context.resume()
    const pb = getPlayBtn()
    if (pb) pb.innerHTML = `<img src="spinner.svg" width="22" height="22" />`
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Microphone requires a secure connection (HTTPS).')
      const pb = getPlayBtn()
      if (pb) pb.innerHTML = icons.play
      setPlayingState(false)
      try { this.context?.close() } catch {}
      this.context = null
      return
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      this.micStream = stream
      this.audioSource = this.context.createMediaStreamSource(stream)
      this.playing = true
      setPlayingState(true)
      const pb2 = getPlayBtn()
      if (pb2) { pb2.innerHTML = icons.pause; if (pb2.querySelector('svg')) pb2.querySelector('svg').style.fill = 'white' }
      this.startCymatics()
    }).catch(err => {
      console.error('Microphone access denied:', err)
      const pb3 = getPlayBtn()
      if (pb3) pb3.innerHTML = icons.play
      setPlayingState(false)
      try { this.context?.close() } catch {}
      this.context = null
      if (host().sources.external) {
        this.playExternal()
        s('cymatics-presets')?.say?.('The microphone was not allowed, so Cymatics follows Music again.')
      }
    })
  }

  async playOscillator(freq = this.oscFreq) {
    this.stopCurrentAudio()
    this.mode = 'oscillator'
    this.context = new AudioCtx()
    await this.context.resume()
    this.oscillatorNode = this.context.createOscillator()
    this.oscillatorNode.type = 'sine'
    this.oscillatorNode.frequency.setValueAtTime(freq, this.context.currentTime)
    // Use oscillator as the audio source for the cymatics chain
    this.audioSource = this.oscillatorNode
    this.oscillatorNode.start()
    this.playing = true
    setPlayingState(true)
    const pb = getPlayBtn()
    if (pb) { pb.innerHTML = icons.pause; pb.querySelector('svg').style.fill = 'white' }
    this.startCymatics()
  }

  setOscillatorFrequency(value) {
    this.oscFreq = value
    if (this.oscillatorNode) {
      // A short glide rather than a jump: stepping the frequency mid-cycle
      // clicks, and dragging the slider steps it every frame.
      this.oscillatorNode.frequency.setTargetAtTime(value, this.context.currentTime, 0.015)
    }
  }

  connectEq(monitor = false) {
    if (!this.audioSource || !this.context) return
    this.monitoring = monitor
    const now = this.context.currentTime
    const wantsMonitor = monitor && this.mode !== 'mic'
    // Toggle monitor: when on, mute the clean path and enable EQ→speakers
    // When off, restore clean path and mute the EQ→speakers path.
    //
    // For a station the element is sounding, the element is the clean path —
    // the graph's copy of it is silent whatever this does, so it is the element
    // that has to step aside for the EQ'd one.
    // `muted`, not `volume`: iOS ignores a volume set from script, and this is
    // the platform the element path exists for.
    if (this.streamAudible && this.audioTag) this.audioTag.muted = wantsMonitor
    const clean = this.streamAudible || wantsMonitor ? 0 : 1
    if (this.cleanOutputNode) this.cleanOutputNode.gain.setValueAtTime(clean, now)
    if (this.monitorNode) this.monitorNode.gain.setValueAtTime(wantsMonitor ? 1 : 0, now)
    // Apply current EQ values to the filter nodes
    equalizerDefaults.forEach((eq, index) => {
      const filter = `eq${eq.frequency}`
      if (window[filter]) {
        window[filter].gain.value = monitor ? s('p-equalizer').equalizer[index].value : 0.0
      }
    })
  }

  // One spectrum frame, whatever it came from: to the engine, then the bands
  // and every modulator the panel has switched on. The modulators are rebuilt
  // only when a setting changes; their gates carry over.
  feed(bins, sampleRate, { beatKick = null } = {}) {
    engine.api.pushAudioSpectrum(bins, bins.length, sampleRate)
    if (!engine.state.ready) return
    if (!this.follower) {
      this.follower = createBandFollower()
      this.modulators = createModulators([], { lights: () => engine.state.rendererConfig.lights || [] })
      this.dynKey = ''
    }
    const f = this.follower.step(bins, sampleRate, { beatKick })
    window.__lastBands = f.bands
    window.__lastBandsOverall = f.overall
    window.__lastBandsKick = f.kick
    window.dispatchEvent(new Event('bandsupdated'))
    if (window.__onBandsUpdated) window.__onBandsUpdated(f.bands, f.overall, f.kick)
    const dyn = dynamicState()
    const key = JSON.stringify(dyn)
    if (key !== this.dynKey) { this.dynKey = key; this.modulators.update(presetModulators(dyn)) }
    this.modulators.step(f, (section, name, value) => {
      s('p-cymatics').updateControl(name, value)
      if (name === 'freq_response_speed') window.__autoResponseSpeedValue = value
      const slider = typeof value === 'number' ? document.querySelector(`input[name="${name}"]`) : null
      if (slider) slider.value = value * 100
    })
  }

  // The EQ's filters, on `ctx`. p-equalizer.js sets their gains through
  // window.eq<frequency>, whichever source is playing; a gain already set
  // carries over, so switching source keeps the EQ.
  createEqFilters(ctx) {
    equalizerDefaults.forEach((eq) => {
      const key = `eq${eq.frequency}`
      const gain = window[key]?.gain?.value ?? 0
      window[key] = ctx.createBiquadFilter()
      window[key].type = eq.type
      window[key].frequency.value = eq.frequency
      window[key].gain.value = gain
      if (eq.Q) window[key].Q.value = eq.Q
    })
  }

  // The host's spectrum (Music, on the desktop) instead of an audio source.
  // Frames come about 30 times a second and the plate renders at 60, so the
  // latest one is fed every animation frame; with none for a while the plate
  // eases into the element's idle swell, as <cymatics-view> does. The EQ is
  // applied as its filters' frequency response.
  playExternal() {
    const source = host().sources.external
    if (!source) return
    this.stopCurrentAudio()
    this.mode = 'external'
    this.follower = null
    // The filters answer for frequencies below their context's Nyquist only,
    // so they are made at the rate the frames come at, and again if it changes.
    let filters = []
    const filtersAt = (rate) => {
      if (!this.eqContext || this.eqContext.sampleRate !== rate) this.eqContext = new OfflineAudioContext(1, 1, rate)
      if (!window.eq60 || window.eq60.context !== this.eqContext) this.createEqFilters(this.eqContext)
      filters = equalizerDefaults.map((eq) => window[`eq${eq.frequency}`])
    }
    filtersAt(48000)
    const real = new Float32Array(BINS)
    const idle = new Float32Array(BINS)
    const mixed = new Float32Array(BINS)
    const shaped = new Float32Array(BINS)
    let sampleRate = 48000
    let lastPush = -Infinity
    let lastSignal = -Infinity
    let offsets = null
    let frame = 0
    this.unsubscribe = source.subscribe((bins, rate) => {
      if (!bins || bins.length !== BINS) return
      real.set(bins)
      sampleRate = rate || sampleRate
      lastPush = performance.now()
      if (hasSignal(bins)) lastSignal = lastPush
    })
    this.playing = true
    setPlayingState(true)
    const tick = () => {
      if (this.mode !== 'external' || !this.playing) return
      const now = performance.now()
      freshSpectrum(real, now - lastPush)
      const weight = idleWeight(now - lastSignal)
      if (weight > 0) idleSpectrum(now / 1000, idle)
      blend(real, idle, weight, mixed)
      // The EQ moves rarely; its response is recomputed twice a second.
      if (!offsets || frame % 30 === 0) {
        if (this.eqContext.sampleRate !== sampleRate) filtersAt(sampleRate)
        offsets = eqOffsets(filters, binFrequencies(BINS, sampleRate), offsets || undefined)
      }
      frame += 1
      this.feed(applyOffsets(mixed, offsets, shaped), sampleRate)
      this.externalFrame = requestAnimationFrame(tick)
    }
    tick()
  }

  sendSilence() {
    const freqBins = 1024
    const silent = new Float32Array(freqBins) // all zeros
    let frames = 0
    const send = () => {
      engine.api.pushAudioSpectrum(silent, freqBins)
      frames++
      if (frames < 120) requestAnimationFrame(send)
    }
    send()
  }

  setInputGain(value) {
    if (this.inputGainNode) {
      this.inputGainNode.gain.setValueAtTime(value, this.context.currentTime)
    }
  }

  startCymatics() {
    const audioContext = this.context
    this.monitoring = false

    // Create analyser: 2048-point FFT gives 1024 frequency bins
    this.analyser = audioContext.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.3

    // Input gain node for sensitivity control (visualizer path only)
    this.inputGainNode = audioContext.createGain()
    this.inputGainNode.gain.setValueAtTime(1, audioContext.currentTime)

    // Split audio into two independent paths:
    // 1) Speakers: source → destination (clean, unprocessed audio)
    // 2) Visualizer: source → inputGain → EQ → analyser → engine
    if (this.audioSource) this.audioSource.disconnect()
    if (this.eqInputNode) this.eqInputNode.disconnect()

    // Path 1: clean audio to speakers (skip for mic to avoid echo). The tone is
    // heard, but quietly and faded in: a full-scale square wave is harsh, and
    // the analyser below still gets it at full level.
    this.cleanOutputNode = audioContext.createGain()
    this.cleanOutputNode.gain.setValueAtTime(1, audioContext.currentTime)
    if (this.mode === 'oscillator') {
      this.cleanOutputNode.gain.setValueAtTime(0, audioContext.currentTime)
      this.cleanOutputNode.gain.linearRampToValueAtTime(TONE_VOLUME, audioContext.currentTime + 0.05)
    }
    if (this.mode !== 'mic') {
      this.audioSource.connect(this.cleanOutputNode)
      this.cleanOutputNode.connect(audioContext.destination)
    }

    // Path 2: visualizer chain
    this.eqInputNode = audioContext.createGain()
    this.eqInputNode.gain.setValueAtTime(1, audioContext.currentTime)
    this.audioSource.connect(this.inputGainNode)
    this.inputGainNode.connect(this.eqInputNode)

    this.createEqFilters(audioContext)
    this.eqInputNode.connect(window.eq60)
    window.eq60.connect(window.eq170)
    window.eq170.connect(window.eq310)
    window.eq310.connect(window.eq600)
    window.eq600.connect(window.eq1000)
    window.eq1000.connect(window.eq3000)
    window.eq3000.connect(window.eq6000)
    window.eq6000.connect(window.eq12000)
    window.eq12000.connect(window.eq16000)
    window.eq16000.connect(this.analyser)
    // Monitor node — connects EQ output to speakers when monitoring is on
    this.monitorNode = audioContext.createGain()
    this.monitorNode.gain.setValueAtTime(0, audioContext.currentTime) // off by default
    window.eq16000.connect(this.monitorNode)
    this.monitorNode.connect(audioContext.destination)

    // Send frequency-domain spectrum to the engine each frame.
    const freqBins = this.analyser.frequencyBinCount  // 1024
    const floatData = new Float32Array(freqBins)
    const byteFreqData = new Uint8Array(freqBins)
    // Reusable buffer handed to the engine each frame.
    const uploadBuf = new Float32Array(freqBins)

    // Detect if getFloatFrequencyData works (Safari may return all -Infinity)
    let useFloatFFT = null // null = not yet tested

    // A new source starts with fresh bands and gates.
    this.follower = null

    const upload = () => {
      if (useFloatFFT === null || useFloatFFT === true) {
        this.analyser.getFloatFrequencyData(floatData)
        // Test on first frame: if all values are -Infinity, fall back to byte version
        if (useFloatFFT === null) {
          useFloatFFT = floatData[0] > -Infinity || floatData[10] > -Infinity
        }
      }

      if (useFloatFFT) {
        // Float path: map -100dBFS..0dBFS → 0..1
        for (let i = 0; i < freqBins; i++) {
          uploadBuf[i] = Math.max(0, Math.min(1, (floatData[i] + 100) / 100))
        }
      } else {
        // Byte fallback (Safari): getByteFrequencyData returns 0-255
        this.analyser.getByteFrequencyData(byteFreqData)
        for (let i = 0; i < freqBins; i++) {
          uploadBuf[i] = byteFreqData[i] / 255
        }
      }

      // The beat grid (a decoded file) is the kick; otherwise the follower
      // finds kicks in the bass itself.
      let beatKick = null
      if (this.beatGrid && this.beatGrid.length > 0) {
        const beatDiv = window.__kickBeatDiv ?? 4
        const bufDuration = this.audioSource.buffer?.duration || Infinity
        const playbackTime = (audioContext.currentTime - this.playbackStartTime) % bufDuration
        while (this.nextBeatIndex < this.beatGrid.length && this.beatGrid[this.nextBeatIndex] < playbackTime - 0.03) {
          this.nextBeatIndex++
        }
        if (this.nextBeatIndex >= this.beatGrid.length) this.nextBeatIndex = 0
        const timeToBeat = this.beatGrid[this.nextBeatIndex] - playbackTime
        if (timeToBeat >= 0 && timeToBeat < 0.025) {
          if (this.nextBeatIndex % beatDiv === 0) beatKick = 1
          this.nextBeatIndex++
        }
        if (beatKick === null) beatKick = (this.follower?.kick ?? 0) * 0.88
        if (beatKick < 0.01) beatKick = 0
      }
      this.feed(uploadBuf, audioContext.sampleRate, { beatKick })

      if (this.playing) {
        requestAnimationFrame(upload)
      }
    }
    upload()
  }

}

customElements.define('p-audio', PuhdeAudio)
