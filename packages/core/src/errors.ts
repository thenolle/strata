export type StrataErrorCode =
	| 'invalid-argument'
	| 'invalid-entity'
	| 'duplicate-component'
	| 'missing-component'
	| 'invalid-schedule'
	| 'invalid-format'
	| 'unsupported-version'
	| 'unsupported'
	| 'graphics-failure'
	| 'not-found'
	| 'conflict'
	| 'corrupt'
	| 'storage-failure'
	| 'capacity-exceeded'
	| 'disposed'

/**
 * Error raised for programmer mistakes and violated invariants. The code is stable and safe to match on.
 */
export class StrataError extends Error {
	readonly code: StrataErrorCode

	constructor(code: StrataErrorCode, message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'StrataError'
		this.code = code
	}
}
