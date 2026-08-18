// DSH Editor — Host half (Node process).
//
// Standard Cordis plugin mounted via cordis.patch.yml (see package.json
// `dsh.bundle.patch`). Exposes the editor's private client→host JSON RPC on
// the `/editor` connection channel:
//
//   endpoint  payload                          result
//   fs.init   {}                               { root }
//   fs.stat-path { path }                      { path, exists, type? }
//   fs.project-root { path }                   { projectRoot }
//   fs.list   { path }                         { items }
//   fs.read   { path }                         { content }
//   fs.write  { path, content }                { ok }
//   fs.files  { root }                         { files }
//   git.status { root }                        { changes }
//   git.diff  { root, path }                   { diff }
//   fs.search-replace { edits }                { results }
//   fs.search-start  { query, root, ... }      { jobId }
//   fs.search-poll   { jobId }                 { matches, done, ... }
//   fs.search-cancel { jobId }                 { ok }
export const name = 'dsh-editor'

export const inject = ['connection']

const MAX_RESULTS = 20000

export function apply(ctx) {
  const fs = ctx.get('fs')
  const subprocess = ctx.get('subprocess')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const root = (sandboxPolicy && sandboxPolicy.workspaceRoot) ? sandboxPolicy.workspaceRoot : '/'

  const jobs = new Map()
  let jobSeq = 0

  function err(e) {
    return { error: String((e && e.message) ? e.message : e), code: (e && e.code) ? e.code : undefined }
  }

  function splitGlobs(s) {
    return String(s || '').split(',').map(function (x) { return x.trim() }).filter(Boolean)
  }

  function byteToCharIndex(str, byteOffset) {
    let bytes = 0
    for (let i = 0; i < str.length; i++) {
      if (bytes >= byteOffset) return i
      const code = str.charCodeAt(i)
      if (code <= 0x7f) bytes += 1
      else if (code <= 0x7ff) bytes += 2
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++ }
      else bytes += 3
    }
    return str.length
  }

  async function resolveGit() {
    if (!subprocess) return null
    const candidates = ['git', '/usr/bin/git']
    for (const c of candidates) {
      try { return await subprocess.resolveExecutable(c) } catch (e) {}
    }
    return null
  }

  async function statPath(args) {
    if (!fs) return { error: 'fs 服务不可用' }
    const p = String(args && args.path ? args.path : '')
    if (!p) return { exists: false }
    try {
      const target = await fs.resolve(p, { cwd: root })
      const info = await fs.stat(target)
      if (!info) return { path: p, exists: false }
      const type = info.type || info.kind || 'unknown'
      return { path: target.displayPath || p, exists: true, type: type }
    } catch (e) {
      return { path: p, exists: false, error: String((e && e.message) ? e.message : e) }
    }
  }

  async function projectRoot(args) {
    const path = String(args && args.path ? args.path : root)
    const dir = path.split('/').slice(0, -1).join('/') || '/'
    const gitPath = await resolveGit()
    if (gitPath) {
      try {
        const handle = subprocess.spawn({
          argv: [gitPath, '-C', dir, 'rev-parse', '--show-toplevel'],
          cwd: dir,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
          graceMs: 5000
        })
        const outcome = await handle.done
        const text = (handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : '') || ''
        const top = text.trim()
        if (outcome && outcome.exitCode === 0 && top) return { projectRoot: top }
      } catch (e) {}
    }
    return { projectRoot: dir }
  }

  async function listDir(args) {
    if (!fs) return { error: 'fs 服务不可用' }
    try {
      const target = await fs.resolve(args.path)
      const entries = await fs.listDir(target)
      const items = entries.map((e) => ({
        name: e.name,
        type: e.type,
        path: (e.target && e.target.displayPath) ? e.target.displayPath : (args.path === '/' ? '/' + e.name : args.path + '/' + e.name),
      }))
      items.sort((a, b) => (a.type === b.type ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.type === 'directory' ? -1 : 1))
      return { items }
    } catch (e) { return err(e) }
  }

  async function readFile(args) {
    if (!fs) return { error: 'fs 服务不可用' }
    try {
      const target = await fs.resolve(args.path)
      const content = await fs.readText(target)
      return { content }
    } catch (e) { return err(e) }
  }

  async function writeFile(args) {
    if (!fs) return { error: 'fs 服务不可用' }
    try {
      const target = await fs.resolve(args.path)
      await fs.writeText(target, args.content)
      return { ok: true }
    } catch (e) { return err(e) }
  }

  async function listFiles(args) {
    const base = String(args && args.root ? args.root : root)
    let rgPath = null
    if (subprocess) {
      const candidates = ['rg', '/usr/bin/rg']
      for (const c of candidates) {
        try { rgPath = await subprocess.resolveExecutable(c); break } catch (e) {}
      }
    }
    if (!rgPath) return { files: [] }
    const argv = [rgPath, '--files', '--no-config', '-g', '!**/node_modules/**', '-g', '!**/bower_components/**', base]
    try {
      const handle = subprocess.spawn({
        argv: argv,
        cwd: base,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 5000
      })
      const outcome = await handle.done
      const text = (handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : '') || ''
      if (outcome && outcome.exitCode === 2) return { files: [] }
      const files = text.split('\n').filter(Boolean).map(function (p) {
        return p.charAt(0) === '/' ? p : base.replace(/\/+$/, '') + '/' + p.replace(/^\.\//, '')
      })
      return { files }
    } catch (e) { return { files: [] } }
  }

  async function gitStatus(args) {
    const base = String(args && args.root ? args.root : root)
    const gitPath = await resolveGit()
    if (!gitPath) return { changes: [] }
    try {
      const handle = subprocess.spawn({
        argv: [gitPath, '-C', base, 'status', '--porcelain=v1', '--untracked-files=normal'],
        cwd: base,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 10000
      })
      const outcome = await handle.done
      if (outcome && outcome.exitCode !== 0) return { changes: [] }
      const text = (handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : '') || ''
      const changes = []
      for (const line of text.split('\n')) {
        if (!line) continue
        const status = line.slice(0, 2)
        let path = line.slice(3).replace(/^\s+|\s+$/g, '')
        if (status[0] === 'R') {
          const arrow = path.indexOf(' -> ')
          if (arrow !== -1) path = path.slice(arrow + 4)
        }
        path = path.charAt(0) === '/' ? path : base.replace(/\/+$/, '') + '/' + path
        changes.push({ path: path, status: status })
      }
      return { changes }
    } catch (e) { return { changes: [] } }
  }

  async function gitDiff(args) {
    const base = String(args && args.root ? args.root : root)
    const path = String(args && args.path ? args.path : '')
    const gitPath = await resolveGit()
    if (!gitPath) return { error: 'git 不可用' }
    if (!path) return { error: '缺少文件路径' }
    try {
      const rel = path.indexOf(base) === 0 ? path.slice(base.length).replace(/^\//, '') : path
      const handle = subprocess.spawn({
        argv: [gitPath, '-C', base, 'diff', '--no-color', '--', rel],
        cwd: base,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 8 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 15000
      })
      const outcome = await handle.done
      const text = (handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : '') || ''
      if (outcome && outcome.exitCode !== 0) {
        let stderrText = ''
        try { stderrText = (handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : '') || '' } catch (e) {}
        return { diff: text || '', error: stderrText.trim() || 'git diff 失败' }
      }
      return { diff: text }
    } catch (e) { return { error: String((e && e.message) ? e.message : e) } }
  }

  async function searchReplace(args) {
    if (!fs) return { error: 'fs 服务不可用' }
    const edits = (args && args.edits) || []
    const byPath = new Map()
    for (const e of edits) {
      if (!e || !e.path) continue
      if (!byPath.has(e.path)) byPath.set(e.path, [])
      byPath.get(e.path).push(e)
    }
    const results = []
    for (const entry of byPath) {
      const path = entry[0]
      const list = entry[1]
      try {
        const target = await fs.resolve(path)
        const content = await fs.readText(target)
        const lines = content.split('\n')
        list.sort(function (a, b) { return (b.line - a.line) || ((b.col || 1) - (a.col || 1)) })
        let replaced = 0
        for (const e of list) {
          const li = (e.line || 1) - 1
          if (li < 0 || li >= lines.length) continue
          const col = (e.col || 1) - 1
          const len = e.len || 0
          const line = lines[li]
          lines[li] = line.slice(0, col) + String(e.newText || '') + line.slice(col + len)
          replaced++
        }
        await fs.writeText(target, lines.join('\n'))
        results.push({ path: path, replaced: replaced })
      } catch (e) {
        results.push({ path: path, error: String((e && e.message) ? e.message : e) })
      }
    }
    return { results }
  }

  async function jsSearch(query, base) {
    if (!fs) return { error: 'fs 服务不可用' }
    const q = query.toLowerCase()
    const matches = []
    const visited = new Set()
    let truncated = false
    const MAX_FILES = 3000
    const MAX_SIZE = 1024 * 1024
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.cache', '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.DS_Store'])
    async function walk(dirPath) {
      if (truncated) return
      let t, entries
      try {
        t = await fs.resolve(dirPath)
        if (visited.has(t.targetKey)) return
        visited.add(t.targetKey)
        entries = await fs.listDir(t)
      } catch (e) { return }
      for (const e of entries) {
        if (truncated) return
        if (e.type === 'directory') {
          if (SKIP.has(e.name)) continue
          await walk(e.target.displayPath)
        } else if (e.type === 'file') {
          if (e.size !== undefined && e.size > MAX_SIZE) continue
          try {
            const ft = await fs.resolve(e.target.displayPath)
            const content = await fs.readText(ft)
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              const idx = lines[i].toLowerCase().indexOf(q)
              if (idx !== -1) {
                const txt = lines[i].length > 400 ? lines[i].slice(0, 400) : lines[i]
                const hiS = idx < txt.length ? idx : -1
                const hiE = (idx + q.length) <= txt.length ? idx + q.length : -1
                matches.push({ path: e.target.displayPath, name: e.name, line: i + 1, col: idx + 1, len: q.length, text: txt, hiStart: hiS, hiEnd: hiE })
                if (matches.length >= MAX_RESULTS) { truncated = true; return }
              }
            }
          } catch (e2) {}
        }
      }
    }
    try { await walk(base) } catch (e) { return err(e) }
    return { matches, truncated }
  }

  function parseMatchLine(job, line, out) {
    if (!line) return
    if (job.matchCount >= MAX_RESULTS) {
      if (!job.truncated) { job.truncated = true; if (job.handle) { try { job.handle.terminate() } catch (e) {} } }
      return
    }
    let rec
    try { rec = JSON.parse(line) } catch (e) { return }
    if (!rec || rec.type !== 'match') return
    const data = rec.data || {}
    const p = data.path && data.path.text ? String(data.path.text) : ''
    if (!p) return
    const abs = p.charAt(0) === '/' ? p : job.base.replace(/\/+$/, '') + '/' + p.replace(/^\.\//, '')
    const full = data.lines && data.lines.text ? String(data.lines.text).replace(/\r?\n$/, '') : ''
    let col = 1, len = 0, cs = 0, ce = 0
    if (Array.isArray(data.submatches) && data.submatches.length) {
      const sm = data.submatches[0]
      const bs = (typeof sm.start === 'number') ? sm.start : 0
      const be = (typeof sm.end === 'number') ? sm.end : bs
      cs = byteToCharIndex(full, bs)
      ce = byteToCharIndex(full, be)
      col = cs + 1
      len = ce - cs
    }
    let start = 0, end = full.length
    if (full.length > 300) {
      start = Math.max(0, cs - 40)
      end = Math.min(full.length, start + 300)
      if (end - start < 300) start = Math.max(0, end - 300)
    }
    const snippet = full.slice(start, end)
    const hiStart = Math.max(0, cs - start)
    const hiEnd = Math.max(hiStart, Math.min(snippet.length, ce - start))
    out.push({
      path: abs,
      name: abs.split('/').pop(),
      line: typeof data.line_number === 'number' ? data.line_number : 0,
      col: col,
      len: len,
      text: snippet,
      hiStart: hiStart,
      hiEnd: hiEnd
    })
    job.matchCount++
    if (job.matchCount >= MAX_RESULTS) { job.truncated = true; if (job.handle) { try { job.handle.terminate() } catch (e) {} } }
  }

  async function searchStart(args) {
    const query = String(args && args.query ? args.query : '').trim()
    if (!query) return { error: '查询为空' }
    const base = String(args && args.root ? args.root : root)
    const caseSensitive = !!(args && args.caseSensitive)
    const wholeWord = !!(args && args.wholeWord)
    const useRegex = !!(args && args.useRegex)
    const inc = splitGlobs(args && args.include)
    const exc = splitGlobs(args && args.exclude)

    const jobId = 'j' + (++jobSeq)
    const job = { base: base, buffered: '', nextOffset: 0, exited: false, exitCode: null, matchCount: 0, truncated: false, stdoutFlushed: false, error: null, handle: null, preBaked: null }
    jobs.set(jobId, job)

    let rgPath = null
    if (subprocess) {
      const candidates = ['rg', '/usr/bin/rg']
      for (const c of candidates) {
        try { rgPath = await subprocess.resolveExecutable(c); break } catch (e) {}
      }
    }

    if (!rgPath) {
      try {
        const res = await jsSearch(query, base)
        job.preBaked = (res && res.matches) || []
        job.truncated = !!(res && res.truncated)
        job.error = (res && res.error) || null
      } catch (e) {
        job.error = String((e && e.message) ? e.message : e)
      }
      job.exited = true
      job.stdoutFlushed = true
      return { jobId }
    }

    const argv = [
      rgPath, '--json', '--no-config', '--no-heading',
      '--max-filesize=50M', '--max-columns=500',
      '-g', '!**/node_modules/**', '-g', '!**/bower_components/**',
      '-g', '!**/target/**', '-g', '!**/dist/**', '-g', '!**/build/**',
      '-g', '!**/out/**', '-g', '!**/__pycache__/**'
    ]
    for (const p of exc) argv.push('-g', '!' + p)
    for (const p of inc) {
      argv.push('-g', p)
      if (!/[*?[\\]]/.test(p)) {
        const clean = p.replace(/\/+$/, '')
        if (clean) {
          argv.push('-g', (clean.indexOf('/') === -1 ? '**/' + clean : clean) + '/**')
        }
      }
    }
    if (caseSensitive) argv.push('--case-sensitive')
    else argv.push('--ignore-case')
    if (wholeWord) argv.push('--word-regexp')
    if (!useRegex) argv.push('--fixed-strings')
    argv.push('-e', query, base)

    try {
      const handle = subprocess.spawn({
        argv: argv,
        cwd: base,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 64 * 1024 * 1024 },
          stderr: { maxBytes: 64 * 1024 }
        },
        graceMs: 5000
      })
      job.handle = handle
      handle.done.then(function (outcome) {
        job.exited = true
        job.exitCode = outcome ? outcome.exitCode : null
      }).catch(function () {
        job.exited = true
        job.exitCode = 2
      })
    } catch (e) {
      job.exited = true
      job.exitCode = 2
      job.error = String((e && e.message) ? e.message : e)
    }
    return { jobId }
  }

  function searchPoll(args) {
    const jobId = args && args.jobId
    const job = jobs.get(jobId)
    if (!job) return { matches: [], done: true, total: 0 }
    const newMatches = []

    if (job.preBaked) {
      for (const m of job.preBaked) newMatches.push(m)
      job.preBaked = null
      const result = { matches: newMatches, done: true, truncated: job.truncated, error: job.error, total: newMatches.length }
      jobs.delete(jobId)
      return result
    }

    if (!job.stdoutFlushed && job.handle) {
      try {
        const read = job.handle.collected.stdout.readFrom(job.nextOffset)
        job.nextOffset = read.nextOffset
        if (read.lossy) job.truncated = true
        const delta = read.text || ''
        if (delta) {
          job.buffered += delta
          const lines = job.buffered.split('\n')
          job.buffered = lines.pop()
          for (const line of lines) parseMatchLine(job, line, newMatches)
        }
      } catch (e) {}
    }

    if (job.exited && !job.stdoutFlushed) {
      job.stdoutFlushed = true
      if (job.buffered) { parseMatchLine(job, job.buffered, newMatches); job.buffered = '' }
      if (job.exitCode === 2 && !job.error) {
        let stderrText = ''
        try { if (job.handle && job.handle.collected.stderr) stderrText = job.handle.collected.stderr.readFrom(0).text || '' } catch (e) {}
        job.error = stderrText.trim() || 'ripgrep 执行失败（正则可能无效）'
      }
    }

    const done = job.exited && job.stdoutFlushed
    const result = { matches: newMatches, done: done, truncated: job.truncated, error: job.error, total: job.matchCount }
    if (done) jobs.delete(jobId)
    return result
  }

  function searchCancel(args) {
    const job = jobs.get(args && args.jobId)
    if (job) {
      if (job.handle) { try { job.handle.terminate() } catch (e) {} }
      jobs.delete(args.jobId)
    }
    return { ok: true }
  }

  // Single dispatch table for the `/editor` channel.
  const handlers = {
    'fs.init': async () => ({ root }),
    'fs.stat-path': statPath,
    'fs.project-root': projectRoot,
    'fs.list': listDir,
    'fs.read': readFile,
    'fs.write': writeFile,
    'fs.files': listFiles,
    'git.status': gitStatus,
    'git.diff': gitDiff,
    'fs.search-replace': searchReplace,
    'fs.search-start': searchStart,
    'fs.search-poll': searchPoll,
    'fs.search-cancel': searchCancel,
  }

  ctx.connection.rpc.handle('/editor', async (endpoint, payload, signal) => {
    const handler = handlers[endpoint]
    if (!handler) throw new Error(`dsh-editor: unknown endpoint ${JSON.stringify(endpoint)}`)
    return await handler(payload || {})
  }, { authority: 'loopback' })
}
