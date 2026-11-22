import { StrataError, err, ok, type Result } from '@strata/core'

const MAGIC = new Uint8Array([0x53, 0x54, 0x52, 0x41, 0x54, 0x41, 0x00, 0x01])
const HEADER = 41
const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 10_000_000

export const ITERATIONS = 600_000
export const MIN_PASSWORD = 8

/**
 * Layout: magic (8), version (1), iterations (4), salt (16), iv (12), then the encrypted data with its tag.
 * The first 41 bytes are authenticated, so changing any of them makes decryption fail.
 */
export function isSealed(bytes: Uint8Array): boolean {
	return bytes.length > HEADER + 16 && MAGIC.every((value, index) => bytes[index] === value)
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
	return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.slice(), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Encrypts data with a key derived from the password. Throws when the password is too short.
 */
export async function seal(plain: Uint8Array, password: string): Promise<Uint8Array> {
	if (password.length < MIN_PASSWORD) throw new RangeError(`Use at least ${MIN_PASSWORD} characters`)
	const header = new Uint8Array(HEADER)
	header.set(MAGIC, 0)
	header[8] = 1
	new DataView(header.buffer).setUint32(9, ITERATIONS, false)
	crypto.getRandomValues(header.subarray(13, 29))
	crypto.getRandomValues(header.subarray(29, 41))
	const key = await derive(password, header.subarray(13, 29), ITERATIONS)
	const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.slice(29, 41), additionalData: header.slice() }, key, plain.slice()))
	const out = new Uint8Array(HEADER + cipher.length)
	out.set(header, 0)
	out.set(cipher, HEADER)
	return out
}

/**
 * Decrypts a sealed file. A wrong password and a damaged file look the same on purpose.
 */
export async function unseal(bytes: Uint8Array, password: string): Promise<Result<Uint8Array>> {
	if (!isSealed(bytes)) return err(new StrataError('invalid-format', 'This is not an encrypted Strata file'))
	const header = bytes.slice(0, HEADER)
	if (header[8] !== 1) return err(new StrataError('invalid-format', 'This file was made by a newer version of Strata'))
	const iterations = new DataView(header.buffer).getUint32(9, false)
	if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return err(new StrataError('corrupt', 'The file header is damaged'))
	try {
		const key = await derive(password, header.slice(13, 29), iterations)
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.slice(29, 41), additionalData: header }, key, bytes.slice(HEADER))
		return ok(new Uint8Array(plain))
	} catch {
		return err(new StrataError('corrupt', 'Wrong password, or the file is damaged'))
	}
}
