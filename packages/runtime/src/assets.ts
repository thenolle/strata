import type { Guid, Result } from '@strata/core'
import type { AssetRecord } from '@strata/project'

/**
 * What a game needs to find its assets. The project's asset library satisfies it, and so does an in-memory copy inside the sandbox.
 */
export interface GameAssets {
	get(id: Guid): AssetRecord | undefined
	read(id: Guid): Promise<Result<Uint8Array>>
}
