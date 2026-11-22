import { StrataError, err, ok, type Result } from '@strata/core'

export interface ZipEntry {
	readonly name: string
	readonly data: Uint8Array
}

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const MAX_SIZE = 0xffffffff

const TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
	let c = n
	for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	TABLE[n] = c >>> 0
}

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff
	for (const byte of data) crc = (TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

function dosStamp(date: Date): { readonly time: number; readonly date: number } {
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		date: (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
	}
}

/**
 * Writes an uncompressed zip archive. Throws a RangeError when the contents do not fit a plain zip file.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
	if (entries.length > 0xfffe) throw new RangeError('Too many files for a zip archive')
	const encoder = new TextEncoder()
	const stamp = dosStamp(new Date())
	const chunks: Uint8Array[] = []
	const directory: Uint8Array[] = []
	let offset = 0
	for (const entry of entries) {
		const name = encoder.encode(entry.name)
		if (name.length > 0xffff || entry.data.length > MAX_SIZE) throw new RangeError('A file is too large for a zip archive')
		const crc = crc32(entry.data)
		const local = new Uint8Array(30 + name.length)
		const lv = new DataView(local.buffer)
		lv.setUint32(0, LOCAL, true)
		lv.setUint16(4, 20, true)
		lv.setUint16(6, 0x0800, true)
		lv.setUint16(10, stamp.time, true)
		lv.setUint16(12, stamp.date, true)
		lv.setUint32(14, crc, true)
		lv.setUint32(18, entry.data.length, true)
		lv.setUint32(22, entry.data.length, true)
		lv.setUint16(26, name.length, true)
		local.set(name, 30)
		const header = new Uint8Array(46 + name.length)
		const hv = new DataView(header.buffer)
		hv.setUint32(0, CENTRAL, true)
		hv.setUint16(4, 20, true)
		hv.setUint16(6, 20, true)
		hv.setUint16(8, 0x0800, true)
		hv.setUint16(12, stamp.time, true)
		hv.setUint16(14, stamp.date, true)
		hv.setUint32(16, crc, true)
		hv.setUint32(20, entry.data.length, true)
		hv.setUint32(24, entry.data.length, true)
		hv.setUint16(28, name.length, true)
		hv.setUint32(42, offset, true)
		header.set(name, 46)
		chunks.push(local, entry.data)
		directory.push(header)
		offset += local.length + entry.data.length
		if (offset > MAX_SIZE) throw new RangeError('The project is too large for a zip archive')
	}
	const directorySize = directory.reduce((total, part) => total + part.length, 0)
	const end = new Uint8Array(22)
	const ev = new DataView(end.buffer)
	ev.setUint32(0, END, true)
	ev.setUint16(8, entries.length, true)
	ev.setUint16(10, entries.length, true)
	ev.setUint32(12, directorySize, true)
	ev.setUint32(16, offset, true)
	const parts = [...chunks, ...directory, end]
	const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
	let position = 0
	for (const part of parts) {
		result.set(part, position)
		position += part.length
	}
	return result
}

/**
 * Reads an archive made by writeZip. Compressed, encrypted and damaged archives are refused.
 */
export function readZip(bytes: Uint8Array): Result<ZipEntry[]> {
	const bad = (message: string): Result<ZipEntry[]> => err(new StrataError('invalid-format', message))
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let end = -1
	for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 0xffff); index--) {
		if (view.getUint32(index, true) === END) {
			end = index
			break
		}
	}
	if (end < 0) return bad('This file is not a zip archive')
	const count = view.getUint16(end + 10, true)
	let cursor = view.getUint32(end + 16, true)
	const decoder = new TextDecoder('utf-8', { fatal: true })
	const entries: ZipEntry[] = []
	for (let item = 0; item < count; item++) {
		if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) return bad('The archive directory is damaged')
		const flags = view.getUint16(cursor + 8, true)
		const method = view.getUint16(cursor + 10, true)
		const crc = view.getUint32(cursor + 16, true)
		const packed = view.getUint32(cursor + 20, true)
		const size = view.getUint32(cursor + 24, true)
		const nameLength = view.getUint16(cursor + 28, true)
		const extraLength = view.getUint16(cursor + 30, true)
		const commentLength = view.getUint16(cursor + 32, true)
		const local = view.getUint32(cursor + 42, true)
		if (method !== 0 || (flags & 1) !== 0 || packed !== size) return bad('Only archives exported from Strata can be opened')
		let name: string
		try {
			name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
		} catch {
			return bad('A file name in the archive is not valid text')
		}
		if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) return bad('The archive is damaged')
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
		if (start + size > bytes.length) return bad('The archive is truncated')
		const data = bytes.subarray(start, start + size)
		if (crc32(data) !== crc) return err(new StrataError('corrupt', `The file "${name}" in the archive is damaged`))
		entries.push({ name, data: data.slice() })
		cursor += 46 + nameLength + extraLength + commentLength
	}
	return ok(entries)
}
