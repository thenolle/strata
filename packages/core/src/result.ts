import type { StrataError } from './errors.ts'

/**
 * Outcome of an operation whose failure is expected, such as storage or parsing.
 */
export type Result<T, E = StrataError> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error }
}
