import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')
).version
const isWin = process.platform === 'win32'
const isWSL =
  process.platform === 'linux' &&
  (process.env.WSL_DISTRO_NAME ||
    (existsSync('/proc/version') &&
      readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')))

const bin = (name) => join(root, 'node_modules/.bin', isWin ? `${name}.cmd` : name)

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

async function main() {
  if (!isWin && !isWSL) {
    throw new Error(
      'build-win.mjs must be run on Windows or WSL. Use npm run build:linux for native Linux builds.'
    )
  }

  // On WSL use the Linux npm (the JS bundle step is pure JS and works cross-platform).
  await run(isWin ? 'npm.cmd' : 'npm', ['run', 'build'])

  if (isWin) {
    // ── Native Windows build ────────────────────────────────────────
    // Force-rebuild better-sqlite3 for the win32 Electron ABI.
    console.log('▶ Rebuilding better-sqlite3 for Windows (win32/x64)…')
    await run(bin('electron-rebuild'), [
      '--force',
      '--which-module', 'better-sqlite3',
      '--version', electronVersion,
      '--platform', 'win32',
      '--arch', 'x64'
    ])

    console.log('▶ Packaging the Windows build (electron-builder)…')
    await run(bin('electron-builder'), ['--win', '--config', 'electron-builder.yml'])

    // Restore the dev native module so the local environment stays usable.
    console.log(`▶ Restoring the native module for ${process.platform}/${process.arch}…`)
    await run(bin('electron-rebuild'), [
      '--force',
      '--which-module', 'better-sqlite3',
      '--version', electronVersion,
      '--platform', process.platform,
      '--arch', process.arch
    ])
    execFileSync(process.execPath, ['-e', "require('better-sqlite3')"], { cwd: root, stdio: 'pipe' })
    console.log('✓ Dev native module restored and loads correctly.')
  } else {
    // ── WSL cross-build ─────────────────────────────────────────────
    // better-sqlite3 ships prebuilt win32-x64.node in prebuilds/.
    // electron-rebuild would overwrite it with a Linux binary (node-gyp
    // cannot cross-compile), so we skip it and let electron-builder
    // package the prebuilt directly.
    console.log('▶ WSL cross-build: verifying win32-x64 prebuilt…')

    const prebuiltPath = join(root, 'node_modules/better-sqlite3/prebuilds/win32-x64.node')
    if (!existsSync(prebuiltPath)) {
      throw new Error(
        'prebuilds/win32-x64.node not found. better-sqlite3 does not ship a prebuilt for this Electron version on win32/x64.'
      )
    }
    const desc = execFileSync('file', [prebuiltPath], { encoding: 'utf8' }).trim()
    console.log(desc)
    if (!/PE32\+|MS Windows/i.test(desc)) {
      throw new Error('prebuilds/win32-x64.node is not a Windows PE binary.')
    }

    console.log('▶ Packaging the Windows build (electron-builder)…')
    await run(bin('electron-builder'), ['--win', '--config', 'electron-builder.yml'])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
