import { Emitter } from './events.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
	readonly level: LogLevel
	readonly scope: string
	readonly message: string
	readonly time: number
	readonly data?: Readonly<Record<string, unknown>>
	readonly error?: unknown
}

export interface LogSink {
	write(record: LogRecord): void
}

const SEVERITY: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * Structured logger. Records below the minimum level are dropped, and a failing sink never breaks the caller.
 */
export class Logger {
	readonly scope: string
	readonly #sink: LogSink
	readonly #minimumLevel: LogLevel
	readonly #clock: () => number

	constructor(sink: LogSink, scope = 'strata', minimumLevel: LogLevel = 'info', clock: () => number = Date.now) {
		this.#sink = sink
		this.scope = scope
		this.#minimumLevel = minimumLevel
		this.#clock = clock
	}

	child(scope: string): Logger {
		return new Logger(this.#sink, `${this.scope}.${scope}`, this.#minimumLevel, this.#clock)
	}

	debug(message: string, data?: Readonly<Record<string, unknown>>): void {
		this.#write('debug', message, data, undefined)
	}

	info(message: string, data?: Readonly<Record<string, unknown>>): void {
		this.#write('info', message, data, undefined)
	}

	warn(message: string, data?: Readonly<Record<string, unknown>>): void {
		this.#write('warn', message, data, undefined)
	}

	error(message: string, error?: unknown, data?: Readonly<Record<string, unknown>>): void {
		this.#write('error', message, data, error)
	}

	#write(level: LogLevel, message: string, data: Readonly<Record<string, unknown>> | undefined, error: unknown): void {
		if (SEVERITY[level] < SEVERITY[this.#minimumLevel]) return
		const record: LogRecord = {
			level,
			scope: this.scope,
			message,
			time: this.#clock(),
			...(data === undefined ? {} : { data }),
			...(error === undefined ? {} : { error })
		}
		try {
			this.#sink.write(record)
		} catch {
			return
		}
	}
}

export const nullSink: LogSink = { write(): void {} }

/**
 * Keeps the most recent records and announces each one, for in-app console panels.
 */
export class MemorySink implements LogSink {
	readonly written = new Emitter<LogRecord>()
	readonly #capacity: number
	readonly #records: LogRecord[] = []

	constructor(capacity = 1000) {
		this.#capacity = Math.max(1, Math.floor(capacity))
	}

	get records(): readonly LogRecord[] {
		return [...this.#records]
	}

	write(record: LogRecord): void {
		this.#records.push(record)
		if (this.#records.length > this.#capacity) this.#records.shift()
		this.written.emit(record)
	}

	clear(): void {
		this.#records.length = 0
	}
}

/**
 * Opt-in sink for applications that want output in the browser or terminal console.
 */
export class ConsoleSink implements LogSink {
	write(record: LogRecord): void {
		const label = `[${record.scope}] ${record.message}`
		const extras: unknown[] = []
		if (record.data !== undefined) extras.push(record.data)
		if (record.error !== undefined) extras.push(record.error)
		console[record.level](label, ...extras)
	}
}
