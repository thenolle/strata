/**
 * Random 128-bit identifier as 32 lowercase hex characters. Stable across saves, unlike runtime entity handles.
 */
export type Guid = string & { readonly __guid: true }

const GUID_PATTERN = /^[0-9a-f]{32}$/

export function createGuid(): Guid {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as Guid
}

export function isGuid(value: unknown): value is Guid {
	return typeof value === 'string' && GUID_PATTERN.test(value)
}
