/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'

export interface DialogOptions {
	readonly title?: string
	readonly okLabel?: string
	readonly cancelLabel?: string
	readonly danger?: boolean
}
export interface PromptOptions extends DialogOptions {
	readonly value?: string
	readonly placeholder?: string
	/** Returns a problem to show, or undefined when the text is fine. */
	readonly validate?: (value: string) => string | undefined
}
export interface Choice<T> {
	readonly label: string
	readonly value: T
	readonly detail?: string
}

type Request =
	| { readonly kind: 'alert'; readonly message: string; readonly options: DialogOptions; readonly resolve: (value: undefined) => void }
	| { readonly kind: 'confirm'; readonly message: string; readonly options: DialogOptions; readonly resolve: (value: boolean) => void }
	| { readonly kind: 'prompt'; readonly message: string; readonly options: PromptOptions; readonly resolve: (value: string | undefined) => void }
	| { readonly kind: 'choose'; readonly message: string; readonly options: DialogOptions; readonly choices: readonly Choice<unknown>[]; readonly resolve: (value: unknown) => void }

const queue = signal<readonly Request[]>([])

/** True while any dialog is showing, so global shortcuts can stand down. */
export const dialogOpen = (): boolean => queue().length > 0

function ask<T>(make: (resolve: (value: T) => void) => Request): Promise<T> {
	return new Promise<T>((resolve) => queue.update((list) => [...list, make(resolve)]))
}

export const dialogs = {
	alert: (message: string, options: DialogOptions = {}): Promise<undefined> => ask<undefined>((resolve) => ({ kind: 'alert', message, options, resolve })),
	confirm: (message: string, options: DialogOptions = {}): Promise<boolean> => ask<boolean>((resolve) => ({ kind: 'confirm', message, options, resolve })),
	prompt: (message: string, options: PromptOptions = {}): Promise<string | undefined> => ask<string | undefined>((resolve) => ({ kind: 'prompt', message, options, resolve })),
	choose: <T,>(message: string, choices: readonly Choice<T>[], options: DialogOptions = {}): Promise<T | undefined> =>
		ask<T | undefined>((resolve) => ({ kind: 'choose', message, options, choices: choices as readonly Choice<unknown>[], resolve: resolve as (value: unknown) => void }))
}

const TITLES = { alert: 'Notice', confirm: 'Confirm', prompt: 'Enter a value', choose: 'Choose' } as const

function View(props: { readonly request: Request }): Child {
	const request = props.request
	const error = signal('')
	const finish = (value: unknown): void => {
		queue.update((list) => list.filter((item) => item !== request))
		;(request.resolve as (value: unknown) => void)(value)
	}
	const cancel = (): void => finish(request.kind === 'confirm' ? false : undefined)
	let input: HTMLInputElement | undefined
	const accept = (): void => {
		if (request.kind === 'prompt') {
			const text = input?.value ?? ''
			const problem = request.options.validate?.(text)
			if (problem !== undefined) {
				error.set(problem)
				return
			}
			finish(text)
		} else finish(request.kind === 'confirm' ? true : undefined)
	}
	return (
		<div class="dialog-backdrop dialog-host">
			<div
				class="dialog"
				role={request.kind === 'alert' ? 'alertdialog' : 'dialog'}
				aria-modal="true"
				aria-label={request.options.title ?? TITLES[request.kind]}
				ref={(element: Element) => {
					const root = element as HTMLElement
					const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
					queueMicrotask(() => {
						if (request.kind === 'prompt') {
							input?.focus()
							input?.select()
						} else (root.querySelector<HTMLElement>('.dialog-choice') ?? root.querySelector<HTMLElement>('.dialog-actions button:last-child'))?.focus()
					})
					const onKey = (event: KeyboardEvent): void => {
						event.stopPropagation()
						if (event.key === 'Escape') {
							event.preventDefault()
							cancel()
						} else if (event.key === 'Enter' && request.kind !== 'choose' && !(event.target instanceof HTMLButtonElement)) {
							event.preventDefault()
							accept()
						} else if (event.key === 'Tab') {
							const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')]
							const first = items[0]
							const last = items[items.length - 1]
							if (first === undefined || last === undefined) return
							if (event.shiftKey && document.activeElement === first) {
								event.preventDefault()
								last.focus()
							} else if (!event.shiftKey && document.activeElement === last) {
								event.preventDefault()
								first.focus()
							}
						} else if (request.kind === 'choose' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
							event.preventDefault()
							const options = [...root.querySelectorAll<HTMLElement>('.dialog-choice')]
							const index = options.indexOf(document.activeElement as HTMLElement)
							options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
						}
					}
					root.addEventListener('keydown', onKey)
					onCleanup(() => {
						root.removeEventListener('keydown', onKey)
						previous?.focus()
					})
				}}
			>
				<h2>{request.options.title ?? TITLES[request.kind]}</h2>
				<p class="dialog-message">{request.message}</p>
				{request.kind === 'prompt' ? (
					<div>
						<input
							class="dialog-input"
							type="text"
							value={request.options.value ?? ''}
							placeholder={request.options.placeholder ?? ''}
							ref={(element: Element) => {
								input = element as HTMLInputElement
							}}
							onInput={() => error.set(request.options.validate?.(input?.value ?? '') ?? '')}
						/>
						<p class="dialog-error">{error}</p>
					</div>
				) : null}
				{request.kind === 'choose' ? (
					<ul class="dialog-choices" role="listbox">
						{request.choices.map((choice) => (
							<li>
								<button type="button" class="dialog-choice" role="option" onClick={() => finish(choice.value)}>
									{choice.label}
									{choice.detail === undefined ? null : <small>{choice.detail}</small>}
								</button>
							</li>
						))}
					</ul>
				) : null}
				<div class="dialog-actions">
					{request.kind === 'alert' ? null : (
						<Button variant="outline" onClick={cancel}>
							{request.options.cancelLabel ?? 'Cancel'}
						</Button>
					)}
					{request.kind === 'choose' ? null : (
						<Button variant={request.options.danger === true ? 'destructive' : 'default'} onClick={accept}>
							{request.options.okLabel ?? 'OK'}
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}

/** Shows the oldest pending dialog. Mount once at the root of the app. */
export function DialogHost(): Child {
	return <>{() => (queue()[0] === undefined ? null : <View request={queue()[0] as Request} />)}</>
}
