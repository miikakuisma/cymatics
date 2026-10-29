// Turn a dropped or picked image file into a data URL small enough to live
// inside a preset.
//
// Presets are round-tripped through JSON: "Set as Default" writes one to
// localStorage with JSON.stringify, and exportPreset() logs one to the console.
// A Blob survives neither, so the image has to be a string — which means base64,
// and base64 costs about a third again on top of the bytes. Downscaling and
// re-encoding first is what keeps a scene a few hundred KB rather than several
// MB, and a pool floor seen through moving water has no use for more.

const MAX_EDGE = 1024
const JPEG_QUALITY = 0.85

export async function fileToScaledDataUrl(file, maxEdge = MAX_EDGE) {
	const bitmap = await createImageBitmap(file)
	try {
		const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
		const w = Math.max(1, Math.round(bitmap.width * scale))
		const h = Math.max(1, Math.round(bitmap.height * scale))

		const canvas = document.createElement('canvas')
		canvas.width = w
		canvas.height = h
		const ctx = canvas.getContext('2d')
		ctx.drawImage(bitmap, 0, 0, w, h)

		// JPEG, not PNG: a photographic floor texture is exactly what JPEG is for,
		// and a PNG of the same image can be an order of magnitude larger.
		return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
	} finally {
		bitmap.close?.()
	}
}

export function isImageFile(file) {
	return !!file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))
}
