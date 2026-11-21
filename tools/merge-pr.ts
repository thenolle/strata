import { setTimeout as sleep } from 'node:timers/promises'

const POLL_MS = 5000
const APPEAR_TIMEOUT_MS = 90_000
const FINISH_TIMEOUT_MS = 6 * 60_000

interface Check {
	readonly name: string
	readonly bucket: string
}

interface Output {
	readonly code: number
	readonly stdout: string
	readonly stderr: string
}

async function run(command: string, args: string[]): Promise<Output> {
	const process = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
	return { code, stdout, stderr }
}

function isCheck(value: unknown): value is Check {
	return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['name'] === 'string' && typeof (value as Record<string, unknown>)['bucket'] === 'string'
}

async function readChecks(): Promise<Check[]> {
	try {
		const parsed: unknown = JSON.parse((await run('gh', ['pr', 'checks', '--json', 'name,bucket'])).stdout)
		return Array.isArray(parsed) ? parsed.filter(isCheck) : []
	} catch {
		return []
	}
}

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

const branch = (await run('git', ['branch', '--show-current'])).stdout.trim()
if (branch === '' || branch === 'master') fail('Switch to the pull request branch first.')

const started = Date.now()
let announced = false
for (;;) {
	const checks = await readChecks()
	const elapsed = Date.now() - started
	if (checks.length === 0) {
		if (elapsed > APPEAR_TIMEOUT_MS) fail('No checks appeared for this pull request.')
	} else {
		const failed = checks.filter((check) => check.bucket === 'fail' || check.bucket === 'cancel')
		if (failed.length > 0) fail(`Checks failed: ${failed.map((check) => check.name).join(', ')}`)
		if (checks.every((check) => check.bucket === 'pass' || check.bucket === 'skipping')) break
		if (!announced) console.log(`Waiting for ${checks.filter((check) => check.bucket === 'pending').length} check(s)`)
		announced = true
	}
	if (elapsed > FINISH_TIMEOUT_MS) fail('Timed out waiting for checks.')
	await sleep(POLL_MS)
}

const merged = await run('gh', ['pr', 'merge', '--squash', '--delete-branch'])
if (merged.code !== 0) fail(merged.stderr || merged.stdout)
console.log(merged.stdout.trim() || 'Merged.')
const pulled = await run('git', ['pull', '--ff-only'])
if (pulled.code !== 0) fail(pulled.stderr || pulled.stdout)
console.log('Local master is up to date.')
