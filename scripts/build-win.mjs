import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')
).version
const bin = (name) => join(root, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name)

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

async function main() {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'])
  if (process.platform === 'linux') await run('wine', ['--version'])

  let targetRebuildStarted = false
  try {
    console.log('▶ Rebuilding better-sqlite3 for Windows (win32/x64)…')
    targetRebuildStarted = true
    await run(bin('electron-rebuild'), [
      '--force',
      '--which-module', 'better-sqlite3',
      '--version', electronVersion,
      '--platform', 'win32',
      '--arch', 'x64'
    ])

    if (process.platform === 'linux') {
      const nativePath = join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
      const description = execFileSync('file', [nativePath], { encoding: 'utf8' }).trim()
      console.log(description)
      if (!/PE32\+|MS Windows/i.test(description)) {
        throw new Error('Windows native dependency rebuild did not produce a Windows PE binary.')
      }
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
