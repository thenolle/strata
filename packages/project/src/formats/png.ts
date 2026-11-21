import { StrataError, err, ok, type Result } from '@strata/core'
import { crc32 } from './crc32.ts'
import type { ImageMeta } from './types.ts'

export const MAX_IMAGE_DIMENSION = 16384
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR = 0x49484452

export function hasPngSignature(bytes: Uint8Array): boolean {
	return bytes.length >= SIGNATURE.length && SIGNATURE.every((value, index) => bytes[index] === value)
}

function invalid(message: string): Result<never> {
	return err(new StrataError('invalid-format', message))
}

/**
 * Reads and validates a PNG header: signature, header chunk checksum and sane dimensions.
 * It does not decode pixels; the browser does that when the image is used.
 */
export function inspectPng(bytes: Uint8Array): Result<ImageMeta> {
	if (!hasPngSignature(bytes)) return invalid('Not a PNG file')
	if (bytes.length < 33) return invalid('PNG file is truncated')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.getUint32(8) !== 13 || view.getUint32(12) !== IHDR) return invalid('PNG is missing its header chunk')
	if (crc32(bytes.subarray(12, 29)) !== view.getUint32(29)) return invalid('PNG header checksum does not match')
	const width = view.getUint32(16)
	const height = view.getUint32(20)
	if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return invalid(`PNG dimensions ${width}x${height} are outside 1..${MAX_IMAGE_DIMENSION}`)
	return ok({ width, height })
}
