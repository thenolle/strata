import { StrataError, err, type Result } from '@strata/core'

/**
 * Maps a thrown storage failure to a stable error. A full disk or quota becomes `capacity-exceeded`.
 */
export function storageError(error: unknown): StrataError {
	if (error instanceof StrataError) return error
	if (error instanceof Error && error.name === 'QuotaExceededError') return new StrataError('capacity-exceeded', 'Storage is full', { cause: error })
	const message = error instanceof Error ? error.message : String(error)
	return new StrataError('storage-failure', `Storage operation failed: ${message}`, { cause: error })
}

/**
 * Runs a storage task and turns any thrown failure into an error result.
 */
export async function guard<T>(task: () => Promise<Result<T>>): Promise<Result<T>> {
	try {
		return await task()
	} catch (error: unknown) {
		return err(storageError(error))
	}
}
