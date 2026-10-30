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

  // Only play: the cog and Tab open the studio, and on a phone the picker's
  // Adjust opens the editor.
  render() {
    this.innerHTML = ''
    if (this.visible === 'true') {
      this.innerHTML = `
        <ul>
          <li>
            <button fn="play">
              ${icons.play}
            </button>
          </li>
        </ul>
      `
      this.querySelector('[fn="play"]').addEventListener('click', () => {
        s('p-audio').togglePlay()
      })
    }
  }

}

customElements.define('p-nav', PuhdeNav)
