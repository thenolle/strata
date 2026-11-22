/** @jsxImportSource @gambrel/view */
import type { Child } from '@gambrel/view'
import { createIcon, type IconName } from './icons.ts'

/**
 * A square button with an icon and a tooltip.
 */
export function IconButton(props: { readonly icon: IconName; readonly title: string; readonly active?: boolean; readonly onClick: () => void }): Child {
	return (
		<button
			type="button"
			class="icon-button"
			title={props.title}
			aria-label={props.title}
			data-active={String(props.active === true)}
			onClick={() => props.onClick()}
			ref={(element: Element) => {
				element.append(createIcon(props.icon))
			}}
		></button>
	)
}
