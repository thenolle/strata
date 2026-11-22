export interface PasswordRequest {
	readonly title: string
	/** Ask twice, for a new password. */
	readonly confirm: boolean
	readonly minLength: number
}

function field(label: string, autocomplete: HTMLInputElement['autocomplete']): { readonly row: HTMLLabelElement; readonly input: HTMLInputElement } {
	const row = document.createElement('label')
	row.className = 'dialog-field'
	row.append(label)
	const input = document.createElement('input')
	input.type = 'password'
	input.autocomplete = autocomplete
	row.append(input)
	return { row, input }
}

/**
 * Asks for a password in a small modal. Resolves to undefined when cancelled.
 */
export function askPassword(request: PasswordRequest): Promise<string | undefined> {
	return new Promise((resolve) => {
		const backdrop = document.createElement('div')
		backdrop.className = 'dialog-backdrop'
		const form = document.createElement('form')
		form.className = 'dialog'
		form.setAttribute('role', 'dialog')
		form.setAttribute('aria-label', request.title)
		const heading = document.createElement('h2')
		heading.textContent = request.title
		const first = field('Password', request.confirm ? 'new-password' : 'current-password')
		const second = request.confirm ? field('Repeat password', 'new-password') : undefined
		const hint = document.createElement('p')
		hint.className = 'dialog-hint'
		hint.textContent = request.confirm ? `Use at least ${request.minLength} characters. A lost password cannot be recovered.` : ''
		const problem = document.createElement('p')
		problem.className = 'notice'
		problem.hidden = true
		const actions = document.createElement('div')
		actions.className = 'dialog-actions'
		const cancel = document.createElement('button')
		cancel.type = 'button'
		cancel.textContent = 'Cancel'
		const submit = document.createElement('button')
		submit.type = 'submit'
		submit.textContent = 'OK'
		actions.append(cancel, submit)
		form.append(heading, first.row, ...(second === undefined ? [] : [second.row]), hint, problem, actions)
		backdrop.append(form)
		const finish = (value: string | undefined): void => {
			removeEventListener('keydown', onKey, true)
			backdrop.remove()
			resolve(value)
		}
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			finish(undefined)
		}
		form.addEventListener('submit', (event) => {
			event.preventDefault()
			const value = first.input.value
			if (request.confirm && value.length < request.minLength) problem.textContent = `Use at least ${request.minLength} characters.`
			else if (second !== undefined && second.input.value !== value) problem.textContent = 'The two passwords differ.'
			else if (value === '') problem.textContent = 'Enter the password.'
			else {
				finish(value)
				return
			}
			problem.hidden = false
		})
		cancel.addEventListener('click', () => finish(undefined))
		addEventListener('keydown', onKey, true)
		document.body.append(backdrop)
		first.input.focus()
	})
}
