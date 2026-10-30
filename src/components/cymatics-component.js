import { applyDynamicState } from '../dynamic-state.js'
import { phoneQuery } from '../studio/layout.js'
import { deskStudio } from '../studio/desk-studio.js'

export class PuhdeCymatics extends HTMLElement {

	constructor() {
    super()
		this.cover = false
  }

  connectedCallback() {
		// Setup Emscripten
		this.initialize()
  }

	static get observedAttributes() {
		return ['cover']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
		if (property === 'cover' && newValue === 'true') {
			let width = s('#canvas').getBoundingClientRect().width
			if (window.innerWidth > window.innerHeight) {
				this.style.transform = `translate(0px, 0) scale(${window.innerWidth / width})`
			} else {
				this.style.transform = `translate(0px, 0) scale(${window.innerHeight / width})`
			}
		}
		if (property === 'cover' && newValue === 'false') {
			this.style.transform = `translate(0px, 0px)`
		}
	}

	initialize() {
		window.addEventListener('message', async (e) => {
			if (!e.data) return
			const { status } = e.data
			if (status === 'ready') {
				this.classList.add('ready')
			}
		})

		const engineConfig = {
			container: this,
			width: 1024,
			height: 1024,
			color: '#ffffff',
			orientation: 'auto', // auto, landscape, portrait
		}

		if (window.engine) {
			window.engine = new engine(engineConfig)
		} else {

		}

		window.__autoResponseSpeed = false
		window.__autoResponseSpeedValue = 0.5
		window.__autoResponseSpeedMin = 0.15
		window.__autoResponseSpeedMax = 0.85
		window.__dynamicLightColor = false
		window.__dynamicLightDistance = false
		window.__dynamicLightColorMin = '#ff6600'
		window.__dynamicLightColorMax = '#ffffff'
		window.__dynamicLightDistanceMin = 10
		window.__dynamicLightDistanceMax = 49
		window.__dynamicFreqDetail = false
		window.__dynamicFreqDetailMin = 1
		window.__dynamicFreqDetailMax = 3
		window.__dynamicViewScale = false
		window.__dynamicViewScaleMin = 0.05
		window.__dynamicViewScaleMax = 0.45
		window.__dynamicLineColor = false
		window.__dynamicLineColorMin = '#003366'
		window.__dynamicLineColorMax = '#ff6600'
		window.__dynamicContourCount = false
		window.__dynamicContourCountMin = 2
		window.__dynamicContourCountMax = 32
		window.__dynamicFaradayThreshold = false
		window.__dynamicFaradayThresholdMin = 0
		window.__dynamicFaradayThresholdMax = 0.95

		// Frequency band assignments for each dynamic parameter
		// Values: 'band1'..'band8' (octave bands), 'kick', 'overall'
		window.__autoResponseSpeedBand = 'overall'
		window.__dynamicFreqDetailBand = 'band7'
		window.__dynamicViewScaleBand = 'band2'
		window.__dynamicLightDistanceBand = 'overall'
		window.__dynamicLightColorBand = 'overall'
		window.__dynamicLineColorBand = 'overall'
		window.__dynamicContourCountBand = 'band4'
		window.__dynamicFaradayThresholdBand = 'overall'

		// Band-energy trigger thresholds (0..1). When the selected band's energy
		// exceeds the trigger, the param snaps toward At peak; else At silence.
		window.__autoResponseSpeedTrigger = 0.3
		window.__dynamicFreqDetailTrigger = 0.3
		window.__dynamicViewScaleTrigger = 0.3
		window.__dynamicLightDistanceTrigger = 0.3
		window.__dynamicLightColorTrigger = 0.3
		window.__dynamicLineColorTrigger = 0.3
		window.__dynamicContourCountTrigger = 0.3
		window.__dynamicFaradayThresholdTrigger = 0.2

		// Ramp speed (0..1). 1 = snap instantly, 0 = very gradual.
		// Release (peak→silence) runs at ~15% of attack speed for natural feel.
		window.__autoResponseSpeedSpeed = 0.8
		window.__dynamicFreqDetailSpeed = 0.8
		window.__dynamicViewScaleSpeed = 0.8
		window.__dynamicLightDistanceSpeed = 0.8
		window.__dynamicLightColorSpeed = 0.8
		window.__dynamicLineColorSpeed = 0.8
		window.__dynamicContourCountSpeed = 0.8
		window.__dynamicFaradayThresholdSpeed = 0.8

		window.__kickBeatDiv = 4  // fire kick impulse every Nth beat (1=every, 2=half, 4=bar, 8=2bars)

		window.update = this.updateControl.bind(this)
	}

	updateControl(key, value) {
		// Update values to the engine
		// Check each config; if key not found in any, add to cymaticsConfig as fallback
		let found = false
		if (key in engine.state.rendererConfig) {
			engine.state.rendererConfig = {
				...engine.state.rendererConfig,
				[key]: value
			}
			engine.sendCommand(`set renderer ${JSON.stringify(engine.state.rendererConfig)}`)
			found = true
		}
		if (key in engine.state.cymaticsConfig) {
			engine.state.cymaticsConfig = {
				...engine.state.cymaticsConfig,
				[key]: value
			}
			engine.sendCommand(`set cymatics ${JSON.stringify(engine.state.cymaticsConfig)}`)
			found = true
		}
		if (key in engine.state.liquidConfig) {
			engine.state.liquidConfig = {
				...engine.state.liquidConfig,
				[key]: value
			}
			engine.sendCommand(`set liquid ${JSON.stringify(engine.state.liquidConfig)}`)
			found = true
		}
		// Fallback: if key not in any config yet, add it to cymaticsConfig
		// (handles new wave equation params before WASM reports them)
		if (!found) {
			engine.state.cymaticsConfig[key] = value
			engine.sendCommand(`set cymatics ${JSON.stringify(engine.state.cymaticsConfig)}`)
		}
	}

	loadConfig(preset) {

		// Legacy presets carry reflection/refraction map paths from the days the
		// PBR path was the only one. Nothing can set them any more and no shipped
		// render path samples them, so drop them rather than fetch files that are
		// no longer there ('dot.png', 'empty.png').
		delete preset.cymatics.reflectionImage
		delete preset.cymatics.refractionImage

		// Every modulator setting comes from this preset; one the preset does
		// not have is cleared, so nothing carries over from the last one.
		applyDynamicState(preset)
		if (preset.cymatics?.autoResponseSpeed && window.__autoResponseSpeedValue === undefined) window.__autoResponseSpeedValue = 0.5
		// Band names saved before the octave bands (bass/mid/high) read as their
		// octave, so the panel's band menus show them.
		const LEGACY_BAND_ALIAS = { bass: 'band2', mid: 'band4', high: 'band7' }
		for (const key of Object.keys(window)) {
			if (key.startsWith('__') && key.endsWith('Band') && LEGACY_BAND_ALIAS[window[key]]) window[key] = LEGACY_BAND_ALIAS[window[key]]
		}
		if (preset) {
			// Merge over what the engine currently reports rather than replacing
			// it. updateControl() routes a control by looking its key up in these
			// three objects, so any engine parameter added after a preset was
			// saved would otherwise be missing from state and its control would
			// silently write to the wrong config.
			engine.state.rendererConfig = { ...engineApi.sendCommand(`get renderer`), ...preset.renderer }
			engine.state.cymaticsConfig = { ...engineApi.sendCommand(`get cymatics`), ...preset.cymatics }
			engine.state.liquidConfig = { ...engineApi.sendCommand(`get liquid`), ...preset.liquid }
		}
		engineApi.sendCommand(`set renderer ${JSON.stringify(engine.state.rendererConfig)}`)
		engineApi.sendCommand(`set cymatics ${JSON.stringify(engine.state.cymaticsConfig)}`)
		engineApi.sendCommand(`set liquid ${JSON.stringify(engine.state.liquidConfig)}`)
		// set slider values
		const studioMode = s('#app').getAttribute('mode') === 'studio'
		for (let key in preset.renderer) {
			if (studioMode) {
				const input = s(`input[type="range"][name="${key}"]`)
				if (input) {
					input.value = preset.renderer[key]
				}
			} else {
				const input = s(`p-knob[name="${key}"]`)
				if (input) {
					input.knob.value = preset.renderer[key]
				}
			}
		}
		for (let key in preset.cymatics) {
			if (studioMode) {
				const input = s(`input[type="range"][name="${key}"]`)
				if (input) {
					input.value = preset.cymatics[key]
				}
			} else {
				const input = studioMode ? s(`input[type="range"][name="${key}"]`) : s(`p-knob[name="${key}"]`)
				if (input) {
					input.knob.value = preset.cymatics[key]
				}
			}
		}
		for (let key in preset.liquid) {
			if (studioMode) {
				const input = s(`input[type="range"][name="${key}"]`)
				if (input) {
					input.value = preset.liquid[key]
				}
			} else {
				const input = studioMode ? s(`input[type="range"][name="${key}"]`) : s(`p-knob[name="${key}"]`)
				if (input) {
					input.knob.value = preset.liquid[key]
				}
			}
		}
		// set xy control values
		// set image pickers
		if (s('cymatics-controls') && s('#app').getAttribute('mode') === 'studio') {
			s('cymatics-controls').render()
		}
		if(preset.frame) {

			this.loadFrame(preset.frame, preset.background)
		} else {
			if (s('p-cymatics img#frame')) s('p-cymatics img#frame').remove()
			s('.cymatics-wrapper').style.backgroundColor = 'unset'
		}
		// disable freq_response_speed slider if auto is on (render() sets checked but not disabled)
		const slider = s('input[type="range"][name="freq_response_speed"]')
		if (slider) slider.disabled = window.__autoResponseSpeed
		// disable light_distance slider if dynamic distance is on
		const distSlider = s('input[type="range"][name="light_distance"]')
		if (distSlider) distSlider.disabled = window.__dynamicLightDistance
	}

	loadFrame(src, color = '#000000') {

		if (s('p-cymatics img#frame')) s('p-cymatics img#frame').remove()
		let frameImage = new Image()
		frameImage.src = src
		frameImage.id = 'frame'
		frameImage.onload = () => {
		}
		s('p-cymatics').appendChild(frameImage)	
		s('.cymatics-wrapper').style.backgroundColor = color
	}

	exportPreset() {

		const preset = {
			poleMode: s('pole-config').selected,
			// frame: s('p-cymatics img#frame').src,
      // background: s('.cymatics-wrapper').style.backgroundColor,
			preset: {
				renderer: engine.state.rendererConfig,
				cymatics: engine.state.cymaticsConfig,
				liquid: engine.state.liquidConfig,
			}			
		}
		return preset
	
	}
}

// engine API
const engineApi = {
	// The engine instance (src/engine-js/), set once it has booted.
	core: null,
	supportsWebGl2: () => {
		const webGl2 = document.createElement('canvas').getContext('webgl2')
		if (!webGl2) {
			return false
		} else {
			return true
		}
	},	
	createCanvas: (container) => {
		return new Promise((resolve) => {
			if (!s(`.${container.getAttribute('class')} canvas`)) {
				const canv = document.createElement('canvas')
				canv.id = 'canvas'
				canv.tabindex = -1
				canv.oncontextmenu = (e) => e.preventDefault()
				container.appendChild(canv)
				resolve()
			}
		})
	},	
	sendCommand: (command) => {
		if (!engineApi.core) return
		const result = engineApi.core.command(command)
		if (result.success) return result.payload
		return { error: 'error while executing command: ' + command }
	},

	// Hot path for audio: one Float32Array of normalised FFT bins per frame,
	// handed straight to the envelope follower.
	pushAudioSpectrum: (freqData, numBins, sampleRate) => {
		if (!engineApi.core) return
		engineApi.core.pushAudioSpectrum(freqData, numBins, sampleRate)
	},
	setupCanvas: ({ container, width, height, pixelRatio }) => {
		// engineApi.setCanvasSize({ width, height })
		// engineApi.setViewport({
		// 	width: width * pixelRatio,
		// 	height: height * pixelRatio
		// })
		return new Promise(resolve => {
			const { engine } = window
			const engineContainer = s("p-cymatics")
			const canvasElement = s("p-cymatics canvas")
			canvasElement.style.width = engineContainer.offsetWidth + "px"
			canvasElement.style.height = engineContainer.offsetHeight + "px"
			engineApi.setViewport(engineContainer.offsetWidth * window.devicePixelRatio, engineContainer.offsetHeight * window.devicePixelRatio)
			// engine.sendCommand('disable_undo')
			// engine.sendCommand('enable_logs')
			resolve()
		})
	},
	setCanvasSize: (width, height) => {
		if (!engineApi.core) return
		engineApi.core.setCanvasSize(width, height, window.devicePixelRatio)
	},
	resetCanvasTransform: () => {
		if (!window.engine.state.ready) return
		let result = sendCommand('canvas reset_transform')
		return result
	},
	setViewport: (width, height) => {
		if (!engineApi.core) return
		engineApi.core.setViewport(width, height)
	},	
	resizeCanvas: ({ width, height }) => {
		if (!window.engine.state.ready) return
		let result = sendCommand(`resize ${width} ${height}`)
		return result
	},
	resizeHandler: () => {
		// debounce resize events (mobile fires many during address bar animation)
		clearTimeout(window.resizeTimeout)
		window.resizeTimeout = setTimeout(() => {
			const e = s("p-cymatics")
			e.style.transition = 'none'
			let w = e.offsetWidth
			let h = e.offsetHeight
			engine.api.setCanvasSize(w, h)
			engine.api.setViewport(w * window.devicePixelRatio, h * window.devicePixelRatio)
			setTimeout(() => {
				s("p-cymatics").style.transition = 'all .39s ease-in-out'
			}, 500)
		}, 100)
	},
	blobToBase64: (blob, callback) => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onerror = error => reject(error)
			reader.onloadend = () => {
				if (callback) {
					callback(reader.result)
				} else {
					resolve(reader.result)
				}
			}
			reader.readAsDataURL(blob)
		})
	},
	askForFile: (options) => {
		return new Promise((resolve, reject) => {
			try {
				let inputEl = document.createElement("input")
				inputEl.type = "file"
				if (options && options.fromCamera) {
					inputEl.capture = "camera"
					inputEl.accept = "image/*;capture=camera"
				} else if (options && options.accept) {
					inputEl.accept = options.accept
				} else {
					inputEl.accept = ".mp3,.wav"
				}
				inputEl.onchange = (e) => {
					resolve(e.target.files)
				}
				document.body.appendChild(inputEl)
				setTimeout(() => {
					inputEl.click()
					setTimeout(() => {
						inputEl.remove()
					}, 3000)
				})
			} catch (e) {
				reject()
			}
		})
	},
	fileToAudiobuffer: (file) => {
		return new Promise((resolve, reject) => {
			let reader = new FileReader()
			reader.onload = async function (event) {
				const arrayBuffer = event.target.result
				const audioContext = new (window.AudioContext || window.webkitAudioContext)()
				const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
				resolve(audioBuffer)
			}
			reader.readAsArrayBuffer(file)
		})
	},
	getInput: (config) => {
		let modal = document.createElement('div')
		modal.classList.add('modal')
		modal.innerHTML = `
			<div class="modal-box">
				<p>${config.title}</p>
				${config.type ? `<input type="${config.type || 'text'}" name="title" placeholder="Untitled" />` : ''}
				<button class="primary">${config.buttonText}</button>
			</div>
		`
		s('#app').appendChild(modal)
		const input = modal.querySelector('input')
		if (input) input.focus()
		// This dialog's keys, removed with it: a listener left behind would
		// answer the next dialog's Enter with this one's first button.
		const close = () => {
			window.removeEventListener('keydown', onKey)
			modal.remove()
		}
		const onKey = (e) => {
			if (e.key === 'Escape') close()
			if (e.key === 'Enter') modal.querySelector('button').click()
		}
		window.addEventListener('keydown', onKey)
		modal.querySelector('button').onclick = () => {
			const returnValue = input ? input.value : false
			close()
			config.onSubmit(returnValue)
		}
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close()
		})
	},
}


// Define engine class

window.engine = class engine {
  constructor (engineConfig) {
    this.state = {
			version: '0.0.1',
      container: engineConfig.container,
      ready: false,
			rendererConfig: null,
			cymaticsConfig: null,
			liquidConfig: null
    }
		this.api = engineApi

		// Shared post-init setup — identical for the WASM and the pure-JS backend.
		const onEngineReady = () => {
      this.state.ready = true
      this.state.container = engineConfig.container						
      engineApi.setupCanvas({
        container: engineConfig.container,
        width: engineConfig.container.offsetWidth,
        height: engineConfig.container.offsetHeight,
        pixelRatio: window.devicePixelRatio
      })
						// Use this to set alternative initial configuration
						// engineApi.sendCommand(`set renderer ${JSON.stringify(this.state.rendererConfig)}`)
						// engineApi.sendCommand(`set cymatics ${JSON.stringify(this.state.cymaticsConfig)}`)
						// engineApi.sendCommand(`set liquid ${JSON.stringify(this.state.liquidConfig)}`)
						window.addEventListener('focus', engineApi.resizeHandler)
						window.addEventListener('resize', engineApi.resizeHandler)
						window.addEventListener('orientationchange', () => {
							engineApi.resizeHandler()
						})
						if (window.visualViewport) {
							window.visualViewport.addEventListener('resize', engineApi.resizeHandler)
						}

						// Get first configuration from the engine
						setTimeout(() => {
							this.state.rendererConfig = engineApi.sendCommand(`get renderer`)
							this.state.cymaticsConfig = engineApi.sendCommand(`get cymatics`)
							this.state.liquidConfig = engineApi.sendCommand(`get liquid`)

							// Lock contour + emissive always on
							this.state.cymaticsConfig.contour_mode = 1
							this.state.rendererConfig.emissive_mode = true
							engineApi.sendCommand(`set cymatics ${JSON.stringify(this.state.cymaticsConfig)}`)
							engineApi.sendCommand(`set renderer ${JSON.stringify(this.state.rendererConfig)}`)

							// A tap on the plate closes the studio's panel, except on a
							// phone, where it is too easy to hit while dragging a slider
							// above it.
							s('p-cymatics').addEventListener('click', () => {
								if (phoneQuery().matches) return
								deskStudio().closePanel()
							})

							const isTouchDevice = window.matchMedia('(hover: none)').matches
							window.addEventListener('pointermove', () => {
								// automatically hide the nav bar after 5 seconds (desktop only)
								if (s('p-nav')) {
									s('p-nav').style.opacity = 1
									if (isTouchDevice) return
									clearTimeout(window.navTimeout)
									window.navTimeout = setTimeout(() => {
										if (s('cymatics-presets[visible="true"]') || s('cymatics-controls[visible="true"]')) return
										s('p-nav').style.opacity = 0
									}, 5000)
								} else {
									if (s('cymatics-controls .controls')) {
										s('cymatics-controls .controls').style.opacity = 1
									}
									if (isTouchDevice) return
									clearTimeout(window.navTimeout)
									window.navTimeout = setTimeout(() => {
										if (s('cymatics-controls .controls')) {
											s('cymatics-controls .controls').style.opacity = 0
										}
									}, 5000)
								}
							})

							// cymatics / fshader
							// assets/shaders/cymatics_main_4bounce_glslopt.fsh (default)
							// assets/shaders/cymatics_main_unlimited_glslopt.fsh
							window.postMessage({ status: 'ready' }, '*')
							if (window.ReactNativeWebView) {
								window.ReactNativeWebView.postMessage('ENGINE_IS_READY', '*')
								window.ReactNativeWebView.postMessage(JSON.stringify({
									engine: {
										version: this.state.version
									},
								}), '*')
							}
						}, 300)
		}

		engineApi.createCanvas(engineConfig.container).then(async () => {
			try {
				const { CymaticsEngine } = await import('../engine-js/index.js')
				const canvas = s('p-cymatics canvas')
				canvas.width = engineConfig.width
				canvas.height = engineConfig.height
				const core = new CymaticsEngine(canvas)
				engineApi.core = core
				window.__cymaticsEngine = core
				core.start()
				window.engineReady = onEngineReady
				onEngineReady()
			} catch (e) {
				console.error('[cymatics] engine failed to start:', e)
			}
		})
    this.sendCommand = engineApi.sendCommand
  }
}

customElements.define('p-cymatics', PuhdeCymatics)