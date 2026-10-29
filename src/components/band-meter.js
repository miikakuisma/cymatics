const BAND_COUNT = 8
const BAND_LABELS = [
  'Sub-bass 40–80Hz',
  'Bass 80–160Hz',
  'Low-mid 160–320Hz',
  'Mid 320–640Hz',
  'Upper-mid 640–1280Hz',
  'Presence 1.3–2.6kHz',
  'Brilliance 2.6–5kHz',
  'Air 5–10kHz',
]

const IDLE_AFTER_MS = 400
const PEAK_GRAVITY = 0.0015
const PEAK_DECAY_START = 0.01

export class PuhdeBandMeter extends HTMLElement {

  constructor() {
    super()
    this.displayed = new Float32Array(BAND_COUNT)
    this.peaks = new Float32Array(BAND_COUNT)
    this.peakVel = new Float32Array(BAND_COUNT)
    this.hover = -1
    this.lastActive = 0
    this.startTime = performance.now()
  }

  connectedCallback() {
    this.innerHTML = `
      <canvas width="240" height="56"></canvas>
      <span class="band-meter-label">8 frequency bands — hover to identify</span>
    `
    this.canvas = this.querySelector('canvas')
    this.labelEl = this.querySelector('.band-meter-label')
    this.ctx = this.canvas.getContext('2d')

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      this.hover = Math.min(BAND_COUNT - 1, Math.max(0, Math.floor(x * BAND_COUNT)))
      if (this.labelEl) this.labelEl.textContent = `band${this.hover + 1} — ${BAND_LABELS[this.hover]}`
    })
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = -1
      if (this.labelEl) this.labelEl.textContent = '8 frequency bands — hover to identify'
    })

    const tick = () => {
      this.draw()
      this.raf = requestAnimationFrame(tick)
    }
    tick()
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
  }

  draw() {
    const ctx = this.ctx
    if (!ctx) return
    const w = this.canvas.width
    const h = this.canvas.height
    const gap = 3
    const barW = (w - gap * (BAND_COUNT - 1)) / BAND_COUNT
    const now = performance.now()

    // Pull latest band snapshot published by p-audio
    const live = window.__lastBands
    let hasSignal = false
    if (live && live.length >= BAND_COUNT) {
      for (let i = 0; i < BAND_COUNT; i++) {
        if ((live[i] || 0) > 0.02) { hasSignal = true; break }
      }
    }
    if (hasSignal) this.lastActive = now
    const idle = now - this.lastActive > IDLE_AFTER_MS

    ctx.clearRect(0, 0, w, h)

    // Baseline glow — always visible so widget reads as "alive"
    ctx.fillStyle = 'rgba(255, 70, 60, 0.12)'
    ctx.fillRect(0, h - 2, w, 2)

    for (let i = 0; i < BAND_COUNT; i++) {
      let target
      if (idle) {
        // Gentle left-to-right sweep: a moving bump across the 8 bars
        const phase = (now - this.startTime) * 0.0015
        const center = ((Math.sin(phase) + 1) / 2) * (BAND_COUNT - 1)
        const dist = Math.abs(i - center)
        target = Math.max(0.04, 0.22 * Math.exp(-dist * dist * 0.6))
      } else {
        target = Math.min(1, (live && live[i]) || 0)
      }

      // Smooth displayed value toward target (fast attack, slow decay)
      const prev = this.displayed[i]
      this.displayed[i] = target > prev ? prev * 0.4 + target * 0.6 : prev * 0.82 + target * 0.18
      const v = this.displayed[i]

      // Peak hold with gravity
      if (v > this.peaks[i]) {
        this.peaks[i] = v
        this.peakVel[i] = 0
      } else {
        this.peakVel[i] += PEAK_GRAVITY
        this.peaks[i] = Math.max(v, this.peaks[i] - this.peakVel[i] - PEAK_DECAY_START)
      }

      const barH = Math.max(2, v * (h - 4))
      const x = i * (barW + gap)
      const y = h - barH

      const grad = ctx.createLinearGradient(0, h, 0, 0)
      if (idle) {
        grad.addColorStop(0, 'rgba(255,80,60,0.55)')
        grad.addColorStop(1, 'rgba(255,180,80,0.55)')
      } else {
        grad.addColorStop(0, '#ff3028')
        grad.addColorStop(0.55, '#ff8833')
        grad.addColorStop(1, '#ffe066')
      }

      ctx.fillStyle = i === this.hover ? 'rgba(255,255,255,0.9)' : grad
      ctx.fillRect(x, y, barW, barH)

      // Peak marker
      const peakH = Math.max(2, this.peaks[i] * (h - 4))
      const peakY = h - peakH
      ctx.fillStyle = i === this.hover ? '#ffffff' : 'rgba(255,240,180,0.85)'
      ctx.fillRect(x, peakY, barW, 2)
    }
  }
}

customElements.define('band-meter', PuhdeBandMeter)
