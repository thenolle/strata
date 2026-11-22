import { defineComponent } from '@strata/core'

/**
 * Plays an audio asset, referenced by its id, when the game starts if `autoplay` is on.
 */
export const AudioSource = defineComponent(
	'audio',
	{ asset: 'string', volume: 'f32', loop: 'bool', autoplay: 'bool' },
	{ asset: '', volume: 1, loop: false, autoplay: true }
)
