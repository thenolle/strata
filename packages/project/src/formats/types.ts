export interface ImageMeta {
	readonly width: number
	readonly height: number
}

export interface AudioMeta {
	readonly sampleRate: number
	readonly channels: number
	readonly bitsPerSample: number
	readonly encoding: 'pcm' | 'float'
	readonly durationSeconds: number
}
