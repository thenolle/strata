import { SizeHint, Webview } from 'webview-bun'

/**
 * Opens the game in a native window. The page is already complete inside the html text, so nothing is served.
 * With --check it only proves that the webview library loads inside the executable, and exits.
 */
export function start(html: string, title: string): void {
	if (process.argv.includes('--check')) {
		console.log('check ok', html.length, typeof Webview)
		return
	}
	const webview = new Webview()
	webview.title = title
	webview.size = { width: 1280, height: 720, hint: SizeHint.NONE }
	webview.setHTML(html)
	webview.run()
	webview.destroy()
}
