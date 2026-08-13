import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
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

  // On WSL use the Linux npm (Node bundle step is pure JS and works cross-platform).
  await run(isWin ? 'npm.cmd' : 'npm', ['run', 'build'])

  let targetRebuildStarted = false
  try {
    console.log('▶ Rebuilding better-sqlite3 for Windows (win32/x64)…')
    targetRebuildStarted = true

    const rebuildArgs = [
      '--which-module', 'better-sqlite3',
      '--version', electronVersion,
      '--platform', 'win32',
      '--arch', 'x64'
    ]

    if (isWin) {
      // On Windows, force recompilation (guaranteed local build).
      rebuildArgs.push('--force')
    }
    // On WSL, omit --force so electron-rebuild fetches the prebuilt
    // win32 binary instead of attempting a cross-compile from source
    // (node-gyp does not support cross-compilation).

    await run(bin('electron-rebuild'), rebuildArgs)

    // Verify we got a Windows PE binary (catches silent cross-compile
    // failures or stale Linux binaries left in the build directory).
    const nativePath = join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
    const description = execFileSync('file', [nativePath], { encoding: 'utf8' }).trim()
    console.log(description)
    if (!/PE32\+|MS Windows/i.test(description)) {
      throw new Error(
        'Native dependency rebuild did not produce a Windows PE binary.\n' +
          'If cross-compiling from WSL, ensure better-sqlite3 publishes prebuilt binaries for your Electron version.'
      )
    }

    console.log('▶ Packaging the Windows build (electron-builder)…')
    await run(bin('electron-builder'), ['--win', '--config', 'electron-builder.yml'])
  } finally {
    if (targetRebuildStarted) {
      console.log(`▶ Restoring the native module for ${process.platform}/${process.arch}…`)
      await run(bin('electron-rebuild'), [
        '--force',
        '--which-module', 'better-sqlite3',
        '--version', electronVersion,
        '--platform', process.platform,
        '--arch', process.arch
      ])
      // The dev environment must be usable again: load the restored module.
      execFileSync(process.execPath, ['-e', "require('better-sqlite3')"], { cwd: root, stdio: 'pipe' })
      console.log('✓ Dev native module restored and loads correctly.')
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
