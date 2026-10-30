import { phoneQuery } from '../studio/layout.js'
import { phoneStudio } from '../studio/phone-studio.js'
import { deskStudio } from '../studio/desk-studio.js'

export class PuhdeNav extends HTMLElement {

	constructor() {
    super()
    this.visible = 'true'
  }

  connectedCallback() {
		this.render()
    // On a phone the buttons light up with the phone studio's phase.
    this.unsubscribe = phoneStudio().onChange(() => this.syncPhone())
  }

  disconnectedCallback() {
    this.unsubscribe?.()
  }

  // Grid is lit while the studio is open, sliders while the editor is.
  syncPhone() {
    if (!phoneQuery().matches) return
    const phase = phoneStudio().phase
    this.querySelector('[fn="presets"]')?.classList.toggle('activated', phase !== 'closed')
    this.querySelector('[fn="edit"]')?.classList.toggle('activated', phase === 'editor')
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
        // On a phone, grid opens the picker or closes the studio, and sliders
        // opens the editor or closes it; leaving the editor keeps the edits.
        this.querySelector('[fn="presets"]').addEventListener('click', (e) => {
          if (phoneQuery().matches) {
            const studio = phoneStudio()
            if (studio.phase === 'closed') studio.open('picker')
            else studio.close()
            return
          }
          // On desktop both buttons toggle the one panel, and both light.
          deskStudio().toggle()
        })

        this.querySelector('[fn="play"]').addEventListener('click', () => {
          s('p-audio').togglePlay()
        })
  
        this.querySelector('[fn="edit"]').addEventListener('click', (e) => {
          if (phoneQuery().matches) {
            const studio = phoneStudio()
            if (studio.phase === 'editor') studio.close()
            else studio.open('editor')
            return
          }
          deskStudio().toggle()
        })

        // Sync activated state with the studio as it is now.
        if (phoneQuery().matches) {
          this.syncPhone()
        } else if (deskStudio().open) {
          this.querySelector('[fn="presets"]').classList.add('activated')
          this.querySelector('[fn="edit"]').classList.add('activated')
        }

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
