// DB worker thread: owns its own SQLite connection (WAL) and runs the heavy
// read queries off the Electron main thread, so the UI never blocks.

import { parentPort, workerData } from 'node:worker_threads'
import { initStore } from './store.js'
import { runQuery, type QueryArgs, type QueryKind } from './queries.js'

interface Req {
  id: number
  kind: QueryKind
  args: QueryArgs
}

interface Res {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

const { dbDir } = workerData as { dbDir: string }
initStore(dbDir)

parentPort?.on('message', (req: Req) => {
  const res: Res = { id: req.id, ok: false }
  try {
    res.result = runQuery(req.kind, req.args ?? {})
    res.ok = true
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e)
  }
  parentPort?.postMessage(res)
})
