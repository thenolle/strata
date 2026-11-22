import { SizeHint, Webview } from 'webview-bun'

export interface WindowOptions {
	readonly title: string
	readonly width: number
	readonly height: number
	readonly resizable: boolean
}

/**
 * Opens the game in a native window. The page is already complete inside the html text, so nothing is served.
 * With --check it only proves that the webview library loads inside the executable, and exits.
 */
export function start(html: string, options: WindowOptions): void {
	if (process.argv.includes('--check')) {
		console.log('check ok', html.length, typeof Webview)
		return
	}
	const webview = new Webview()
	webview.title = options.title
	webview.size = { width: options.width, height: options.height, hint: options.resizable ? SizeHint.NONE : SizeHint.FIXED }
	webview.setHTML(html)
	webview.run()
	webview.destroy()
}
