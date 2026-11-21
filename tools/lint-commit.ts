const SUBJECT = /^(feat|fix|docs|chore|ci|build|test|perf|refactor|revert)(\([a-z0-9-]+\))?!?: \S.*[^.\s]$/

const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
	[/co-authored-by:.*(claude|copilot|chatgpt|openai|gemini|anthropic|cursor|codex)/i, 'AI co-author trailer'],
	[/generated (with|by)/i, '"generated with/by" attribution'],
	[/\bai[- ](assisted|generated|written)\b/i, 'AI attribution'],
	[/\u{1F916}/u, 'robot emoji']
]

interface CommitRecord {
	readonly hash: string
	readonly message: string
}

/**
 * Returns the problems found in a commit message; an empty list means valid.
 */
export function lintMessage(message: string): string[] {
	const lines = message.split('\n').filter((line) => !line.startsWith('#'))
	const subject = lines.find((line) => line.trim().length > 0)?.trim() ?? ''
	if (subject.startsWith('Merge ') || subject.startsWith('Revert "')) return []
	const problems: string[] = []
	if (!SUBJECT.test(subject)) problems.push('subject must look like "type(scope): description"')
	if (subject.length > 72) problems.push('subject is longer than 72 characters')
	const body = lines.join('\n')
	for (const [pattern, label] of FORBIDDEN) {
		if (pattern.test(body)) problems.push(`message contains a ${label}`)
	}
	return problems
}

async function readRange(range: string): Promise<CommitRecord[]> {
	const subprocess = Bun.spawn(['git', 'log', '--format=%H%x1f%B%x1e', range], { stdout: 'pipe', stderr: 'inherit' })
	const output = await new Response(subprocess.stdout).text()
	if ((await subprocess.exited) !== 0) throw new Error(`git log failed for range ${range}`)
	return output.split('\x1e').map((record) => record.trim()).filter((record) => record.length > 0).map((record) => {
		const [hash = '', ...rest] = record.split('\x1f')
		return { hash: hash.slice(0, 7), message: rest.join('\x1f') }
	})
}

async function main(): Promise<void> {
	const [mode, value] = Bun.argv.slice(2)
	let commits: CommitRecord[] | undefined
	if (mode === '--range' && value !== undefined) commits = await readRange(value)
	else if (mode !== undefined && mode !== '--range') commits = [{ hash: 'message', message: await Bun.file(mode).text() }]
	if (commits === undefined) {
		console.error('Usage: bun tools/lint-commit.ts <message-file> | --range <a..b>')
		process.exit(2)
	}
	let failed = false
	for (const commit of commits) {
		for (const problem of lintMessage(commit.message)) {
			console.error(`${commit.hash}: ${problem}`)
			failed = true
		}
	}
	if (failed) process.exit(1)
}

if (import.meta.main) await main()
