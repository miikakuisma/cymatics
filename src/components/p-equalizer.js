const equalizerDefaults = [
  {
    frequency: 60,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "60"
  },
  {
    frequency: 170,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "170"
  },
  {
    frequency: 310,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "310"
  },
  {
    frequency: 600,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "600"
  },
  {
    frequency: 1000,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "1k"
  },
  {
    frequency: 3000,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "3k"
  },
  {
    frequency: 6000,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "6k"
  },
  {
    frequency: 12000,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "12k"
  },
  {
    frequency: 16000,
    type: "peaking",
    value: 0,
    Q: 0.1,
    label: "16k"
  }
]


export class PuhdeEqualizer extends HTMLElement {

	constructor() {
    super()
    this.equalizer = JSON.parse(JSON.stringify(equalizerDefaults))
  }

  async connectedCallback() {
    this.render()
  }

	static get observedAttributes() {
		return []
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
    this.render()
	}

  render() {
    this.innerHTML = `
      <div class="header">
        <label>Equalizer</label>
        <span>Monitor <input type="checkbox" id="monitor" name="monitor" /></span>
      </div>
      <div class="container">
        <div class="bands-container"></div>
      </div>
    `
    this.renderBands()
    this.querySelector('#monitor').addEventListener('change', (e) => {
      if (e.target.checked) {
        s('p-audio').connectEq(true)
      } else {
        s('p-audio').connectEq(false)
      }
    })
  }

  destroy() {
    this.remove()
  }

  // The filters only exist once audio has started; the band's value is kept
  // either way, so the panel (and an edit snapshot) can be ahead of them.
  updateBand({ filter, param, frequency, value }) {
    if (window[filter]) window[filter][param].value = parseFloat(value)
    let newBands = JSON.parse(JSON.stringify(this.equalizer))
    newBands.find((band) => band.frequency === frequency).value = parseFloat(value)
    this.equalizer = newBands

  }

  // Band gains in equalizerDefaults order. Read from the panel, so they are
  // there before audio has made the filters.
  get gains() {
    return this.equalizer.map((band) => band.value)
  }

  // The panel and the filters (Cancel's restore).
  setGains(gains) {
    this.showGains(gains)
    for (const band of this.equalizer) {
      const filter = window[`eq${band.frequency}`]
      if (filter) filter.gain.value = band.value
    }
  }

  // The panel only. A rebuilt panel takes its predecessor's gains this way,
  // leaving the filters alone: with Monitor off they are held at zero.
  showGains(gains) {
    this.equalizer = this.equalizer.map((band, i) => ({ ...band, value: gains[i] ?? band.value }))
    const container = this.querySelector('.bands-container')
    if (!container) return
    container.innerHTML = ''
    this.renderBands()
  }

  resetAll() {
    this.equalizer.forEach((band) => {
      this.updateBand({
        filter: `eq${band.frequency}`,
        param: "gain",
        frequency: band.frequency,
        value: 0
      })
    })
    this.render()
  }

  renderBands() {
    const eqSliders = this.equalizer.map((eq) => {
      const slider = document.createElement("div")
      slider.className = "slider"
      slider.key = `slider-${eq.frequency}`

      const input = document.createElement("input")
      input.type = "range"
      input.min = "-10"
      input.max = "10"
      input.value = eq.value
      input.step = "0.1"
      input.title = eq.value
      input.oninput = (e) => {
        if (e.target.value !== eq.value) {
          this.updateBand({
            filter: `eq${eq.frequency}`,
            param: "gain",
            frequency: eq.frequency,
            value: e.target.value
          })
        }
      }
      input.ondblclick = (e) => {
        this.updateBand({
          filter: `eq${eq.frequency}`,
          param: "gain",
          frequency: eq.frequency,
          value: 0
        })
        e.target.value = 0
      }

      const label = document.createElement("label")
      label.textContent = eq.label

      slider.appendChild(input)
      slider.appendChild(label)

      return slider
    })

    const bandsDiv = document.createElement("div")
    bandsDiv.className = "bands"
    eqSliders.forEach((slider) => {
      bandsDiv.appendChild(slider)
    })

    this.querySelector('.bands-container').appendChild(bandsDiv)
  }

}

customElements.define('p-equalizer', PuhdeEqualizer)