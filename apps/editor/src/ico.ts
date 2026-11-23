/** The width and height of a PNG, read from its header, or undefined when the bytes are not a PNG. */
export function pngSize(png: Uint8Array): { readonly width: number; readonly height: number } | undefined {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10]
	if (png.length < 24 || !signature.every((value, index) => png[index] === value)) return undefined
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * Wraps a PNG in an icon file, which Windows accepts for executables. Sizes above 256 are refused.
 */
export function pngToIco(png: Uint8Array, width: number, height: number): Uint8Array | undefined {
	if (width < 1 || height < 1 || width > 256 || height > 256) return undefined
	const out = new Uint8Array(22 + png.length)
	const view = new DataView(out.buffer)
	view.setUint16(2, 1, true)
	view.setUint16(4, 1, true)
	out[6] = width === 256 ? 0 : width
	out[7] = height === 256 ? 0 : height
	view.setUint16(10, 1, true)
	view.setUint16(12, 32, true)
	view.setUint32(14, png.length, true)
	view.setUint32(18, 22, true)
	out.set(png, 22)
	return out
}
