export const poleConfigs = {
  dot: [
    [0, 0, 0]
  ],
  line: [
    [0, -1, 0],
    [0, 1, 0],
  ],
  triangle: [
    [0, -1, 0],
    [-1, 1, 0],
    [1, 1, 0]
  ],
  square: [
    [-1, -1, 0],
    [-1, 1, 0],
    [1, 1, 0],
    [1, -1, 0]
  ],
  pentagon: [
    [0, -1, 0],
    [-0.95, -0.31, 0],
    [-0.59, 0.81, 0],
    [0.59, 0.81, 0],
    [0.95, -0.31, 0],
  ],
  hexagon: [
    [-0.5, -0.8, 0],
    [0.5, -0.8, 0],
    [-0.95, 0, 0],
    [-0.5, 0.8, 0],
    [0.5, 0.8, 0],
    [0.5, -0.8, 0],
    [0.95, 0, 0],
  ],
  star_of_david: [
    [0, -1, 0],
    [-1, 0.38, 0],
    [1, 0.38, 0],
    [0, 1, 0],
    [-1, -0.38, 0],
    [1, -0.38, 0],
  ],
  line_h: [
    [-1, 0, 0],
    [1, 0, 0],
  ],
  line_v: [
    [0, -1, 0],
    [0, 1, 0],
  ],
  star8: [
    // 8-pointed star: alternating outer (r=1) and inner (r=0.4) at 22.5° steps
    [1, 0, 0],           [0.283, 0.283, 0],
    [0, 1, 0],           [-0.283, 0.283, 0],
    [-1, 0, 0],          [-0.283, -0.283, 0],
    [0, -1, 0],          [0.283, -0.283, 0],
    [0.707, 0.707, 0],   [0, 0.4, 0],
    [-0.707, 0.707, 0],  [-0.4, 0, 0],
    [-0.707, -0.707, 0], [0, -0.4, 0],
    [0.707, -0.707, 0],  [0.4, 0, 0],
  ],
  circle12: [
    [1, 0, 0], [0.866, 0.5, 0], [0.5, 0.866, 0], [0, 1, 0],
    [-0.5, 0.866, 0], [-0.866, 0.5, 0], [-1, 0, 0], [-0.866, -0.5, 0],
    [-0.5, -0.866, 0], [0, -1, 0], [0.5, -0.866, 0], [0.866, -0.5, 0],
  ],
  circle: [
    [-1, 0, 0],
    [-0.92388, 0.38268, 0],
    [-0.70711, 0.70711, 0],
    [-0.38268, 0.92388, 0],
    [0, 1, 0],
    [0.38268, 0.92388, 0],
    [0.70711, 0.70711, 0],
    [0.92388, 0.38268, 0],
    [1, 0, 0],
    [0.92388, -0.38268, 0],
    [0.70711, -0.70711, 0],
    [0.38268, -0.92388, 0],
    [0, -1, 0],
    [-0.38268, -0.92388, 0],
    [-0.70711, -0.70711, 0],
    [-0.92388, -0.38268, 0]
  ]
}

export class PuhdeCymaticsPolePreview extends HTMLElement {

	constructor() {
    super()
		this.visible = 'false'
    // this.selected = 'hexagon'
  }

  connectedCallback() {
		this.render()
  }

	static get observedAttributes() {
		return ['visible', 'selected']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
    if (property === 'selected' && !newValue) return
    if (property === 'selected' && newValue) this.render()
    if (property === 'visible' && newValue === 'true') this.render()
    if (property === 'visible' && newValue === 'false') this.querySelector('.editor').style.transform = 'translateY(200px)'
	}

  render() {
    this.innerHTML = `
      <div class="editor" style="position: fixed;">
        <ul>
          <li ${this.selected === 'dot' ? 'class="activated"': ''}>
            <button fn="select" value="dot">
              ${icons.dot}
            </button>
          </li>
          <li ${this.selected === 'triangle' ? 'class="activated"': ''}>
            <button fn="select" value="triangle">
              ${icons.triangle}
            </button>
          </li>
          <li ${this.selected === 'square' ? 'class="activated"': ''}>
            <button fn="select" value="square">
              ${icons.square}
            </button>
          </li>
          <li ${this.selected === 'pentagon' ? 'class="activated"': ''}>
            <button fn="select" value="pentagon">
              ${icons.pentagon}
            </button>
          </li>
          <li ${this.selected === 'hexagon' ? 'class="activated"': ''}>
            <button fn="select" value="hexagon">
              ${icons.hexagon}
            </button>
          </li>
          <li ${this.selected === 'line_h' ? 'class="activated"': ''}>
            <button fn="select" value="line_h">
              ${icons.line_h}
            </button>
          </li>
          <li ${this.selected === 'line_v' ? 'class="activated"': ''}>
            <button fn="select" value="line_v">
              ${icons.line_v}
            </button>
          </li>
          <li ${this.selected === 'star8' ? 'class="activated"': ''}>
            <button fn="select" value="star8">
              ${icons.star8}
            </button>
          </li>
          <li ${this.selected === 'circle12' ? 'class="activated"': ''}>
            <button fn="select" value="circle12">
              ${icons.circle12}
            </button>
          </li>
        </ul>
      </div>
    `
    
    // <li ${this.selected === 'star_of_david' ? 'class="activated"': ''}>
    //   <button fn="select" value="star_of_david">
    //     ${icons.star_of_david}
    //   </button>
    // </li>
    setTimeout(() => {
      this.onAfterRender()
    })
  }

  onAfterRender() {
    // Handle slidinging up and down
    if (this.visible === 'true') {
      this.querySelector('.editor').style.transform = 'translateY(0)'
    } else {
      this.querySelector('.editor').style.transform = 'translateY(200px)'
    }
    // Add event listeners
    this.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        this.setAttribute('selected', button.getAttribute('value'))
        this.loadPoleConfig(this.selected)
      })
    })
    // Hide preview dots after 3 seconds
    setTimeout(() => {
      if (s('.preview')) s('.preview').style.display = 'none'
    }, 3000)
    this.loadPoleConfig()
  }

  loadPoleConfig(name) {
    if (!poleConfigs[name]) return
    s('p-cymatics').updateControl('poles', poleConfigs[name])
    this.querySelectorAll('li').forEach(li => {
      if (li.querySelector('button').getAttribute('value') === name) {
        li.classList.add('activated')
      } else {
        li.classList.remove('activated')
      }
    })
    const { poles } = engine.state.cymaticsConfig
    if (!poles) return
    const points = poles.map(pole => {
      return `
        <span class="point" style="transform: translate(${pole[0] * 100}px, ${pole[1] * 100}px);"></span>
      `
    })
    s('.preview').innerHTML = points.join('')
    s('.preview').style.display = 'flex'
    if (s('p-nav button[fn="poles"]')) s('p-nav button[fn="poles"]').innerHTML = icons[name]
    setTimeout(() => {
      if (s('.preview')) s('.preview').style.display = 'none'
    }, 3000)
  }
}

customElements.define('pole-config', PuhdeCymaticsPolePreview)