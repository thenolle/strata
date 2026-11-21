/**
 * Returns the bytes backed by a plain ArrayBuffer, copying only when they live in shared memory.
 * Browser APIs that take binary data require this form.
 */
export function toBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
	return data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : data.slice()
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', toBuffer(data))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
