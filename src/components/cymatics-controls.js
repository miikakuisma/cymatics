import { controls, playerKnobs } from "../controls"
import { host } from '../studio/host.js'
import { defaultPresets } from "../default-presets"
import { poleConfigs } from "./pole-config.js"
import { fileToScaledDataUrl } from '../image-util.js'

const BAND_OPTIONS = [
  { value: 'band1', label: 'Sub-bass (40–80Hz)' },
  { value: 'band2', label: 'Bass (80–160Hz)' },
  { value: 'band3', label: 'Low-mid (160–320Hz)' },
  { value: 'band4', label: 'Mid (320–640Hz)' },
  { value: 'band5', label: 'Upper-mid (640–1280Hz)' },
  { value: 'band6', label: 'Presence (1.3–2.6kHz)' },
  { value: 'band7', label: 'Brilliance (2.6–5kHz)' },
  { value: 'band8', label: 'Air (5–10kHz)' },
  { value: 'overall', label: 'Overall' },
  { value: 'kick', label: 'Kick' },
]

// The light the XY pad has selected, or null. A preset can carry no lights at
// all (lights: []), and loading one rebuilds this panel: indexing blindly threw
// mid-load and left the preset half applied.
function selectedLight() {
  const handle = s('xy-control[controls="lights"]')?.selectedHandle ?? 0
  return engine.state.rendererConfig.lights?.[handle] || null
}

function editSelectedLight(change) {
  const handle = s('xy-control[controls="lights"]')?.selectedHandle ?? 0
  const lights = structuredClone(engine.state.rendererConfig.lights || [])
  if (!lights[handle]) return
  change(lights[handle])
  update('lights', lights)
}

const LEGACY_BAND_ALIASES = { bass: 'band2', mid: 'band4', high: 'band7' }

function fillBandOptions(selectEl, currentValue) {
  const resolved = LEGACY_BAND_ALIASES[currentValue] || currentValue
  for (const opt of BAND_OPTIONS) {
    const el = document.createElement('option')
    el.value = opt.value
    el.textContent = opt.label
    if (resolved === opt.value) el.selected = true
    selectEl.appendChild(el)
  }
}

function makeUnitRow(labelText, globalKey, defaultVal) {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:210px; padding:3px 0'
  const lbl = document.createElement('label')
  lbl.textContent = labelText
  lbl.style.cssText = 'color:#777; font-size:11px; flex:none'
  const val = document.createElement('span')
  const current = window[globalKey] ?? defaultVal
  val.textContent = parseFloat(current).toFixed(2)
  val.style.cssText = 'color:#aaa; font-size:11px; min-width:28px; text-align:right; flex:none'
  const input = document.createElement('input')
  input.type = 'range'
  input.min = 0; input.max = 100; input.step = 1
  input.value = Math.round(current * 100)
  input.style.cssText = 'width:90px; margin: 0 4px'
  input.oninput = (e) => {
    const v = parseFloat(e.target.value) / 100
    window[globalKey] = v
    val.textContent = v.toFixed(2)
  }
  row.appendChild(lbl); row.appendChild(input); row.appendChild(val)
  return row
}

function makeTriggerRow(globalKey, defaultVal = 0.3) {
  return makeUnitRow('Trigger', globalKey, defaultVal)
}

function makeSpeedRow(globalKey, defaultVal = 0.8) {
  return makeUnitRow('Speed', globalKey, defaultVal)
}

function matchFormation(poles) {
  if (!poles) return null
  const key = JSON.stringify(poles)
  for (const name in poleConfigs) {
    if (JSON.stringify(poleConfigs[name]) === key) return name
  }
  return null
}

export class PuhdeCymaticsControls extends HTMLElement {

	constructor() {
    super()
		this.visible = 'false'
    this.controls = []
    this.mode = null
    this._mobileQuery = window.matchMedia('(max-width: 768px)')
  }

  get isMobileStudio() {
    return this.mode === 'studio' && this._mobileQuery.matches
  }

  connectedCallback() {
    this.mode = s('#app').getAttribute('mode')
    this.controls = this.mode === 'studio' ? controls : playerKnobs
		this.render()
    this.initButtons()
    // this.initMidi()
    this._mobileQuery.addEventListener('change', () => {
      this.render()
      this.initButtons()
    })
  }

	static get observedAttributes() {
		return ['visible']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
		this.toggle()
	}

	render() {
    if (this.mode === 'studio') {
      if (this.isMobileStudio) {
        this.innerHTML = `
          <div class="controls mobile-studio">
            <band-meter></band-meter>
            <div class="tab-bar">
              <button class="tab" data-tab="audio">Audio</button>
              <button class="tab active" data-tab="cymatics">Cymatics</button>
            </div>
            <div class="tab-content">
              <div class="group audio">
                <p-equalizer></p-equalizer>
              </div>
              <div class="group cymatics active"></div>
            </div>
            <div class="sticky">
              <button fn="save">Save</button>
              <button fn="save-as">Save As…</button>
              ${host().chrome.standalone ? '<button fn="set-default">Set as Default</button>' : ''}
            </div>
          </div>
        `
      } else {
        this.innerHTML = `
          <div class="controls">
            <band-meter></band-meter>
            <details>
              <summary>Audio Source</summary>
              <div class="group audio"></div>
              <p-equalizer></p-equalizer>
            </details>
            <details open>
              <summary>Cymatics</summary>
              <div class="group cymatics"></div>
            </details>
            <div class="sticky">
              <button fn="save">Save</button>
              <button fn="save-as">Save As…</button>
              ${host().chrome.standalone ? '<button fn="set-default">Set as Default</button>' : ''}
            </div>
          </div>
        `
      }
    } else if (this.mode === 'player') {
      this.innerHTML = `
        <div class="controls">
          <div class="scene-selector"></div>
          <div class="group audio cymatics liquid"></div>
        </div>
      `
    }

    const renderControl = (control, targetContainer) => {
      if (control.component) {
        this.createComponent(control, targetContainer)
        return
      }
      if (this.mode === 'studio' || control.type === 'slider') {
        this.createSlider(control, targetContainer)
      } else {
        this.createKnob(control, targetContainer)
      }
    }

    this.controls.map(control => {
      const target = this.querySelector('.controls .group.' + control.groupSlot)
      if (!target) return
      const before = target.children.length
      renderControl(control, target)
      // Everything the control added, including a Dynamic panel beneath it.
      if (control.sourcesOnly) {
        for (const el of [...target.children].slice(before)) el.dataset.sourcesOnly = ''
      }
    })

    if (this.mode === 'player') {
      this.createKnob({
        name: 'Scene',
        min: 0,
        max: defaultPresets.length - 1,
        value: 0,
        label: 'Scene',
        step: 1,
        oninput: (value) => {
          s('p-cymatics').loadConfig(defaultPresets[value].preset)
          s('p-knob[name="Scene"]').setAttribute('label', defaultPresets[value].name)
        }
      }, this.querySelector('.controls .scene-selector'))
    }

    const wrapper = s('.cymatics-wrapper')
		if (this.visible === 'true') {
			setTimeout(() => {
        if (this.isMobileStudio) {
          this.querySelector('.controls').style.transform = 'translateY(0)'
          if (wrapper) wrapper.classList.add('controls-open')
        } else {
				  this.querySelector('.controls').style.transform = this.mode === 'studio' ? 'translateX(0)' : 'translateY(0)'
        }
        this.initButtons()
			})
		} else {
			setTimeout(() => {
        if (this.isMobileStudio) {
          this.querySelector('.controls').style.transform = 'translateY(calc(45vh + 48px))'
          if (wrapper) wrapper.classList.remove('controls-open')
        } else {
				  this.querySelector('.controls').style.transform = this.mode === 'studio' ? 'translateX(300px)' : 'translateY(200px)'
        }
			})
		}

    if (this.isMobileStudio) {
      this.initTabs()
    }

    this.updateControlsFromEngineState()
  }

  updateControlsFromEngineState() {
    const formation = matchFormation(engine.state.cymaticsConfig.poles)
    if (formation) s('pole-config').setAttribute('selected', formation)
    this.applyFieldMode()
    // const convertColorToHex = (color) => {
		// 	const hex = color.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
		// 	return `#${hex}`
		// }
    // update xy-control for lights
    // engine.state.rendererConfig.lights.forEach((light, index) => {
    //   console.log(light, index)
    //   const lightHex = convertColorToHex(light.color)
    //   s('xy-control[controls="lights"]').setAttribute('color', lightHex)
    // })
  }

  // A plate field rings its own modes, so the controls that shape the radiating
  // sources do nothing there. Grey them out rather than leave them silently
  // dead. `inert`, not `disabled`: the Dynamic checkboxes already drive their
  // sliders' `disabled`, and re-enabling would clobber that.
  applyFieldMode() {
    const plate = (engine.state.cymaticsConfig.field_mode ?? 0) !== 0
    for (const el of this.querySelectorAll('[data-sources-only]')) {
      el.inert = plate
      el.style.opacity = plate ? '0.35' : ''
      el.title = plate ? 'Not used by plate fields' : ''
    }
  }

  createComponent(control, targetContainer) {
    // XY-controls
    if (control.component === 'xy-control') {
      const component = document.createElement('xy-control')
      component.setAttribute('controls', control.controls)
      component.setAttribute('label', control.label)
      component.setAttribute('controls', control.controls)
      if (control.controls === 'lights') {
        const convertColorToHex = (color) => {

          const hex = color.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
          return `#${hex}`
        }
        // get values for handles from engine.state.rendererConfig.lights
        component.handles = []
        engine.state.rendererConfig.lights.forEach(light => {
          component.handles.push({
            pos: light.pos,
            color: convertColorToHex(light.color),
            controls: 'lights',
          })
        })

        component.onchange = e => {
          // listen to color change
          if (e.detail && e.detail.color) {
            const r = parseInt(e.detail.color.substring(1, 3), 16) / 255
            const g = parseInt(e.detail.color.substring(3, 5), 16) / 255
            const b = parseInt(e.detail.color.substring(5, 7), 16) / 255
            let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
            const handleIndex = parseInt(e.detail.handleIndex)
            newLights[handleIndex].color = [r, g, b]
            update('lights', newLights)
          } else if (e.detail && e.detail.reset) {
            // reset light
            let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
            const handleIndex = parseInt(e.detail.handleIndex)
            newLights[handleIndex].pos = [0, 0, -10]
            update('lights', newLights)
            s('xy-control[controls="lights"]').reset()
          } else if (e.detail && e.detail.add) {
            // add light
            let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
            newLights.push({
              color: [1, 1, 1],
              pos: [0, 0, -1],
              roughness: 0.1,
            })
            const newHandle = {
              controls: 'lights',
              color: '#ffffff',
              pos: [0, 0],
            }
            update('lights', newLights)
            s('xy-control[controls="lights"]').handles.push(newHandle)
            s('xy-control[controls="lights"]').render()
          } else if (e.detail && e.detail.remove) {
            // remove light
            let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
            const handleIndex = parseInt(e.detail.handleIndex)
            newLights.splice(handleIndex, 1)
            update('lights', newLights)
            s('xy-control[controls="lights"]').handles.splice(handleIndex, 1)
          } else {
            // listen to x/y control change
            if (!e.target.values) return
            let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
            const handleIndex = parseInt(e.detail.handleIndex)
            const x = e.target.values.x * 6
            const y = e.target.values.y * 6
            const z = parseFloat(s('input[name="light_distance"]').value)
            newLights[handleIndex].pos = [x, y, z]
            update('lights', newLights)
          }
        }
      }
      if (control.controls === 'wave_center') {
        component.handles = [
          {
            controls: 'wave_center',
            pos: [0, 0],
            color: '#ffffff',
          },
        ]
        component.onchange = e => {
          if (e.detail && e.detail.reset) {
            // reset center
            update('wave_center', [0, 0, 0])
            s('xy-control[controls="wave_center"]').reset()
          } else {

            // listen to x/y control change
            const x = e.target.values.x
            const y = e.target.values.y
            update('wave_center', [x, y, 0])
          }
          
        }
      }
      targetContainer.appendChild(component)
      // color picker + dynamic color checkbox (lights only)
      if (control.controls === 'lights') {
        const colorControl = document.createElement('div')
        colorControl.classList.add('control')
        const colorRow = document.createElement('div')
        colorRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:220px; padding: 4px 0'
        const colorLabel = document.createElement('label')
        colorLabel.textContent = 'Light Color'
        const colorPicker = document.createElement('input')
        colorPicker.type = 'color'
        colorPicker.classList.add('light-color-picker')
        colorPicker.style.cssText = 'width:28px; height:22px; border-radius:6px; border:none; padding:0; cursor:pointer'
        // init color from first light
        const convertColorToHex = (color) => '#' + color.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
        if (engine.state.rendererConfig.lights?.[0]) {
          colorPicker.value = convertColorToHex(engine.state.rendererConfig.lights[0].color)
        }
        const dynamicColorLabel = document.createElement('label')
        dynamicColorLabel.classList.add('auto-toggle')
        const dynamicColorCheck = document.createElement('input')
        dynamicColorCheck.type = 'checkbox'
        dynamicColorCheck.checked = !!window.__dynamicLightColor
        dynamicColorLabel.appendChild(dynamicColorCheck)
        dynamicColorLabel.appendChild(document.createTextNode(' Dynamic'))

        // min/max sub-controls (shown only when Dynamic is on)
        const colorSubControls = document.createElement('div')
        colorSubControls.style.cssText = 'margin-left:10px; border-left:2px solid #226; padding-left:10px; margin-top:4px; display:none'

        const makeColorSubRow = (labelText, globalKey) => {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:210px; padding:3px 0'
          const lbl = document.createElement('label')
          lbl.textContent = labelText
          lbl.style.cssText = 'color:#777; font-size:11px'
          const picker = document.createElement('input')
          picker.type = 'color'
          picker.value = window[globalKey] || '#ffffff'
          picker.style.cssText = 'width:28px; height:22px; border-radius:6px; border:none; padding:0; cursor:pointer'
          picker.oninput = (e) => { window[globalKey] = e.target.value }
          row.appendChild(lbl)
          row.appendChild(picker)
          return row
        }

        const colorBandRow = document.createElement('div')
        colorBandRow.style.cssText = 'display:flex; align-items:center; width:210px; padding:3px 0'
        const colorBandLbl = document.createElement('label')
        colorBandLbl.textContent = 'Band'
        colorBandLbl.style.cssText = 'color:#777; font-size:11px; flex:none; margin-right:8px'
        const colorBandSelect = document.createElement('select')
        colorBandSelect.style.cssText = 'font-size:11px; background:#1a1a2e; color:#aaa; border:1px solid #333; border-radius:3px; padding:2px 4px'
        fillBandOptions(colorBandSelect, window.__dynamicLightColorBand)
        colorBandSelect.onchange = () => { window.__dynamicLightColorBand = colorBandSelect.value }
        colorBandRow.appendChild(colorBandLbl)
        colorBandRow.appendChild(colorBandSelect)
        colorSubControls.appendChild(colorBandRow)
        colorSubControls.appendChild(makeColorSubRow('At silence', '__dynamicLightColorMin'))
        colorSubControls.appendChild(makeColorSubRow('At peak', '__dynamicLightColorMax'))
        colorSubControls.appendChild(makeTriggerRow('__dynamicLightColorTrigger'))
        colorSubControls.appendChild(makeSpeedRow('__dynamicLightColorSpeed'))

        colorPicker.oninput = (e) => {
          window.__dynamicLightColor = false
          dynamicColorCheck.checked = false
          colorSubControls.style.display = 'none'
          const r = parseInt(e.target.value.substring(1, 3), 16) / 255
          const g = parseInt(e.target.value.substring(3, 5), 16) / 255
          const b = parseInt(e.target.value.substring(5, 7), 16) / 255
          const xyControl = s('xy-control[controls="lights"]')
          const handleIndex = xyControl ? xyControl.selectedHandle : 0
          let newLights = JSON.parse(JSON.stringify(engine.state.rendererConfig.lights))
          newLights[handleIndex].color = [r, g, b]
          const handle = s(`xy-control[controls="lights"] .handle[handle-index="${handleIndex}"]`)
          if (handle) handle.style.backgroundColor = e.target.value
          update('lights', newLights)
        }

        dynamicColorCheck.addEventListener('change', () => {
          window.__dynamicLightColor = dynamicColorCheck.checked
          colorPicker.disabled = dynamicColorCheck.checked
          colorSubControls.style.display = dynamicColorCheck.checked ? 'block' : 'none'
        })

        // init visibility from current global state
        colorSubControls.style.display = window.__dynamicLightColor ? 'block' : 'none'
        colorPicker.disabled = !!window.__dynamicLightColor

        colorRow.appendChild(colorLabel)
        colorRow.appendChild(colorPicker)
        colorRow.appendChild(dynamicColorLabel)
        colorControl.appendChild(colorRow)
        colorControl.appendChild(colorSubControls)
        targetContainer.appendChild(colorControl)
      }
    }
    // pole config
    if (control.component === 'pole-config') {
      const component = document.createElement('div')
      component.classList.add('control')
      component.innerHTML = `
        <pole-config selected="${control.selected}"></pole-config>
        <label>${control.label}</label>
      `
      targetContainer.appendChild(component)
    }
    // toggle (checkbox)
    if (control.component === 'toggle') {
      const wrapper = document.createElement('div')
      wrapper.classList.add('control')
      const checked = (control.group && control.value)
        ? (engine.state[control.group]?.[control.value] ?? control.defaultValue)
        : control.defaultValue
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.name = control.name
      checkbox.checked = !!checked
      const label = document.createElement('label')
      label.textContent = control.label
      wrapper.appendChild(checkbox)
      wrapper.appendChild(label)
      checkbox.addEventListener('click', () => {
        s('p-cymatics').updateControl(control.name, checkbox.checked)
      })
      targetContainer.appendChild(wrapper)
    }
    // select dropdown
    if (control.component === 'select') {
      const component = document.createElement('div')
      component.classList.add('control')
      const currentVal = (control.group && control.value)
        ? (engine.state[control.group]?.[control.value] ?? control.defaultValue)
        : control.defaultValue
      const optionsHtml = control.options.map(opt =>
        `<option value="${opt.value}" ${opt.value === currentVal ? 'selected' : ''}>${opt.label}</option>`
      ).join('')
      component.innerHTML = `
        <select name="${control.name}">${optionsHtml}</select>
        <label>${control.label}</label>
      `
      const select = component.querySelector('select')
      select.onchange = () => {
        s('p-cymatics').updateControl(control.name, parseInt(select.value))
        if (control.name === 'field_mode') this.applyFieldMode()
      }
      targetContainer.appendChild(component)
    }
    // image picker → emits a downscaled data URL to engine state
    if (control.component === 'image-picker') {
      const wrapper = document.createElement('div')
      wrapper.classList.add('control')
      const row = document.createElement('div')
      row.style.cssText = 'display:flex; align-items:center; gap:8px; width:220px; padding:4px 0'

      const label = document.createElement('label')
      label.textContent = control.label
      label.style.cssText = 'flex:1'

      const thumb = document.createElement('div')
      thumb.style.cssText = 'width:34px; height:26px; border-radius:4px; border:1px solid #333; background-size:cover; background-position:center; flex:none'

      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/*'
      fileInput.style.display = 'none'

      const pick = document.createElement('button')
      pick.textContent = 'Choose'
      pick.style.cssText = 'font-size:11px; padding:3px 8px; cursor:pointer'

      const clear = document.createElement('button')
      clear.textContent = 'Clear'
      clear.style.cssText = 'font-size:11px; padding:3px 8px; cursor:pointer'

      const paint = () => {
        const cur = engine.state[control.group]?.[control.value]
        thumb.style.backgroundImage = cur ? `url("${cur}")` : 'none'
        clear.disabled = !cur
      }
      paint()

      pick.onclick = () => fileInput.click()
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0]
        if (!file) return
        try {
          s('p-cymatics').updateControl(control.name, await fileToScaledDataUrl(file))
          paint()
        } catch (e) {
          console.warn('[cymatics] could not read that image:', e.message)
        }
        fileInput.value = ''
      }
      clear.onclick = () => {
        s('p-cymatics').updateControl(control.name, '')
        paint()
      }

      row.appendChild(label)
      row.appendChild(thumb)
      row.appendChild(pick)
      row.appendChild(clear)
      wrapper.appendChild(row)
      // Hidden, but it has to be in the document: .click() on a detached input
      // does not reliably open the file dialog.
      wrapper.appendChild(fileInput)
      targetContainer.appendChild(wrapper)
      // Dropping an image on the canvas sets the same value, so the thumbnail
      // has to repaint from outside. The panel is rebuilt wholesale on every
      // open, so the listener unhooks itself once its wrapper is detached rather
      // than accumulating one stale closure per render.
      const onExternalChange = () => {
        if (!wrapper.isConnected) {
          window.removeEventListener('cymatics:floor-image', onExternalChange)
          return
        }
        paint()
      }
      window.addEventListener('cymatics:floor-image', onExternalChange)
    }
    // color picker → emits [r,g,b] floats in [0,1] to engine state
    if (control.component === 'color-picker') {
      const wrapper = document.createElement('div')
      wrapper.classList.add('control')

      const hexFromState = () => {
        const arr = engine.state[control.group]?.[control.value]
        if (Array.isArray(arr) && arr.length === 3) {
          const to255 = v => Math.max(0, Math.min(255, Math.round(v * 255)))
          return '#' + [arr[0], arr[1], arr[2]]
            .map(c => to255(c).toString(16).padStart(2, '0'))
            .join('')
        }
        return control.defaultValue || '#000000'
      }

      const input = document.createElement('input')
      input.type = 'color'
      input.name = control.name
      input.value = hexFromState()

      const label = document.createElement('label')
      label.textContent = control.label

      wrapper.appendChild(input)
      wrapper.appendChild(label)
      targetContainer.appendChild(wrapper)

      input.addEventListener('input', () => {
        const hex = input.value
        const rgb = [
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        ]
        s('p-cymatics').updateControl(control.value, rgb)
      })

      // Dynamic toggle for color picker (e.g. line color shifting with audio)
      if (control.autoToggle && control.autoKey) {
        const autoLabel = document.createElement('label')
        autoLabel.classList.add('auto-toggle')
        autoLabel.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; color:#777; margin-top:4px'
        const autoCheckbox = document.createElement('input')
        autoCheckbox.type = 'checkbox'
        autoCheckbox.checked = !!window[control.autoKey]
        autoLabel.appendChild(autoCheckbox)
        autoLabel.appendChild(document.createTextNode(' Dynamic'))
        wrapper.appendChild(autoLabel)

        const subPickers = document.createElement('div')
        subPickers.style.cssText = 'margin-left:10px; border-left:2px solid #226; padding-left:10px; margin-top:4px; display:none'
        const makeColorRow = (labelText, globalKey) => {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 0'
          const lbl = document.createElement('label')
          lbl.textContent = labelText
          lbl.style.cssText = 'color:#777; font-size:11px; width:55px'
          const pick = document.createElement('input')
          pick.type = 'color'
          pick.value = window[globalKey] || '#ffffff'
          pick.addEventListener('input', () => { window[globalKey] = pick.value })
          row.appendChild(lbl)
          row.appendChild(pick)
          return row
        }
        const bandKey = control.autoKey + 'Band'
        if (window[bandKey] !== undefined) {
          const bandRow = document.createElement('div')
          bandRow.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 0'
          const bandLbl = document.createElement('label')
          bandLbl.textContent = 'Band'
          bandLbl.style.cssText = 'color:#777; font-size:11px; width:55px'
          const bandSelect = document.createElement('select')
          bandSelect.style.cssText = 'font-size:11px; background:#1a1a2e; color:#aaa; border:1px solid #333; border-radius:3px; padding:2px 4px'
          fillBandOptions(bandSelect, window[bandKey])
          bandSelect.onchange = () => { window[bandKey] = bandSelect.value }
          bandRow.appendChild(bandLbl)
          bandRow.appendChild(bandSelect)
          subPickers.appendChild(bandRow)
        }
        subPickers.appendChild(makeColorRow('At silence', control.autoKey + 'Min'))
        subPickers.appendChild(makeColorRow('At peak', control.autoKey + 'Max'))
        subPickers.appendChild(makeTriggerRow(control.autoKey + 'Trigger'))
        subPickers.appendChild(makeSpeedRow(control.autoKey + 'Speed'))
        subPickers.style.display = window[control.autoKey] ? 'block' : 'none'
        wrapper.appendChild(subPickers)

        autoCheckbox.addEventListener('change', () => {
          window[control.autoKey] = autoCheckbox.checked
          input.disabled = autoCheckbox.checked
          subPickers.style.display = autoCheckbox.checked ? 'block' : 'none'
        })
      }

      return
    }

  }

  createSlider(control, targetContainer) {
    // console.log(controlGroup, control.value, engine.state[controlGroup][control.value])
    // create slider
    let startC = null
    const sliderContainer = document.createElement('div')
    sliderContainer.classList.add('control')
    const slider = document.createElement('input')
    slider.setAttribute('type', 'range')
    slider.setAttribute('name', control.name)
    // Sliders carry their value as x100 fixed point. light_distance is the one
    // exception: the handlers below read and write pos[2] straight off its DOM
    // value, so its bounds must stay unscaled too — scaling them clamps a real
    // z of 49 up to the scaled minimum of 100 and pins the light overhead.
    const boundScale = control.name === 'light_distance' ? 1 : 100
    slider.setAttribute('min', control.min * boundScale)
    slider.setAttribute('max', control.max * boundScale)
    if (control.group && control.value) {
      const stateVal = engine.state[control.group]?.[control.value]
      slider.setAttribute('value', (stateVal != null ? stateVal : (control.defaultValue ?? 1)) * 100)
    } else {
      slider.setAttribute('value', (control.defaultValue ?? 1) * 100)
    }
    if (control.disabled) slider.setAttribute('disabled', true)
    if (control.name === 'light_distance') {
      const light = selectedLight()
      if (light) {
        slider.setAttribute('value', parseFloat(light.pos[2]))
        s('xy-control[controls="lights"]').values.z = parseFloat(light.pos[2])
      }
    }
    slider.setAttribute('step', control.step * boundScale)
    const label = document.createElement('label')
    label.innerText = control.label
    if (control.name === 'light_distance') {
      slider.oninput = (e) => {
        editSelectedLight((light) => { light.pos[2] = parseFloat(e.target.value) })
      }
      setTimeout(() => {
        const light = selectedLight()
        if (!light) return
        s(`input[name="light_distance"]`)?.setAttribute('value', parseFloat(light.pos[2]))
        s('xy-control[controls="lights"]').values.z = parseFloat(light.pos[2])
      }, 500)
    } else if (control.name === 'light_softness') {
      slider.oninput = (e) => {
        editSelectedLight((light) => { light.roughness = parseFloat(e.target.value / 100) })
      }
      setTimeout(() => {
        const light = selectedLight()
        if (!light) return
        s(`input[name="light_softness"]`)?.setAttribute('value', (light.roughness || 0.1) * 100)
      }, 500)
    } else if (control.name === 'light_brightness') {
      slider.onpointerdown = (e) => {

        startC = e.target.value
      }
      slider.oninput = (e) => {
        const v = parseFloat(e.target.value)
        editSelectedLight((light) => { light.color = [v, v, v] })
      }
      setTimeout(() => {
        s(`input[name="light_brightness"]`).setAttribute('value', 1)
      }, 500)
    } else if (control.oninput) {
      slider.oninput = (e) => {
        control.oninput(parseFloat(e.target.value / 100))
      }
    } else {
      slider.oninput = (e) => {
        // console.log('updateControl', control.name, parseFloat(e.target.value / 100))
        s('p-cymatics').updateControl(control.name, parseFloat(e.target.value / 100))
        e.target.setAttribute('tooltip', (control.max > 1 ? e.target.value / 100 : e.target.value))
        clearTimeout(window.tipTimeout)
        window.tipTimeout = setTimeout(() => {
          e.target.setAttribute('tooltip', '')
        }, 3000)
      }
    }
    sliderContainer.appendChild(slider)
    if (control.autoToggle) {
      const autoLabel = document.createElement('label')
      autoLabel.classList.add('auto-toggle')
      const autoCheckbox = document.createElement('input')
      autoCheckbox.type = 'checkbox'
      autoCheckbox.checked = !!window[control.autoKey]
      autoLabel.appendChild(autoCheckbox)
      autoLabel.appendChild(document.createTextNode(' Dynamic'))

      // Sub-controls config per autoKey
      const subControlDefs = {
        '__autoResponseSpeed': {
          minKey: '__autoResponseSpeedMin', maxKey: '__autoResponseSpeedMax',
          minDefault: 0.15, maxDefault: 0.85, inputMin: 1, inputMax: 100, inputStep: 1,
          toInput: v => Math.round(v * 100), fromInput: v => v / 100,
          format: v => parseFloat(v).toFixed(2),
          hasBand: true, bandKey: '__autoResponseSpeedBand',
          triggerKey: '__autoResponseSpeedTrigger',
          speedKey: '__autoResponseSpeedSpeed',
        },
        '__dynamicFreqDetail': {
          minKey: '__dynamicFreqDetailMin', maxKey: '__dynamicFreqDetailMax',
          minDefault: 1, maxDefault: 3, inputMin: 0.1, inputMax: 10, inputStep: 0.1,
          toInput: v => v, fromInput: v => v,
          format: v => parseFloat(v).toFixed(1),
          hasBand: true, bandKey: '__dynamicFreqDetailBand',
          triggerKey: '__dynamicFreqDetailTrigger',
          speedKey: '__dynamicFreqDetailSpeed',
        },
        '__dynamicViewScale': {
          minKey: '__dynamicViewScaleMin', maxKey: '__dynamicViewScaleMax',
          minDefault: 0.05, maxDefault: 0.45, inputMin: 1, inputMax: 50, inputStep: 1,
          toInput: v => Math.round(v * 100), fromInput: v => v / 100,
          format: v => parseFloat(v).toFixed(2),
          hasBand: true, bandKey: '__dynamicViewScaleBand',
          triggerKey: '__dynamicViewScaleTrigger',
          speedKey: '__dynamicViewScaleSpeed',
        },
        '__dynamicContourCount': {
          minKey: '__dynamicContourCountMin', maxKey: '__dynamicContourCountMax',
          minDefault: 2, maxDefault: 32, inputMin: 2, inputMax: 32, inputStep: 1,
          toInput: v => v, fromInput: v => v,
          format: v => Math.round(v),
          hasBand: true, bandKey: '__dynamicContourCountBand',
          triggerKey: '__dynamicContourCountTrigger',
          speedKey: '__dynamicContourCountSpeed',
        },
        '__dynamicFaradayThreshold': {
          minKey: '__dynamicFaradayThresholdMin', maxKey: '__dynamicFaradayThresholdMax',
          minDefault: 0, maxDefault: 0.95, inputMin: 0, inputMax: 95, inputStep: 1,
          toInput: v => Math.round(v * 100), fromInput: v => v / 100,
          format: v => parseFloat(v).toFixed(2),
          hasBand: true, bandKey: '__dynamicFaradayThresholdBand',
          triggerKey: '__dynamicFaradayThresholdTrigger',
          speedKey: '__dynamicFaradayThresholdSpeed',
        },
      }

      let subControls = null
      const def = subControlDefs[control.autoKey]
      if (def && !def.isColor) {
        subControls = document.createElement('div')
        subControls.style.cssText = 'margin-left:10px; border-left:2px solid #226; padding-left:10px; margin-top:4px; display:none'

        if (def.hasBand) {
          const bandRow = document.createElement('div')
          bandRow.style.cssText = 'display:flex; align-items:center; width:210px; padding:3px 0'
          const bandLbl = document.createElement('label')
          bandLbl.textContent = 'Band'
          bandLbl.style.cssText = 'color:#777; font-size:11px; flex:none; margin-right:8px'
          const bandSelect = document.createElement('select')
          bandSelect.style.cssText = 'font-size:11px; background:#1a1a2e; color:#aaa; border:1px solid #333; border-radius:3px; padding:2px 4px'
          fillBandOptions(bandSelect, window[def.bandKey])
          bandSelect.onchange = () => { window[def.bandKey] = bandSelect.value }
          bandRow.appendChild(bandLbl)
          bandRow.appendChild(bandSelect)

          // Beat Div selector (same row)
          const divLbl = document.createElement('label')
          divLbl.textContent = 'Beat'
          divLbl.style.cssText = 'color:#777; font-size:11px; flex:none; margin-left:12px; margin-right:4px'
          const divSelect = document.createElement('select')
          divSelect.style.cssText = 'font-size:11px; background:#1a1a2e; color:#aaa; border:1px solid #333; border-radius:3px; padding:2px 4px'
          for (const [val, label] of [['1','1/1'],['2','1/2'],['4','1/4'],['8','1/8']]) {
            const opt = document.createElement('option')
            opt.value = val
            opt.textContent = label
            if ((window.__kickBeatDiv ?? 4) === parseInt(val)) opt.selected = true
            divSelect.appendChild(opt)
          }
          divSelect.onchange = () => { window.__kickBeatDiv = parseInt(divSelect.value) }
          bandRow.appendChild(divLbl)
          bandRow.appendChild(divSelect)

          subControls.appendChild(bandRow)
        }

        const makeRow = (labelText, globalKey, defaultVal) => {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:210px; padding:3px 0'
          const lbl = document.createElement('label')
          lbl.textContent = labelText
          lbl.style.cssText = 'color:#777; font-size:11px; flex:none'
          const val = document.createElement('span')
          val.textContent = def.format(window[globalKey] ?? defaultVal)
          val.style.cssText = 'color:#aaa; font-size:11px; min-width:28px; text-align:right; flex:none'
          const input = document.createElement('input')
          input.type = 'range'
          input.min = def.inputMin; input.max = def.inputMax; input.step = def.inputStep
          input.value = def.toInput(window[globalKey] ?? defaultVal)
          input.style.cssText = 'width:90px; margin: 0 4px'
          input.oninput = (e) => {
            const v = def.fromInput(parseFloat(e.target.value))
            window[globalKey] = v
            val.textContent = def.format(v)
          }
          row.appendChild(lbl); row.appendChild(input); row.appendChild(val)
          return row
        }

        subControls.appendChild(makeRow('At silence', def.minKey, def.minDefault))
        subControls.appendChild(makeRow('At peak', def.maxKey, def.maxDefault))
        if (def.triggerKey) subControls.appendChild(makeTriggerRow(def.triggerKey))
        if (def.speedKey) subControls.appendChild(makeSpeedRow(def.speedKey))
        subControls.style.display = window[control.autoKey] ? 'block' : 'none'
      }

      autoCheckbox.addEventListener('change', () => {
        window[control.autoKey] = autoCheckbox.checked
        slider.disabled = autoCheckbox.checked
        if (subControls) subControls.style.display = autoCheckbox.checked ? 'block' : 'none'
        if (!autoCheckbox.checked) {
          s('p-cymatics').updateControl(control.name, parseFloat(slider.value / 100))
        }
      })

      const labelRow = document.createElement('div')
      labelRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:220px'
      labelRow.appendChild(label)
      labelRow.appendChild(autoLabel)
      sliderContainer.appendChild(labelRow)
      if (subControls) sliderContainer.appendChild(subControls)
    } else {
      sliderContainer.appendChild(label)
    }
    targetContainer.appendChild(sliderContainer)
  }

  createKnob(control, targetContainer) {
    // create knob
    const knobContainer = document.createElement('div')
    knobContainer.classList.add('control')
    const knob = document.createElement('p-knob')
    knob.setAttribute('name', control.name)
    knob.setAttribute('min', control.min)
    knob.setAttribute('max', control.max)
    knob.setAttribute('value', this.mode === 'player' ? control.value : engine.state[control.group][control.value])
    knob.setAttribute('step', control.step)
    knob.setAttribute('label', control.label)
    knob.oninput = (value) => {
      if (control.oninput) {
        control.oninput(value)
      } else {
        s('p-cymatics').updateControl(control.name, parseFloat(value))
      }
    }
    knobContainer.appendChild(knob)
    targetContainer.appendChild(knobContainer)
  }

  initTabs() {
    this.querySelectorAll('.tab-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'))
        this.querySelectorAll('.tab-content .group').forEach(g => g.classList.remove('active'))
        tab.classList.add('active')
        const group = this.querySelector(`.tab-content .group.${tab.dataset.tab}`)
        if (group) group.classList.add('active')
      })
    })
  }

  toggle() {
    const wrapper = s('.cymatics-wrapper')
		if (this.visible === 'true') {
			setTimeout(() => {
        if (this.isMobileStudio) {
          this.querySelector('.controls').style.transform = 'translateY(0)'
          if (wrapper) wrapper.classList.add('controls-open')
        } else {
				  this.querySelector('.controls').style.transform = this.mode === 'studio' ? 'translateX(0)' : 'translateY(0)'
        }
        this.initButtons()
			})
		} else {
			setTimeout(() => {
        if (this.isMobileStudio) {
          this.querySelector('.controls').style.transform = 'translateY(calc(45vh + 48px))'
          if (wrapper) wrapper.classList.remove('controls-open')
        } else {
				  this.querySelector('.controls').style.transform = this.mode === 'studio' ? 'translateX(300px)' : 'translateY(200px)'
        }
			})
		}
  }

  initButtons() {
    // Only the buttons this actually handles.
    //
    // This used to select every button in the document and assign .onclick to
    // all of them. For anything without an fn attribute that is a no-op which
    // *replaces* whatever handler the element already had — and it runs after
    // render, so it always won. Any control that wired itself up with .onclick
    // silently stopped working. addEventListener survives it, which is why the
    // XY pad's own buttons were unaffected and the breakage went unnoticed.
    sAll('button[fn]').forEach(button => {
      button.onclick = (e) => {
        const fn = button.getAttribute('fn')
        if (fn === 'save') {
          s('cymatics-presets').save()
        }
        if (fn === 'save-as') {
          s('cymatics-presets').saveAs()
        }
        if (fn === 'set-default') {
          const preset = {
            poleMode: s('pole-config').selected,
            renderer: engine.state.rendererConfig,
            cymatics: engine.state.cymaticsConfig,
            liquid: engine.state.liquidConfig,
          }
          localStorage.setItem('cymatics_default_preset', JSON.stringify(preset))
          button.textContent = 'Default Saved!'
          setTimeout(() => { button.textContent = 'Set as Default' }, 2000)
        }
      }
    })
  }

  initMidi() {

    function listInputsAndOutputs(midiAccess) {
      for (const entry of midiAccess.inputs) {
        const input = entry[1];

      }
    
      for (const entry of midiAccess.outputs) {
        const output = entry[1];

      }
    }

    let midi = null; // global MIDIAccess object
    function onMIDISuccess(midiAccess) {

      midi = midiAccess; // store in the global (in real usage, would probably keep in an object instance)
      listInputsAndOutputs(midiAccess);
      startLoggingMIDIInput(midiAccess)
    }

    function onMIDIFailure(msg) {
      console.error(`Failed to get MIDI access - ${msg}`);
    }

    function onMIDIMessage(event) {
      const command = event.data[0]
      const note = event.data[1]
      const velocity = event.data[2]

      switch (command) {
        case 144:
        case 153:

          break
        case 137:
        case 128:

          break
        case 176:

          if (note === 70) {
            // Wave Length
            const value = Math.floor((velocity / 127) * 100)
            s('input[type="range"][name="wave_distance_scale"]').value = value

            update('wave_distance_scale', value/100)
          }
          break
        default:

          break
      
      }
    }
    
    function startLoggingMIDIInput(midiAccess) {
      midiAccess.inputs.forEach((entry) => {
        entry.onmidimessage = onMIDIMessage;
      });
    }

    navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);

    
  }
}

customElements.define('cymatics-controls', PuhdeCymaticsControls)