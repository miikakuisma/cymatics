// The app's one thumbnail queue: the engine renderer behind the IndexedDB
// cache, yielding a frame between renders so the live plate keeps running.
import { createThumbQueue } from './thumbnails.js'
import { createThumbnailer } from './thumbnailer.js'
import { thumbCache } from './thumb-cache.js'

const queue = createThumbQueue({
	cache: thumbCache,
	makeRenderer: createThumbnailer,
	pause: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
})

export const thumbnailFor = queue.thumbnailFor
