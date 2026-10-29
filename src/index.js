// The standalone app: this page hosts the studio itself, with presets in
// this browser and every source. The studio is src/studio/mount.js.
import { mountStudio } from './studio/mount.js'
import { standaloneHost } from './studio/standalone-host.js'

// ?host=fake on the dev server: a hosted studio (Music and the microphone, no
// standalone chrome) fed a synthetic spectrum, for working on the seams the
// desktop uses without the desktop.
function fakeHost() {
  const music = (onFrame) => {
    let t = 0
    const timer = setInterval(() => {
      t += 0.033
      const bins = new Float32Array(1024).fill(0.2)
      for (let i = 0; i <= 10; i++) bins[i] = 0.6 + 0.3 * Math.sin(t * 2)
      onFrame(bins, 48000)
    }, 33)
    return () => clearInterval(timer)
  }
  return {
    ...standaloneHost(),
    sources: { list: ['music', 'mic'], external: { label: 'Music', subscribe: music } },
    chrome: { standalone: false },
    actions: [{ label: 'Use as backdrop', needsSaved: true, run: (p) => console.log('[fake host] use as backdrop', p) }],
  }
}


function iOS() {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform)
  // iPad on iOS 13 detection
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
}

const isIos = iOS()
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
const isDev = window.location.hostname === 'localhost'

window.deferredPrompt = null

// window.createModal = (type) => {
//   const installModal = document.createElement('div')
//   installModal.classList.add('install', 'modal')
//   installModal.innerHTML = `
//     <div class="install modal">
//       <div class="box">
//         <p>Install Cymatics into your device?</p>
//         <button class="install">Yes</button>
//       </div>
//     </div>
//   `
//   s('#app').appendChild(installModal)
//   setTimeout(() => {    
//     s('.install.modal button.install').addEventListener('click', async () => {
//       // Show the install prompt
//       window.deferredPrompt.prompt()
//       // Wait for the user to respond to the prompt
//       const { outcome } = await deferredPrompt.userChoice
//       window.deferredPrompt = null
//     })
//     installModal.addEventListener('click', async (e) => {
//       setTimeout(() => installModal.remove())
//     })
//   }, 100)
// }

// window.addEventListener('beforeinstallprompt', (e) => {
//   // If we haven't installed the app yet, enable the install button
//   e.preventDefault()
//   window.deferredPrompt = e
//   createModal('install')
// })

window.addEventListener('appinstalled', () => {
  // window.deferredPrompt = null

})

window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
  // After installation we reload the page
  // to make sure it will show the app instead of install screen
  let displayMode = 'browser'
  if (e.matches) {
    displayMode = 'standalone'
    window.location.reload()
  }
})

mountStudio(document.querySelector('#app'), new URLSearchParams(location.search).get('host') === 'fake' ? fakeHost() : standaloneHost())
