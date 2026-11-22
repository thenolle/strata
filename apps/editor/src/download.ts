/** Saves bytes as a file through the browser's download. */
export function download(fileName: string, bytes: Uint8Array, type = 'application/octet-stream'): void {
	const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = fileName
	document.body.append(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
