/** @jsxImportSource @gambrel/view */
import { effect } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { output } from './output.ts'

/** The output log: newest line at the bottom, errors in red, scrolled to the end as lines arrive. */
export function OutputView(): Child {
	return (
		<div
			class="output"
			role="log"
			aria-live="polite"
			ref={(element: Element) => {
				const box = element as HTMLElement
				effect(() => {
					output.lines()
					output.markSeen()
					queueMicrotask(() => {
						box.scrollTop = box.scrollHeight
					})
				})
			}}
		>
			{() => {
				const list = output.lines()
				if (list.length === 0) return <p class="panel-empty">Nothing yet. Logs, errors and results appear here.</p>
				return list.map((line) => (
					<div class="output-line" data-kind={line.kind}>
						<span class="output-time">{new Date(line.time).toLocaleTimeString()}</span>
						<span>{line.text}</span>
					</div>
				))
			}}
		</div>
	)
}
