class Xycontrol extends HTMLElement {

	constructor() {
    super()
		this.label = ''
		this.x = 0
		this.y = 0
		this.z = -1
		this.startX = null
		this.startY = null
		this.posX = 0
		this.posY = 0
		this.startPosX = 0
		this.startPosY = 0
		this.controls = ''
		// range of values is 0..1
		this.values = {
			x: 0.5,
			y: 0.5,
			z: -1
		}
		this.handles = []
		this.selectedHandle = 0
  }

  connectedCallback() {
		this.render()
  }

	static get observedAttributes() {
		return ['controls']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
	}

	async render() {
		let handles = ''
		// The selection can outlive its light: a removed light, or a preset with
		// fewer lights than the last one.
		if (this.selectedHandle >= this.handles.length) this.selectedHandle = 0
		if (this.handles.length > 0) {
			this.handles.filter(h => h.controls === this.controls).map((handle, index) => {

				const xPos = handle.pos[0] * (100 / 3)
				const yPos = handle.pos[1] * (100 / 3)
				handles += `<div
					class="handle"
					handle-index=${index}
					x=${xPos}
					y=${yPos}
					style="transform: translate(${xPos}px, ${yPos}px); background-color: ${handle.color}"
				></div>`
			})
		} else if (this.controls === 'lights') {
			// No lights is a real state (a preset can have none): say so rather
			// than draw a handle with nothing behind it.
			handles = '<div class="empty">No lights. Press + to add one.</div>'
		} else {
			handles = '<div class="handle"></div>'
		}
		this.innerHTML = `
			<div class="grid">
				${handles}
			</div>
			<div class="buttons left">
				<button class="reset">${icons.center}</button>
				${this.controls === 'lights' ? '<button class="remove">-</button>' : ''}
			</div>
			${this.controls === 'lights' ? `
				<div class="buttons right">
					<button class="add">+</button>
				</div>
			` : ''}
			<div class="label">${this.getAttribute('label')}</div>
		`
		setTimeout(() => {
			this.init()
		})
	}

	updateHandles() {
		this.render()
	}

	addHandle(handle) {
		const index = this.handles.length
		this.querySelector('.grid').innerHTML += `
			<div 
				class="handle"
				handle-index=${index}
				x=${handle.pos[0]}
				y=${handle.pos[1]}
				style="transform: translate(${handle.pos[0]}px, ${handle.pos[1]}px); background-color: ${handle.color}"
			></div>`
		setTimeout(() => {
			this.init()
		})
	}

	init() {
		let handles = this.querySelectorAll('.handle')

		handles.forEach(handle => {
			handle.onpointerdown = (e) => {
				this.selectedHandle = parseInt(e.target.getAttribute('handle-index'))
				// const handlePosition = handle.style.transform.replace('translate(','').replace(')', '').replace('px', '').replace('px', '').split(', ')
				const handlePosition = [
					parseInt(handle.getAttribute('x')),
					parseInt(handle.getAttribute('y'))
				]

				this.startPosX = parseInt(handlePosition[0])
				this.startPosY = parseInt(handlePosition[1])
				this.selectedHandle = parseInt(e.target.getAttribute('handle-index'))
				this.isThisClick = true
				setTimeout(() => {
					this.isThisClick = false
				}, 500)
				this.startX = e.pageX
				this.startY = e.pageY
				document.addEventListener('pointermove', handleMove)
				document.addEventListener('pointerup', handleEnd)
			}

			const handleMove = (e) => {
				// calculate how much it has moved
				const diffX = e.pageX - this.startX
				const diffY = e.pageY - this.startY
				// update position
				this.posX = this.startPosX + diffX
				this.posY = this.startPosY + diffY
				// set boundaries
				if (this.posX > 48) this.posX = 48
				if (this.posX < -48) this.posX = -48
				if (this.posY > 48) this.posY = 48
				if (this.posY < -48) this.posY = -48
				// update handle position
				handle.style.transform = `translate(${this.posX}px, ${this.posY}px)`
				// update values
				this.updateValues()
			}
	
			const handleEnd = (e) => {
				if (this.isThisClick) {
					this.dispatchEvent(new CustomEvent("select"))
					if (handle.classList.contains('selected')) {
						handle.classList.remove('selected')
						this.querySelector('.buttons').classList.remove('visible')
						s('input[name="light_distance"]').setAttribute('disabled', true)
						// s('input[name="light_brightness"]').setAttribute('disabled', true)
					} else {
						handles.forEach(handle => handle.classList.remove('selected'))
						handle.classList.add('selected')
						this.querySelector('.buttons').classList.add('visible')
						if (!window.__dynamicLightDistance) s('input[name="light_distance"]').removeAttribute('disabled')
						// s('input[name="light_brightness"]').removeAttribute('disabled')
						const extColorPicker = s('input.light-color-picker')
						if (extColorPicker) extColorPicker.value = this.handles[this.selectedHandle].color
					}
				} else {
					this.updateValues()
				}
				document.removeEventListener('pointermove', handleMove)
				document.removeEventListener('pointerup', handleEnd)
			}
		})
	
		let resetButton = this.querySelector('button.reset')
		if (resetButton) {
			resetButton.addEventListener('click', () => {
				this.dispatchEvent(new CustomEvent("change", { detail: { reset: true, handleIndex: this.selectedHandle }} ))
			})
		}

		let addButton = this.querySelector('button.add')
		if (addButton) {
			addButton.addEventListener('click', () => {
				this.dispatchEvent(new CustomEvent("change", { detail: { add: true }} ))
			})
		}

		let removeButton = this.querySelector('button.remove')
		if (removeButton) {
			removeButton.addEventListener('click', () => {
				const selected = this.querySelector('.handle.selected')
				if (!selected) return
				this.dispatchEvent(new CustomEvent("change", { detail: { remove: true, handleIndex: this.selectedHandle }} ))
				// Redraw rather than drop the one element: every handle after it
				// shifts down an index, and stale handle-index attributes would
				// steer the wrong light.
				this.selectedHandle = 0
				this.render()
			})
		}
	}

	reset() {
		this.x = 0
		this.y = 0
		this.z = -1
		this.startX = null
		this.startY = null
		this.posX = 0
		this.posY = 0
		this.startPosX = 0
		this.startPosY = 0
		// range of values is 0..1
		this.values = {
			x: 0.5,
			y: 0.5,
		}
		this.handles[this.selectedHandle].pos = [0, 0]
		let handle = this.querySelector('.handle.selected')
		handle.style.transform = `translate(${this.posX}px, ${-this.posY}px)`
		this.updateValues()
	}

	updateValues() {
		const width = this.offsetWidth
		const height = this.offsetHeight
		const scaleX = 1 / width
		const scaleY = 1 / height
		this.handles[this.selectedHandle].pos = [this.posX * scaleX * 4, this.posY * scaleY * 4]
		this.values.x = this.posX * scaleX * 4
		this.values.y = this.posY * scaleY * 4
		this.values.z = this.z
		// this.values.x = this.posX * scaleX + 0.5
		// this.values.y = this.posY * scaleY + 0.5
		this.dispatchEvent(new CustomEvent("change", { detail: { handleIndex: this.selectedHandle } }))
	}
}

customElements.define('xy-control', Xycontrol)
