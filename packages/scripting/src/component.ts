import { defineComponent } from '@strata/core'

/**
 * Attaches a script asset, referenced by its id, to an entity.
 */
export const ScriptSource = defineComponent('script', { asset: 'string' }, { asset: '' })
