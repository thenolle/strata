import type { Guid, Logger, World } from '@strata/core'
import { AudioSource } from '@strata/gameplay'
import type { AssetLibrary } from '@strata/project'

/**
 * Plays the audio components of a world with the Web Audio API. Create it from a user gesture such as pressing Play.
 */
export class AudioSystem {
	readonly #assets: AssetLibrary
	readonly #logger: Logger
	readonly #sources = new Set<AudioBufferSourceNode>()
	#context: AudioContext | undefined

	constructor(assets: AssetLibrary, logger: Logger) {
		this.#assets = assets
		this.#logger = logger
	}

	async start(world: World): Promise<void> {
		const players = world.query(AudioSource).map((entity) => world.require(entity, AudioSource)).filter((data) => data.autoplay && data.asset !== '')
		if (players.length === 0) return
		const context = new AudioContext()
		this.#context = context
		await context.resume().catch(() => undefined)
		const buffers = new Map<string, AudioBuffer>()
		for (const data of players) {
			try {
				let buffer = buffers.get(data.asset)
				if (buffer === undefined) {
					const record = this.#assets.get(data.asset as Guid)
					if (record?.kind !== 'audio') continue
					const bytes = await this.#assets.read(record.id)
					if (!bytes.ok) continue
					buffer = await context.decodeAudioData(bytes.value.slice().buffer as ArrayBuffer)
					buffers.set(data.asset, buffer)
				}
				const source = context.createBufferSource()
				source.buffer = buffer
				source.loop = data.loop
				const gain = context.createGain()
				gain.gain.value = Math.max(0, data.volume)
				source.connect(gain).connect(context.destination)
				source.start()
				this.#sources.add(source)
			} catch (error: unknown) {
				this.#logger.error('Audio failed to play', error)
			}
		}
	}

	dispose(): void {
		for (const source of this.#sources) {
			try {
				source.stop()
			} catch {
				// Already stopped.
			}
		}
		this.#sources.clear()
		void this.#context?.close().catch(() => undefined)
		this.#context = undefined
	}
}
