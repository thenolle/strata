const TABLE = new Uint32Array(256)

for (let n = 0; n < 256; n++) {
	let value = n
	for (let bit = 0; bit < 8; bit++) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
	TABLE[n] = value >>> 0
}

export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff
	for (const byte of bytes) crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}
