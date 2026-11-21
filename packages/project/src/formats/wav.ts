import { StrataError, err, ok, type Result } from '@strata/core'
import type { AudioMeta } from './types.ts'

const UNKNOWN_SIZE = 0xffffffff
const PCM = 1
const FLOAT = 3
const EXTENSIBLE = 0xfffe

export function hasWavSignature(bytes: Uint8Array): boolean {
	return bytes.length >= 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WAVE'
}

function ascii(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
}

function invalid(message: string): Result<never> {
	return err(new StrataError('invalid-format', message))
}

/**
 * Reads and validates a WAV file's format and data chunks. PCM (8 to 32 bit) and float (32, 64 bit) are supported;
 * compressed WAV is rejected. The audio itself is decoded by the browser when played.
 */
export function inspectWav(bytes: Uint8Array): Result<AudioMeta> {
	if (!hasWavSignature(bytes)) return invalid('Not a WAV file')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let formatTag = 0
	let channels = 0
	let sampleRate = 0
	let blockAlign = 0
	let bitsPerSample = 0
	let hasFormat = false
	let dataBytes: number | undefined
	let offset = 12
	while (offset + 8 <= bytes.length && !(hasFormat && dataBytes !== undefined)) {
		const id = ascii(bytes, offset)
		const size = view.getUint32(offset + 4, true)
		const body = offset + 8
		if (id === 'fmt ') {
			if (size < 16 || body + size > bytes.length) return invalid('WAV format chunk is malformed')
			formatTag = view.getUint16(body, true)
			channels = view.getUint16(body + 2, true)
			sampleRate = view.getUint32(body + 4, true)
			blockAlign = view.getUint16(body + 12, true)
			bitsPerSample = view.getUint16(body + 14, true)
			if (formatTag === EXTENSIBLE && size >= 40) formatTag = view.getUint16(body + 24, true)
			hasFormat = true
		} else if (id === 'data') {
			if (size !== UNKNOWN_SIZE && body + size > bytes.length) return invalid('WAV audio data is truncated')
			dataBytes = size === UNKNOWN_SIZE ? bytes.length - body : size
		}
		offset = body + size + (size % 2)
	}
	if (!hasFormat) return invalid('WAV file has no format chunk')
	if (dataBytes === undefined) return invalid('WAV file has no audio data')
	const encoding = formatTag === PCM ? 'pcm' : formatTag === FLOAT ? 'float' : undefined
	if (encoding === undefined) return invalid('Compressed WAV is not supported; use PCM or float')
	const validBits = encoding === 'pcm' ? [8, 16, 24, 32] : [32, 64]
	if (!validBits.includes(bitsPerSample)) return invalid(`Unsupported WAV bit depth ${bitsPerSample}`)
	if (channels < 1 || channels > 32) return invalid(`Unsupported WAV channel count ${channels}`)
	if (sampleRate < 1000 || sampleRate > 768000) return invalid(`Unsupported WAV sample rate ${sampleRate}`)
	if (blockAlign !== (channels * bitsPerSample) / 8) return invalid('WAV block size is inconsistent')
	return ok({ sampleRate, channels, bitsPerSample, encoding, durationSeconds: dataBytes / (blockAlign * sampleRate) })
}
