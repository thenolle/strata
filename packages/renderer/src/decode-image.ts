/**
 * Decodes encoded image bytes into a bitmap with straight alpha and no color conversion, ready for `createTexture`.
 */
export async function decodeImage(bytes: Uint8Array, type = 'image/png'): Promise<ImageBitmap> {
	const buffer = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice()
	return createImageBitmap(new Blob([buffer], { type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
}
