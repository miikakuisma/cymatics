export class PuhdeNav extends HTMLElement {

	constructor() {
    super()
    this.visible = 'true'
  }

  connectedCallback() {
		this.render()
  }

	static get observedAttributes() {
		return ['visible']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
    this.render()
	}

  render() {
    const isCoverMode = s('p-cymatics').getAttribute('cover') === 'true'
    this.innerHTML = ''
    if (this.visible === 'true') {
      this.innerHTML = `
        <ul>
          <li>
            <button fn="presets">
              ${icons.presets}
            </button>
          </li>
          
          <li>
            <button fn="play">
              ${icons.play}
            </button>
          </li>
          <li>
            <button fn="edit">
              ${icons.options}
            </button>
          </li>
        </ul>
      `
      setTimeout(() => {
        this.querySelector('[fn="presets"]').addEventListener('click', (e) => {
          const isVisible = s('cymatics-presets').getAttribute('visible') === 'true'
          if (!isVisible) {
            s('cymatics-presets').setAttribute('visible', 'true')
            e.target.classList.add('activated')
          } else {
            s('cymatics-presets').setAttribute('visible', 'false')
            e.target.classList.remove('activated')
          }
        })

        this.querySelector('[fn="play"]').addEventListener('click', () => {
          s('p-audio').togglePlay()
        })
  
        this.querySelector('[fn="edit"]').addEventListener('click', (e) => {
          const isVisible = s('cymatics-controls').getAttribute('visible') === 'true'
          if (!isVisible) {
            s('cymatics-controls').setAttribute('visible', 'true')
            e.target.classList.add('activated')
          } else {
            s('cymatics-controls').setAttribute('visible', 'false')
            e.target.classList.remove('activated')
          }
        })

        // Sync activated state with current panel visibility
        if (s('cymatics-presets')?.getAttribute('visible') === 'true')
          this.querySelector('[fn="presets"]').classList.add('activated')
        if (s('cymatics-controls')?.getAttribute('visible') === 'true')
          this.querySelector('[fn="edit"]').classList.add('activated')

        // this.querySelector('[fn="cover"]').addEventListener('click', (e) => {
        //   const isCoverMode = s('p-cymatics').getAttribute('cover') === 'true'      
        //   if (!isCoverMode) {
        //     s('p-cymatics').setAttribute('cover', 'true')
        //     this.style.backgroundColor = 'transparent'
        //     e.target.innerHTML = icons.scaleToCover
        //   } else {
        //     s('p-cymatics').setAttribute('cover', 'false')
        //     this.style.backgroundColor = '#111'
        //     e.target.innerHTML = icons.scaleToContain
        //   }
        // })
      })
    }
  }

}

customElements.define('p-nav', PuhdeNav)
