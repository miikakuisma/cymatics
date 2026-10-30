// The studio, mounted on a page by whoever hosts it: the standalone app
// (src/index.js) or the desktop's Cymatics app (the library build,
// src/studio/index.js). `host` (./host.js) says where presets live, which
// sources to offer and whether the standalone-only parts show.
import './globals.js'
import '../../styles.css'
import "../components/cymatics-component.css"
import "../components/cymatics-controls.css"
import "../components/cymatics-presets.css"
import "../components/pole-config.css"
import "../components/p-nav.css"
import "../components/knob.css"
import "../components/xy-control.css"
import "../components/p-audio.css"
import "../components/p-equalizer.css"
import "../components/puhde-modal.css"
import "../components/band-meter.css"
import "../icons.js"
import "../components/cymatics-component.js"
import "../components/cymatics-controls.js"
import "../components/cymatics-presets.js"
import "../components/pole-config.js"
import "../components/p-nav.js"
import "../components/knob.js"
import "../components/xy-control.js"
import "../components/p-audio.js"
import "../components/p-equalizer.js"
import "../components/band-meter.js"

import { defaultPresets } from '../default-presets.js'
import { fileToScaledDataUrl, isImageFile } from '../image-util.js'
import { DEFAULT_LOOK, lookPreset } from '../element/looks.js'
import { host, setHost } from './host.js'
import { overDefaults, setEngineDefaults } from './look-config.js'
import { phoneQuery } from './layout.js'
import { initPhoneStudio } from './phone-studio.js'
import { captureStudio, restoreStudio } from './studio-snapshot.js'

const ABOUT = `
  <div class="about modal">
    <div class="box">
      <img src="icon.png" width="256" height="256" alt="Cymatics logo" />
      <button class="start" style="margin-top: 20px;">Start</button>
      <a href="https://j2bb1np2v2u.typeform.com/to/EIARUlm8" target="_blank">Feedback</a>
    </div>
  </div>
`

// What each phone phase puts on screen, one at a time: the picker is
// cymatics-presets as a sheet, the editor is cymatics-controls.
// studio-active is what lets the sheet show at all.
function show(phase) {
  const phone = phoneQuery().matches
  const picker = phone && phase === 'picker'
  const editor = phone && phase === 'editor'
  document.body.classList.toggle('studio-active', picker || editor)
  s('cymatics-presets').setAttribute('visible', picker ? 'true' : 'false')
  if (phone) s('cymatics-controls').setAttribute('visible', editor ? 'true' : 'false')
}

const launchApp = () => {
  const app = s('#app')
  const mode = app.getAttribute('mode')
  const params = new URLSearchParams(window.location.search)
  const isAdvanced = params.get('mode') === 'advanced'

  // Simple UI (viewer mode)
  const standalone = host().chrome.standalone
  // The simple play and fullscreen buttons belong to the standalone app; a
  // host has its own window around the studio.
  if (standalone) {
  const simpleUI = document.createElement('div')
  simpleUI.className = 'simple-ui'
  simpleUI.innerHTML = `
    <button class="simple-play-btn">${icons.play}</button>
    <button class="simple-fullscreen-btn">${icons.scaleToContain}</button>
  `
  app.appendChild(simpleUI)

  setTimeout(() => {
    s('.simple-play-btn').addEventListener('click', () => {
      s('p-audio').togglePlay()
    })
    s('.simple-fullscreen-btn').addEventListener('click', (e) => {
      const isCoverMode = s('p-cymatics').getAttribute('cover') === 'true'
      if (!isCoverMode) {
        s('p-cymatics').setAttribute('cover', 'true')
        e.currentTarget.innerHTML = icons.scaleToCover
      } else {
        s('p-cymatics').setAttribute('cover', 'false')
        e.currentTarget.innerHTML = icons.scaleToContain
      }
    })

    // Fade out play button on mouse idle (desktop only)
    const isTouch = matchMedia('(hover: none)').matches
    if (!isTouch) {
      let idleTimer = null
      const playBtn = s('.simple-play-btn')
      const showBtn = () => {
        playBtn.classList.remove('idle')
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => playBtn.classList.add('idle'), 3000)
      }
      document.addEventListener('mousemove', showBtn)
      document.addEventListener('mousedown', showBtn)
      showBtn()
    }
  })
  }

  // Studio UI (always in DOM, shown/hidden via studio-active class)
  const cymaticsControls = document.createElement('cymatics-controls')
  cymaticsControls.setAttribute('visible', 'false')
  app.appendChild(cymaticsControls)

  const cymaticsPresets = document.createElement('cymatics-presets')
  app.appendChild(cymaticsPresets)

  const puhdeNav = document.createElement('p-nav')
  app.appendChild(puhdeNav)

  initPhoneStudio({ capture: captureStudio, restore: restoreStudio, show })

  // Cog button (always visible in top-left corner)
  const cogBtn = document.createElement('button')
  cogBtn.id = 'studio-toggle-btn'
  cogBtn.innerHTML = icons.edit
  cogBtn.title = 'Toggle studio mode (Tab)'
  app.appendChild(cogBtn)

  // A hosted studio opens on the studio: that is what it was opened for.
  let studioActive = isAdvanced || !standalone

  const toggleStudio = () => {
    studioActive = !studioActive
    document.body.classList.toggle('studio-active', studioActive)
    cogBtn.classList.toggle('active', studioActive)
    s('cymatics-presets').setAttribute('visible', studioActive ? 'true' : 'false')
    s('cymatics-controls').setAttribute('visible', studioActive ? 'true' : 'false')
    const presetsBtn = s('[fn="presets"]')
    const editBtn = s('[fn="edit"]')
    if (presetsBtn) presetsBtn.classList.toggle('activated', studioActive)
    if (editBtn) editBtn.classList.toggle('activated', studioActive)
  }

  if (studioActive) {
    document.body.classList.add('studio-active')
    cogBtn.classList.add('active')
    cymaticsPresets.setAttribute('visible', 'true')
    cymaticsControls.setAttribute('visible', 'true')
  }

  cogBtn.addEventListener('click', toggleStudio)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.target.matches('input, textarea, select')) {
      e.preventDefault()
      toggleStudio()
    }
    // ⌘S saves over the open preset when it is yours; ⇧⌘S always asks.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (e.shiftKey) s('cymatics-presets').saveAs()
      else s('cymatics-presets').save()
    }
  })

  // File drop
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault()
    document.body.style.filter = 'brightness(1.5)'
  })
  document.body.addEventListener('dragleave', (e) => {
    e.preventDefault()
    document.body.style.filter = 'none'
  })
  document.body.addEventListener('drop', (e) => {
    e.preventDefault()
    document.body.style.filter = 'none'
    const audioExts = /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i
    const files = e.dataTransfer.items
      ? [...e.dataTransfer.items].filter(i => i.kind === 'file').map(i => i.getAsFile())
      : [...e.dataTransfer.files]
    const file = files[0]
    if (!file) return
    const isAudio = file.type.startsWith('audio/') || audioExts.test(file.name)
    if (isAudio) {
      s('p-audio').playFromFile(file)
    } else if (isImageFile(file)) {
      // Images set the water mode's pool floor.
      fileToScaledDataUrl(file)
        .then((dataUrl) => {
          s('p-cymatics').updateControl('floor_image', dataUrl)
          // Let the panel's thumbnail catch up if it happens to be open.
          window.dispatchEvent(new CustomEvent('cymatics:floor-image'))
        })
        .catch(e => console.warn('[cymatics] could not read that image:', e.message))
    }
  })

  // Start scene — use saved default if available, otherwise first factory preset
  // The engine's own values, before anything loads: every look and preset the
  // panel loads goes over these, as the element lays them.
  setEngineDefaults({
    renderer: engine.api.sendCommand('get renderer'),
    cymatics: engine.api.sendCommand('get cymatics'),
    liquid: engine.api.sendCommand('get liquid'),
  })
  const savedDefault = standalone ? localStorage.getItem('cymatics_default_preset') : null
  if (!standalone) {
    // A hosted studio starts on the default look, as the element does.
    const { renderer, cymatics, liquid } = lookPreset(DEFAULT_LOOK)
    s('p-cymatics').loadConfig(overDefaults({ renderer, cymatics, liquid }))
  } else if (savedDefault) {
    try {
      s('p-cymatics').loadConfig(JSON.parse(savedDefault))
    } catch (e) {
      s('p-cymatics').loadConfig(defaultPresets[0].preset)
    }
  } else {
    s('p-cymatics').loadConfig(defaultPresets[0].preset)
    // Mark it in the panel, which otherwise opens on the first look.
    const first = defaultPresets[0]
    s('cymatics-presets').current = { source: 'factory', id: first.objectId, name: first.name }
    s('cymatics-presets').listPresets()
  }

  // A host with a spectrum of its own (Music, on the desktop) is followed
  // from the start.
  if (host().sources.external) s('p-audio').playExternal()

  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
    // Mic access is now handled by p-audio's playMicrophone() button
  })
}

// When Wasm engine is ready, launch rest of the UI

// Resolves once the engine is ready, with what a host may ask of the studio.
export function mountStudio(root, rawHost) {
  setHost(rawHost)
  if (!root.id) root.id = 'app'
  root.setAttribute('mode', 'studio')
  root.innerHTML = `
    <div class="cymatics-wrapper">
      <p-cymatics></p-cymatics>
      <div class="preview"></div>
    </div>
    <p-audio></p-audio>
  `
  if (host().chrome.standalone) {
    root.insertAdjacentHTML('beforeend', ABOUT)
    const close = () => s('.about.modal')?.remove()
    s('.about.modal button.start').addEventListener('click', close)
    s('.about.modal').addEventListener('click', close)
  }
  return new Promise((resolve) => {
    const onReady = (e) => {
      if (e.data?.status !== 'ready') return
      removeEventListener('message', onReady)
      launchApp()
      resolve({
        open: (preset, meta) => s('cymatics-presets').open(preset, meta),
        save: () => s('cymatics-presets').save(),
        saveAs: () => s('cymatics-presets').saveAs(),
      })
    }
    addEventListener('message', onReady)
  })
}
