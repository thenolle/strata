import type { AssetRecord } from '@strata/project'

/**
 * Messages between the editor and the sandboxed game frame.
 */
export interface FrameAsset {
	readonly record: AssetRecord
	readonly bytes: ArrayBuffer
}

export type ToFrame = {
	readonly type: 'start'
	readonly scene: string
	readonly assets: readonly FrameAsset[]
	readonly scripts: readonly { readonly id: string; readonly code: string }[]
}

export type FromFrame =
	| { readonly type: 'ready' }
	| { readonly type: 'status'; readonly text: string }
	| { readonly type: 'log'; readonly text: string }
	| { readonly type: 'error'; readonly text: string }
	| { readonly type: 'stop' }
