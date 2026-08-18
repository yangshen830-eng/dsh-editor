// DSH Code Editor — Client half (browser).
//
// Loaded as a `dsh.client` module (see package.json `exports["./client"]` and
// `dsh.client.inject`). Registers `conversation.view` and `settings.section`
// slots and talks to the host half through the `/editor` connection channel.
window.__ModuleLoader__.load({
  id: "dsh-code-editor",
  factory: (require) => {
    const React = require("react")

const MONACO_VERSION = '0.52.2'
const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min'
let monacoPromise = null

function loadMonaco() {
  if (typeof window !== 'undefined' && window.monaco) return Promise.resolve(window.monaco)
  if (monacoPromise) return monacoPromise
  monacoPromise = new Promise(function (resolve, reject) {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      reject(new Error('客户端无法访问 document/window,Monaco 无法加载'))
      return
    }
    window.MonacoEnvironment = {
      getWorkerUrl: function (workerId, label) {
        var code = "self.MonacoEnvironment={baseUrl:'" + MONACO_BASE + "/'};" +
          "importScripts('" + MONACO_BASE + "/vs/base/worker/workerMain.js');"
        return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code)
      }
    }
    var script = document.createElement('script')
    script.src = MONACO_BASE + '/vs/loader.js'
    script.onload = function () {
      try {
        window.require.config({ paths: { vs: MONACO_BASE + '/vs' } })
        window.require(['vs/editor/editor.main'], function () {
          resolve(window.monaco)
        }, function (err) { reject(new Error('Monaco AMD 加载失败: ' + String(err))) })
      } catch (e) { reject(e) }
    }
    script.onerror = function () {
      reject(new Error('Monaco loader 脚本加载失败(网络或 CSP 拦截): ' + script.src))
    }
    document.head.appendChild(script)
  })
  return monacoPromise
}

function detectLang(name) {
  if (!name) return 'plaintext'
  if (name === 'Dockerfile') return 'dockerfile'
  if (name === 'Makefile') return 'makefile'
  var ext = name.split('.').pop().toLowerCase()
  var map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json', jsonc: 'json', md: 'markdown',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml',
    xml: 'xml', sql: 'sql', php: 'php', swift: 'swift', kt: 'kotlin',
    scala: 'scala', lua: 'lua', r: 'r', pl: 'perl', toml: 'ini', ini: 'ini'
  }
  return map[ext] || 'plaintext'
}

function isMarkdown(name) {
  if (!name) return false
  var lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdown') || lower.endsWith('.mkd')
}

function loadScriptGlobal(url) {
  return new Promise(function (resolve, reject) {
    var hadDefine = (typeof window !== 'undefined') && typeof window.define === 'function'
    var savedAmd = hadDefine ? window.define.amd : undefined
    if (hadDefine && window.define.amd) {
      try { window.define.amd = undefined } catch (e) {}
    }
    var restore = function () {
      if (hadDefine) { try { window.define.amd = savedAmd } catch (e) {} }
    }
    var s = document.createElement('script')
    s.src = url
    s.onload = function () { restore(); resolve() }
    s.onerror = function () { restore(); reject(new Error('脚本加载失败: ' + url)) }
    document.head.appendChild(s)
  })
}

function loadStylesheet(url) {
  return new Promise(function (resolve) {
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = function () { resolve(link) }
    link.onerror = function () { resolve(link) }
    document.head.appendChild(link)
  })
}

const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'
const DOMPURIFY_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js'
const HLJS_URL = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js'
const HLJS_LIGHT_CSS = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github.min.css'
const HLJS_DARK_CSS = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css'
const KATEX_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'
const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'
let currentColorScheme = 'light'
let hljsLightLink = null
let hljsDarkLink = null
let mdLib = null
let mdLibPromise = null

function setHljsTheme(cs) {
  var dark = cs === 'dark'
  if (hljsDarkLink) hljsDarkLink.disabled = !dark
  if (hljsLightLink) hljsLightLink.disabled = dark
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function katexBlockExt(katex) {
  return {
    name: 'blockKatex',
    level: 'block',
    start(src) { return src.indexOf('$$') },
    tokenizer(src, tokens) {
      const match = /^\$\$([\s\S]+?)\$\$/.exec(src)
      if (match) {
        return { type: 'blockKatex', raw: match[0], text: match[1].trim() }
      }
    },
    renderer(token) {
      try {
        return '<div class="dsh-editor-katex-block">' + katex.renderToString(token.text, { throwOnError: false, displayMode: true }) + '</div>'
      } catch (e) {
        return '<pre><code>' + escapeHtml(token.text) + '</code></pre>'
      }
    }
  }
}

function katexInlineExt(katex) {
  return {
    name: 'inlineKatex',
    level: 'inline',
    start(src) { return src.indexOf('$') },
    tokenizer(src, tokens) {
      const match = /^\$([^$\n]+?)\$/.exec(src)
      if (match) {
        return { type: 'inlineKatex', raw: match[0], text: match[1].trim() }
      }
    },
    renderer(token) {
      try {
        return katex.renderToString(token.text, { throwOnError: false })
      } catch (e) {
        return escapeHtml(token.text)
      }
    }
  }
}

function loadMarkdownLib() {
  if (mdLib) return Promise.resolve(mdLib)
  if (mdLibPromise) return mdLibPromise
  mdLibPromise = Promise.all([
    (typeof window !== 'undefined' && window.marked) ? Promise.resolve() : loadScriptGlobal(MARKED_URL),
    (typeof window !== 'undefined' && window.DOMPurify) ? Promise.resolve() : loadScriptGlobal(DOMPURIFY_URL),
    (typeof window !== 'undefined' && window.mermaid) ? Promise.resolve() : loadScriptGlobal(MERMAID_URL),
    (typeof window !== 'undefined' && window.hljs) ? Promise.resolve() : loadScriptGlobal(HLJS_URL),
    (typeof window !== 'undefined' && window.katex) ? Promise.resolve() : loadScriptGlobal(KATEX_URL),
    hljsLightLink ? Promise.resolve(hljsLightLink) : loadStylesheet(HLJS_LIGHT_CSS).then(function (l) { hljsLightLink = l; return l }),
    hljsDarkLink ? Promise.resolve(hljsDarkLink) : loadStylesheet(HLJS_DARK_CSS).then(function (l) { hljsDarkLink = l; return l }),
    loadStylesheet(KATEX_CSS)
  ]).then(function () {
    var m = window.marked
    var parse = null
    if (m && typeof m.parse === 'function') parse = function (md, o) { return m.parse(md, o) }
    else if (m && m.marked && typeof m.marked.parse === 'function') parse = function (md, o) { return m.marked.parse(md, o) }
    mdLib = {
      parse: parse,
      purify: window.DOMPurify || null,
      mermaid: window.mermaid || null,
      hljs: window.hljs || null,
      katex: window.katex || null,
      setHljsTheme: setHljsTheme
    }
    if (mdLib.parse && mdLib.katex) {
      try {
        var use = (m && typeof m.use === 'function') ? m.use.bind(m) : ((m && m.marked && typeof m.marked.use === 'function') ? m.marked.use.bind(m.marked) : null)
        if (use) use({ extensions: [katexBlockExt(mdLib.katex), katexInlineExt(mdLib.katex)] })
      } catch (e) {}
    }
    if (mdLib.mermaid) {
      try { mdLib.mermaid.initialize({ startOnLoad: false, theme: currentColorScheme === 'dark' ? 'dark' : 'default' }) } catch (e) {}
    }
    setHljsTheme(currentColorScheme)
    return mdLib
  })
  return mdLibPromise
}

function highlightBlocks(container, hljs) {
  if (!hljs) return
  try {
    var codes = container.querySelectorAll('pre code')
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i]
      if (code.classList && code.classList.contains('language-mermaid')) continue
      try { hljs.highlightElement(code) } catch (e) {}
    }
  } catch (e) {}
}

function renderMermaidBlocks(container, mermaid) {
  return new Promise(function (resolve) {
    if (!mermaid || !container.querySelectorAll) { resolve(); return }
    var blocks = container.querySelectorAll('code.language-mermaid')
    if (!blocks.length) { resolve(); return }
    var pending = blocks.length
    var seq = 0
    function finishOne() {
      pending--
      if (pending <= 0) resolve()
    }
    blocks.forEach(function (code) {
      var text = code.textContent || ''
      var pre = code.closest ? code.closest('pre') : code.parentElement
      var id = 'dsh-md-mermaid-' + Date.now() + '-' + (++seq)
      try {
        mermaid.render(id, text).then(function (res) {
          try {
            var wrap = document.createElement('div')
            wrap.className = 'dsh-editor-mermaid'
            wrap.innerHTML = (res && res.svg) ? res.svg : ''
            if (pre && pre.parentNode) pre.parentNode.replaceChild(wrap, pre)
          } catch (e) {}
          finishOne()
        }).catch(function (e) {
          try {
            if (pre) {
              var err = document.createElement('div')
              err.className = 'dsh-editor-mermaid-error'
              err.textContent = '⚠ Mermaid 渲染失败: ' + ((e && e.message) ? e.message : String(e))
              if (pre.parentNode) pre.parentNode.insertBefore(err, pre.nextSibling)
            }
          } catch (e2) {}
          finishOne()
        })
      } catch (e) {
        finishOne()
      }
    })
  })
}

function renderMarkdownFull(md) {
  return loadMarkdownLib().then(function (lib) {
    var html = ''
    try {
      html = lib.parse ? lib.parse(md, { breaks: true, gfm: true }) : ('<pre>' + escapeHtml(md) + '</pre>')
    } catch (e) {
      html = '<pre>' + escapeHtml(md) + '</pre>'
    }
    if (lib.purify) {
      try {
        var p = lib.purify
        html = (typeof p.sanitize === 'function') ? p.sanitize(html) : (typeof p === 'function' ? p(html) : html)
      } catch (e) {}
    }
    var container = document.createElement('div')
    container.innerHTML = html
    highlightBlocks(container, lib.hljs)
    try {
      var boxes = container.querySelectorAll('li input[type="checkbox"]')
      for (var bi = 0; bi < boxes.length; bi++) {
        boxes[bi].removeAttribute('disabled')
      }
    } catch (e) {}
    return renderMermaidBlocks(container, lib.mermaid).then(function () {
      return container.innerHTML
    })
  })
}

function parseKeyCombo(str) {
  var s = String(str || '').trim()
  var combo = { ctrl: false, meta: false, alt: false, shift: false, key: '' }
  if (!s) return combo
  var parts = s.split('+').map(function (p) { return p.trim() })
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].toLowerCase()
    if (p === 'ctrl' || p === 'control') combo.ctrl = true
    else if (p === 'cmd' || p === 'meta' || p === 'command' || p === 'win') combo.meta = true
    else if (p === 'alt' || p === 'option') combo.alt = true
    else if (p === 'shift') combo.shift = true
    else combo.key = parts[i]
  }
  return combo
}

function matchesCombo(e, combo) {
  if (!combo || !combo.key) return false
  var k = String(e.key || '').toLowerCase()
  var t = String(combo.key).toLowerCase()
  var special = { 'esc': 'escape', 'del': 'delete', 'return': 'enter' }
  if (special[t]) t = special[t]
  if (k !== t) return false
  return e.ctrlKey === !!combo.ctrl && e.metaKey === !!combo.meta && e.altKey === !!combo.alt && e.shiftKey === !!combo.shift
}

const CSS = `
.dsh-editor-panel { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); overflow: hidden; box-sizing: border-box; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); position: relative; }
.dsh-editor-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l2); flex: none; position: relative; }
.dsh-editor-title { font-weight: 600; font-size: 13px; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.dsh-editor-path { flex: 1; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.dsh-editor-btn { background: var(--dsw-alias-button-info-fill); color: #fff; border: none; border-radius: 5px; padding: 4px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dsh-editor-btn:disabled { opacity: .5; cursor: not-allowed; }
.dsh-editor-btn.ghost { background: transparent; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-btn.ghost:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-editor-body { display: flex; flex: 1; min-height: 0; }
.dsh-editor-side { flex: none; display: flex; flex-direction: column; min-height: 0; background: var(--dsw-alias-bg-layer-1); border-right: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-resizer { width: 4px; flex: none; cursor: col-resize; background: transparent; }
.dsh-editor-resizer:hover { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-lefttabs { display: flex; flex: none; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-lefttab { flex: 1; padding: 7px 4px; background: transparent; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; }
.dsh-editor-lefttab.active { color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); border-bottom-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-files { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 0; }
.dsh-editor-file { display: flex; align-items: center; gap: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; color: var(--dsw-alias-label-primary); }
.dsh-editor-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-editor-file.dir { color: var(--dsw-alias-label-secondary); }
.dsh-editor-file.active { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dsh-editor-caret { display: inline-block; width: 12px; flex: none; text-align: center; }
.dsh-editor-git { margin-left: auto; flex: none; font-size: 10px; padding: 0 4px; border-radius: 3px; cursor: pointer; color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); font-family: ui-monospace, monospace; }
.dsh-editor-git.untracked { color: var(--dsw-alias-label-secondary); }
.dsh-editor-search { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dsh-editor-searchbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); flex: none; }
.dsh-editor-search-input { flex: 1; min-width: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; padding: 4px 8px; font-size: 12px; outline: none; }
.dsh-editor-replace-row { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); flex: none; }
.dsh-editor-toggles { display: flex; gap: 4px; padding: 6px 8px; flex: none; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-toggle { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); border-radius: 4px; padding: 2px 7px; font-size: 11px; cursor: pointer; min-width: 24px; font-family: ui-monospace, monospace; }
.dsh-editor-toggle.active { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); color: #fff; border-color: transparent; }
.dsh-editor-filter { padding: 5px 8px 0; flex: none; }
.dsh-editor-filter-label { display: block; font-size: 10px; color: var(--dsw-alias-label-secondary); margin-bottom: 2px; }
.dsh-editor-filter .dsh-editor-search-input { width: 100%; box-sizing: border-box; }
.dsh-editor-scope { display: flex; gap: 4px; padding: 6px 8px; flex: none; }
.dsh-editor-scope-btn { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); border-radius: 12px; padding: 2px 9px; font-size: 11px; cursor: pointer; }
.dsh-editor-scope-btn.active { background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.dsh-editor-results { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
.dsh-editor-result-name { padding: 4px 10px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-result-line { display: flex; gap: 8px; padding: 2px 10px 2px 16px; font-size: 11px; cursor: pointer; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.dsh-editor-result-line:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-editor-result-lineno { flex: none; width: 34px; text-align: right; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary)); font-variant-numeric: tabular-nums; }
.dsh-editor-result-text { flex: 1; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
.dsh-editor-hit { background: #ffd54f; color: #1a1a1a; border-radius: 2px; padding: 0 1px; }
.dsh-editor-search-meta { flex: none; padding: 4px 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.dsh-editor-tabs { display: flex; flex: none; overflow-x: auto; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-tab { display: flex; align-items: center; gap: 5px; padding: 6px 10px; font-size: 12px; cursor: pointer; border-right: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.dsh-editor-tab.active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dsh-editor-tab-dot { color: #f5a623; font-size: 9px; flex: none; }
.dsh-editor-tab-name { overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.dsh-editor-tab-close { margin-left: 4px; padding: 0 3px; border-radius: 3px; flex: none; }
.dsh-editor-tab-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-editor-host { flex: 1; min-height: 0; }
.dsh-editor-md-area { flex: 1; min-height: 0; display: flex; }
.dsh-editor-md-area .dsh-editor-host { min-width: 0; }
.dsh-editor-md-resizer { width: 4px; flex: none; cursor: col-resize; background: transparent; }
.dsh-editor-md-resizer:hover { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-md-preview { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 22px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.65; word-wrap: break-word; }
.dsh-editor-md-preview h1, .dsh-editor-md-preview h2, .dsh-editor-md-preview h3, .dsh-editor-md-preview h4, .dsh-editor-md-preview h5, .dsh-editor-md-preview h6 { margin: 18px 0 8px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-editor-md-preview h1 { font-size: 26px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 8px; }
.dsh-editor-md-preview h2 { font-size: 22px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 6px; }
.dsh-editor-md-preview h3 { font-size: 18px; }
.dsh-editor-md-preview h4 { font-size: 16px; }
.dsh-editor-md-preview p { margin: 8px 0; }
.dsh-editor-md-preview a { color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-md-preview code { background: var(--dsw-alias-interactive-bg-hover); padding: 2px 5px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.dsh-editor-md-preview pre { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
.dsh-editor-md-preview pre code { background: transparent; padding: 0; }
.dsh-editor-md-preview blockquote { border-left: 3px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); margin: 10px 0; padding: 4px 14px; color: var(--dsw-alias-label-secondary); }
.dsh-editor-md-preview ul, .dsh-editor-md-preview ol { padding-left: 26px; margin: 8px 0; }
.dsh-editor-md-preview li { margin: 4px 0; }
.dsh-editor-md-preview li input[type="checkbox"] { margin-right: 6px; cursor: pointer; }
.dsh-editor-md-preview table { border-collapse: collapse; margin: 12px 0; display: block; max-width: 100%; overflow-x: auto; }
.dsh-editor-md-preview th, .dsh-editor-md-preview td { border: 1px solid var(--dsw-alias-border-l2); padding: 6px 12px; }
.dsh-editor-md-preview th { background: var(--dsw-alias-bg-layer-1); font-weight: 600; }
.dsh-editor-md-preview img { max-width: 100%; border-radius: 6px; }
.dsh-editor-md-preview hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2); margin: 16px 0; }
.dsh-editor-md-preview > *:first-child { margin-top: 0; }
.dsh-editor-md-preview > *:last-child { margin-bottom: 0; }
.dsh-editor-mermaid { display: flex; justify-content: center; margin: 14px 0; overflow-x: auto; }
.dsh-editor-mermaid svg { max-width: 100%; }
.dsh-editor-mermaid-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 6px 0 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 4px; }
.dsh-editor-katex-block { overflow-x: auto; margin: 12px 0; text-align: center; }
.dsh-editor-md-preview .katex { font-size: 1.1em; }
.dsh-editor-status { flex: none; display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); color: #fff; font-size: 11px; }
.dsh-editor-status.error { background: var(--dsw-alias-state-error-primary); }
.dsh-editor-status.ready { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-empty { padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-editor-settings { position: absolute; top: 100%; right: 8px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 8px; z-index: 20; display: flex; flex-direction: column; gap: 6px; min-width: 210px; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
.dsh-editor-setting-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-editor-setting-row label { flex: 1; }
.dsh-editor-setting-row input[type=number] { width: 56px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; padding: 2px 6px; }
.dsh-editor-setting-row input[type=text] { flex: 1; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
.dsh-editor-setting-select { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
.dsh-editor-setting-toggle { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.dsh-editor-setting-toggle.on { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); color: #fff; border-color: transparent; }
.dsh-editor-settings-page { display: flex; flex-direction: column; gap: 12px; padding: 12px 4px; max-width: 560px; }
.dsh-editor-settings-page-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 2px; }
.dsh-editor-settings-page .dsh-editor-setting-row { gap: 12px; }
.dsh-editor-setting-hint { font-size: 11px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary)); }
.dsh-editor-quick-mask { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 30; display: flex; align-items: flex-start; justify-content: center; padding-top: 80px; }
.dsh-editor-quick { width: 520px; max-width: 90%; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.3); overflow: hidden; }
.dsh-editor-quick .dsh-editor-search-input { width: 100%; box-sizing: border-box; border: none; border-bottom: 1px solid var(--dsw-alias-border-l2); border-radius: 0; padding: 10px 12px; }
.dsh-editor-quick-list { max-height: 320px; overflow-y: auto; }
.dsh-editor-quick-item { padding: 6px 12px; font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.dsh-editor-quick-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-editor-diff-panel { width: 760px; max-width: 92%; max-height: 80%; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.3); display: flex; flex-direction: column; overflow: hidden; }
.dsh-editor-diff-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-editor-diff-title { flex: 1; font-size: 12px; font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-editor-diff-body { flex: 1; overflow: auto; padding: 8px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dsh-editor-diff-line { padding: 0 12px; white-space: pre; }
.dsh-editor-diff-line.add { background: rgba(46,160,67,0.16); color: #2ea043; }
.dsh-editor-diff-line.del { background: rgba(248,81,73,0.16); color: #f85149; }
.dsh-editor-diff-line.hunk { color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-diff-line.meta { color: var(--dsw-alias-label-secondary); }
[data-conversation-scroll] > [data-slot="conversation.session"] > div:has(.dsh-editor-panel) { flex: 1 1 0 !important; min-height: 0 !important; overflow: hidden !important; }
[data-conversation-scroll]:has(.dsh-editor-panel) > [data-composer-seat] { display: none !important; }
[data-dsh-editor-settings-nav] > svg:first-child { display: none; }
[data-dsh-editor-settings-nav]::before { content: ''; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='16 18 22 12 16 6'/%3E%3Cpolyline points='8 6 2 12 8 18'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='16 18 22 12 16 6'/%3E%3Cpolyline points='8 6 2 12 8 18'/%3E%3C/svg%3E") center / contain no-repeat; }
.dsh-editor-path-link { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; text-decoration-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.dsh-editor-path-link:hover { background: var(--dsw-alias-interactive-bg-hover); border-radius: 3px; }
`

function apply(ctx) {
  const slots = ctx.slots
  if (slots === undefined) return
  const timer = ctx.timer
  const connection = ctx.connection
  const rpc = function (endpoint, payload) {
    return connection.rpc.call('/editor', endpoint, payload)
  }

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-dsh-code-editor', '')
    tag.textContent = CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'dsh-code-editor: styles')

  const theme = ctx.get('theme')
  const live = { monaco: null, editor: null }
  let mdRefreshFn = null

  if (theme !== undefined) {
    try {
      const initSnap = theme.getTheme()
      if (initSnap && initSnap.active && initSnap.active.colorScheme) currentColorScheme = initSnap.active.colorScheme
    } catch (e) {}
  }

  function applyMonacoTheme(snap) {
    const cs = snap && snap.active && snap.active.colorScheme
    currentColorScheme = cs === 'dark' ? 'dark' : 'light'
    if (live.monaco && live.editor) live.monaco.editor.setTheme(cs === 'dark' ? 'vs-dark' : 'vs')
    setHljsTheme(cs)
    if (mdLib && mdLib.mermaid) {
      try { mdLib.mermaid.initialize({ startOnLoad: false, theme: cs === 'dark' ? 'dark' : 'default' }) } catch (e) {}
      if (mdRefreshFn) mdRefreshFn()
    }
  }
  if (theme !== undefined) ctx.on('theme/change', applyMonacoTheme)

  let editorSettings = { fontSize: 13, tabSize: 4, wordWrap: false, minimap: true, lineNumbers: true, fontFamily: '', quickOpenKey: 'Ctrl+P', saveKey: 'Ctrl+S', searchKey: 'Ctrl+Shift+F' }
  const settingsSubs = new Set()

  function applyOptionsToEditor(editor, s) {
    if (!editor) return
    const opts = {
      fontSize: s.fontSize,
      wordWrap: s.wordWrap ? 'on' : 'off',
      minimap: { enabled: s.minimap },
      tabSize: s.tabSize,
      lineNumbers: s.lineNumbers ? 'on' : 'off'
    }
    if (s.fontFamily) opts.fontFamily = s.fontFamily
    editor.updateOptions(opts)
  }

  function updateEditorSettings(next) {
    editorSettings = next
    applyOptionsToEditor(live.editor, next)
    settingsSubs.forEach(function (l) { try { l(next) } catch (e) {} })
  }

  function useEditorSettings() {
    const [s, setS] = React.useState(editorSettings)
    React.useEffect(function () {
      function l(v) { setS(v) }
      settingsSubs.add(l)
      return function () { settingsSubs.delete(l) }
    }, [])
    function set(next) { updateEditorSettings(next) }
    return [s, set]
  }

  function NumberField(props) {
    const [text, setText] = React.useState(String(props.value))
    const editingRef = React.useRef(false)

    React.useEffect(function () {
      if (!editingRef.current) setText(String(props.value))
    }, [props.value])

    function clampValue(raw) {
      let n = parseInt(raw, 10)
      if (isNaN(n)) return null
      if (props.min !== undefined && n < props.min) n = props.min
      if (props.max !== undefined && n > props.max) n = props.max
      return n
    }

    function onChange(e) {
      const raw = e.target.value
      setText(raw)
      const n = clampValue(raw)
      if (n !== null && props.onCommit) props.onCommit(n)
    }

    function onBlur() {
      editingRef.current = false
      const n = clampValue(text)
      if (n !== null) {
        if (props.onCommit) props.onCommit(n)
        setText(String(n))
      } else {
        setText(String(props.value))
      }
    }

    return React.createElement('input', {
      type: 'number',
      min: props.min,
      max: props.max,
      step: props.step,
      value: text,
      onFocus: function () { editingRef.current = true },
      onChange: onChange,
      onBlur: onBlur,
      onKeyDown: function (e) { if (e.key === 'Enter') e.currentTarget.blur() }
    })
  }

  const viewState = {
    cwd: '',
    root: '',
    openFiles: [],
    activePath: '',
    searchMode: false,
    searchQuery: '',
    searchResults: [],
    searchScope: 'cwd',
    searchTruncated: false,
    searchFiles: 0,
    include: '',
    exclude: '',
    caseSensitive: false,
    wholeWord: true,
    useRegex: false,
    replaceMode: false,
    replaceText: '',
    searchHistory: [],
    sidebarWidth: 300,
    sidebarCollapsed: false,
    mdViewMode: 'source'
  }

  function usePersisted(key) {
    const pair = React.useState(viewState[key])
    const value = pair[0]
    const setValue = pair[1]
    function set(v) { viewState[key] = v; setValue(v) }
    return [value, set]
  }

  // ---- Ctrl+点击对话路径跳转系统 ----
  const PATH_LINK_CLASS = 'dsh-editor-path-link'
  let editorOpenPathRef = null
  let pendingPath = null

  const KNOWN_NO_EXT = /^(Makefile|Dockerfile|CMakeLists\.txt|README|LICENSE|LICENCE|AGENTS|Gemfile|Rakefile|Procfile|Vagrantfile|Jenkinsfile|\.gitignore|\.gitconfig|\.gitattributes|\.bashrc|\.bash_profile|\.zshrc|\.npmrc|\.editorconfig|\.env|\.p10k\.zsh)$/i

  function looksLikePath(text) {
    if (!text) return false
    const t = String(text).trim()
    if (!t || t.length > 400) return false
    if (/\s/.test(t)) return false
    if (/^https?:\/\//i.test(t)) return false
    if (t.indexOf('/') === -1) return false
    if (/[<>|&;`$*?"']/.test(t)) return false
    if (t.charAt(0) === '-') return false
    const base = t.split('/').pop()
    const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(base)
    if (!hasExt && !KNOWN_NO_EXT.test(base)) return false
    return true
  }

  function activateFilesTab() {
    try {
      const tabs = document.querySelectorAll('[role="tablist"] [role="tab"]')
      for (const t of tabs) {
        if (t.textContent && t.textContent.trim() === '文件') { t.click(); return }
      }
    } catch (e) {}
  }

  function showToast(msg) {
    try {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(msg)
        return
      }
    } catch (e) {}
    try { console.warn('[DSH Editor]', msg) } catch (e) {}
  }

  async function requestOpenPath(path) {
    if (!path) return
    activateFilesTab()
    let res = null
    try {
      res = await rpc('fs.stat-path', { path: path })
    } catch (e) {
      showToast('无法验证路径: ' + path)
      return
    }
    if (res && res.exists && res.type === 'file') {
      const abs = res.path || path
      if (editorOpenPathRef) editorOpenPathRef(abs)
      else pendingPath = abs
    } else if (res && res.exists) {
      showToast('这是一个目录,无法直接打开:\n' + path + '\n\n请在「文件」页左侧文件树中展开。')
    } else {
      showToast('文件不存在:\n' + path)
    }
  }

  function markPathLinks(rootEl) {
    try {
      if (!rootEl || !rootEl.querySelectorAll) return
      const codes = rootEl.tagName === 'CODE' ? [rootEl] : Array.from(rootEl.querySelectorAll('code'))
      for (const c of codes) {
        if (c.closest && c.closest('pre')) continue
        if (c.dataset && c.dataset.dshPathMarked) continue
        const text = c.textContent || ''
        if (looksLikePath(text)) {
          c.classList.add(PATH_LINK_CLASS)
          c.setAttribute('title', 'Ctrl+点击打开该文件')
          if (c.dataset) c.dataset.dshPathMarked = '1'
        }
      }
    } catch (e) {}
  }

  function onPathClick(e) {
    if (!(e.ctrlKey || e.metaKey)) return
    let el = e.target
    if (el && el.closest) el = el.closest('.' + PATH_LINK_CLASS)
    if (!el) return
    const path = (el.textContent || '').trim()
    if (!path) return
    e.preventDefault()
    e.stopPropagation()
    requestOpenPath(path)
  }

  function installPathLinkSystem() {
    let disposed = false
    markPathLinks(document.body)
    let observer = null
    try {
      observer = new MutationObserver(function (muts) {
        if (disposed) return
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (!n || n.nodeType !== 1) continue
            if (n.querySelectorAll) markPathLinks(n)
            else if (n.tagName === 'CODE') markPathLinks(n)
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    } catch (e) { observer = null }
    document.addEventListener('click', onPathClick, true)
    return function () {
      disposed = true
      if (observer) { try { observer.disconnect() } catch (e) {} }
      document.removeEventListener('click', onPathClick, true)
      try {
        document.querySelectorAll('.' + PATH_LINK_CLASS).forEach(function (el) {
          el.classList.remove(PATH_LINK_CLASS)
          el.removeAttribute('title')
          if (el.dataset) delete el.dataset.dshPathMarked
        })
      } catch (e) {}
    }
  }

  function EditorPanel() {
    const [cwd, setCwd] = usePersisted('cwd')
    const [rootDir, setRootDir] = usePersisted('root')
    const [openFiles, setOpenFiles] = usePersisted('openFiles')
    const [activePath, setActivePath] = usePersisted('activePath')
    const [searchMode, setSearchMode] = usePersisted('searchMode')
    const [searchQuery, setSearchQuery] = usePersisted('searchQuery')
    const [searchResults, setSearchResults] = usePersisted('searchResults')
    const [searchScope, setSearchScope] = usePersisted('searchScope')
    const [searchTruncated, setSearchTruncated] = usePersisted('searchTruncated')
    const [searchFiles, setSearchFiles] = usePersisted('searchFiles')
    const [include, setInclude] = usePersisted('include')
    const [exclude, setExclude] = usePersisted('exclude')
    const [caseSensitive, setCaseSensitive] = usePersisted('caseSensitive')
    const [wholeWord, setWholeWord] = usePersisted('wholeWord')
    const [useRegex, setUseRegex] = usePersisted('useRegex')
    const [replaceMode, setReplaceMode] = usePersisted('replaceMode')
    const [replaceText, setReplaceText] = usePersisted('replaceText')
    const [searchHistory, setSearchHistory] = usePersisted('searchHistory')
    const [sidebarWidth, setSidebarWidth] = usePersisted('sidebarWidth')
    const [sidebarCollapsed, setSidebarCollapsed] = usePersisted('sidebarCollapsed')
    const [mdViewMode, setMdViewMode] = usePersisted('mdViewMode')
    const [editorSettings, setEditorSettings] = useEditorSettings()
    const [mdHtml, setMdHtml] = React.useState('')
    const [splitRatio, setSplitRatio] = React.useState(0.5)
    const [gitChanges, setGitChanges] = React.useState({})
    const [diffOpen, setDiffOpen] = React.useState(false)
    const [diffPath, setDiffPath] = React.useState('')
    const [diffText, setDiffText] = React.useState('')
    const [status, setStatus] = React.useState('idle')
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [searching, setSearching] = React.useState(false)
    const [showSettings, setShowSettings] = React.useState(false)
    const [dirty, setDirty] = React.useState(false)
    const [treeNodes, setTreeNodes] = React.useState({})
    const [expanded, setExpanded] = React.useState({})
    const [quickOpen, setQuickOpen] = React.useState(false)
    const [quickQuery, setQuickQuery] = React.useState('')
    const [fileList, setFileList] = React.useState(null)
    const [scrollTop, setScrollTop] = React.useState(0)
    const [viewH, setViewH] = React.useState(600)
    const editorRef = React.useRef(null)
    const hostRef = React.useRef(null)
    const previewRef = React.useRef(null)
    const searchSeqRef = React.useRef(0)
    const pollDisposeRef = React.useRef(null)
    const jobRef = React.useRef(null)
    const suppressChangeRef = React.useRef(false)
    const searchInputRef = React.useRef(null)
    const quickInputRef = React.useRef(null)
    const syncLockRef = React.useRef(false)
    const fileListBaseRef = React.useRef('')
    const openFileRef = React.useRef(null)

    function findFile(path) {
      for (const f of viewState.openFiles) { if (f.path === path) return f }
      return null
    }

    function updateSetting(key, val) {
      setEditorSettings(Object.assign({}, editorSettings, { [key]: val }))
    }

    function loadTreeDir(path) {
      rpc('fs.list', { path: path }).then(function (res) {
        if (res && !res.error) {
          setTreeNodes(function (prev) { const n = Object.assign({}, prev); n[path] = (res.items || []); return n })
        }
      }).catch(function () {})
    }

    function loadGitStatus() {
      rpc('git.status', { root: viewState.root || '/' }).then(function (res) {
        if (res && !res.error && res.changes) {
          const map = {}
          for (const c of res.changes) { if (c && c.path) map[c.path] = c.status }
          setGitChanges(map)
        } else {
          setGitChanges({})
        }
      }).catch(function () { setGitChanges({}) })
    }

    function toggleDir(path) {
      const isOpen = !!expanded[path]
      if (!isOpen) loadTreeDir(path)
      setExpanded(function (prev) { const n = Object.assign({}, prev); n[path] = !isOpen; return n })
    }

    function openDiff(path) {
      setDiffOpen(true)
      setDiffPath(path)
      setDiffText('')
      rpc('git.diff', { root: viewState.root || '/', path: path }).then(function (res) {
        if (res && !res.error) setDiffText(res.diff || '(无差异 — 可能是未跟踪文件)')
        else setDiffText('(无法获取 diff: ' + ((res && res.error) || '') + ')')
      }).catch(function (e) { setDiffText('(无法获取 diff: ' + String((e && e.message) ? e.message : e) + ')') })
    }

    function gitFlag(itemPath) {
      const s = gitChanges[itemPath]
      if (!s) return null
      const label = String(s).trim()
      return React.createElement('span', {
        className: 'dsh-editor-git' + (label === '??' ? ' untracked' : ''),
        title: 'Git 状态: ' + label + ' — 点击查看 diff',
        onClick: function (e) { e.stopPropagation(); openDiff(itemPath) }
      }, label)
    }

    function renderTree(path, depth) {
      const children = treeNodes[path] || []
      return children.map(function (item) {
        const indent = { paddingLeft: (8 + depth * 14) + 'px' }
        if (item.type === 'directory') {
          const open = !!expanded[item.path]
          return React.createElement('div', { key: item.path },
            React.createElement('div', { className: 'dsh-editor-file dir', style: indent, onClick: function () { toggleDir(item.path) }, title: item.path },
              React.createElement('span', { className: 'dsh-editor-caret' }, open ? '▾' : '▸'),
              React.createElement('span', null, '📁 ' + item.name)
            ),
            open ? renderTree(item.path, depth + 1) : null
          )
        }
        return React.createElement('div', {
          key: item.path,
          className: 'dsh-editor-file file' + (item.path === activePath ? ' active' : ''),
          style: indent,
          onClick: function () { openFile(item) },
          title: item.path
        },
          React.createElement('span', { className: 'dsh-editor-caret' }, ''),
          React.createElement('span', null, '📄 ' + item.name),
          gitFlag(item.path)
        )
      })
    }

    async function initRoot() {
      try {
        const res = await rpc('fs.init', {})
        if (res && res.error) { setStatus('error'); setError(res.error); return }
        const root = (res && res.root) || '/'
        setRootDir(root)
        loadTreeDir(root)
        loadGitStatus()
        setStatus('ready')
      } catch (e) { setStatus('error'); setError(String((e && e.message) ? e.message : e)) }
    }

    function refreshMd() {
      const editor = editorRef.current
      if (!editor) return
      const f = findFile(viewState.activePath)
      if (!f || !isMarkdown(f.name)) return
      const md = editor.getValue()
      renderMarkdownFull(md).then(function (html) {
        if (viewState.activePath !== f.path) return
        setMdHtml(html)
      }).catch(function () {})
    }

    function cycleMdMode() {
      const next = viewState.mdViewMode === 'source' ? 'preview' : (viewState.mdViewMode === 'preview' ? 'split' : 'source')
      setMdViewMode(next)
      if (next !== 'source') refreshMd()
      timer.timeout(function () { if (editorRef.current) editorRef.current.layout() }, 60)
    }

    function mdModeLabel() {
      if (viewState.mdViewMode === 'source') return '👁 预览'
      if (viewState.mdViewMode === 'preview') return '◫ 分屏'
      return '✎ 源码'
    }

    function handleTaskToggle(checked, taskText) {
      const editor = editorRef.current
      if (!editor) return
      const md = editor.getValue()
      const lines = md.split('\n')
      let changed = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const m = /^\s*[-*+]\s+\[([ xX])\]/.exec(line)
        if (m && line.indexOf(taskText) !== -1) {
          lines[i] = line.replace(/\[([ xX])\]/, '[' + (checked ? 'x' : ' ') + ']')
          changed = true
          break
        }
      }
      if (changed) {
        const newContent = lines.join('\n')
        suppressChangeRef.current = true
        editor.setValue(newContent)
        suppressChangeRef.current = false
        const f = findFile(viewState.activePath)
        if (f) { f.content = newContent; f.dirty = true; setOpenFiles(viewState.openFiles.slice()) }
        setDirty(true)
        refreshMd()
      }
    }

    function onPreviewClick(e) {
      const t = e.target
      if (!t || t.tagName !== 'INPUT' || t.type !== 'checkbox') return
      const li = t.closest ? t.closest('li') : null
      const text = li ? String(li.textContent || '').replace(/^\s+|\s+$/g, '') : ''
      handleTaskToggle(t.checked, text)
    }

    function activateFile(path) {
      const f = findFile(path)
      if (!f) return
      const editor = editorRef.current
      suppressChangeRef.current = true
      if (editor) {
        editor.setValue(f.content || '')
        const model = editor.getModel()
        if (model && live.monaco) live.monaco.editor.setModelLanguage(model, detectLang(f.name))
      }
      suppressChangeRef.current = false
      setActivePath(path)
      setDirty(f.dirty)
      if (!isMarkdown(f.name)) {
        setMdViewMode('source')
        setMdHtml('')
      } else if (viewState.mdViewMode !== 'source') {
        refreshMd()
      }
    }

    async function openFile(item) {
      if (!item || item.type !== 'file') return
      const path = item.path
      if (findFile(path)) { activateFile(path); return }
      setBusy(true)
      try {
        const res = await rpc('fs.read', { path: path })
        if (res && res.error) { setStatus('error'); setError(res.error); return }
        const content = (res && res.content) || ''
        const name = path.split('/').pop()
        const files = viewState.openFiles.slice()
        files.push({ path: path, name: name, content: content, dirty: false })
        setOpenFiles(files)
        let projCwd = path.split('/').slice(0, -1).join('/') || '/'
        try {
          const pr = await rpc('fs.project-root', { path: path })
          if (pr && pr.projectRoot) projCwd = pr.projectRoot
        } catch (e) {}
        setCwd(projCwd)
        activateFile(path)
        setError('')
        setStatus('ready')
      } catch (e) { setStatus('error'); setError(String((e && e.message) ? e.message : e)) }
      finally { setBusy(false) }
    }
    openFileRef.current = openFile

    async function openFromSearch(m) {
      if (findFile(m.path)) activateFile(m.path)
      else await openFile({ type: 'file', path: m.path })
      const editor = editorRef.current
      if (editor && live.monaco) {
        const startCol = m.col || 1
        editor.revealLineInCenter(m.line)
        editor.setSelection(new live.monaco.Range(m.line, startCol, m.line, startCol + (m.len || 0)))
        editor.focus()
      }
    }

    function closeTab(path) {
      const files = viewState.openFiles.filter(function (f) { return f.path !== path })
      setOpenFiles(files)
      if (viewState.activePath === path) {
        const next = files.length ? files[files.length - 1] : null
        if (next) activateFile(next.path)
        else {
          setActivePath('')
          setDirty(false)
          suppressChangeRef.current = true
          if (editorRef.current) editorRef.current.setValue('// 从左侧文件树选择一个文件开始编辑\n')
          suppressChangeRef.current = false
        }
      }
    }

    async function save() {
      const p = viewState.activePath
      if (!p) return
      const f = findFile(p)
      const content = editorRef.current ? editorRef.current.getValue() : (f ? f.content : '')
      setBusy(true)
      try {
        const res = await rpc('fs.write', { path: p, content: content })
        if (res && res.error) { setStatus('error'); setError(res.error); return }
        if (f) { f.content = content; f.dirty = false; setOpenFiles(viewState.openFiles.slice()) }
        setDirty(false)
        setError('')
        setStatus('ready')
        loadGitStatus()
      } catch (e) { setStatus('error'); setError(String((e && e.message) ? e.message : e)) }
      finally { setBusy(false) }
    }

    async function doReplaceAll() {
      const list = viewState.searchResults
      if (!list || !list.length) return
      if (viewState.searchTruncated) {
        try { if (!window.confirm('结果已截断，将只替换已找到的 ' + list.length + ' 处。继续？')) return } catch (e) {}
      } else {
        try { if (!window.confirm('确定将 ' + list.length + ' 处匹配替换为当前内容？')) return } catch (e) {}
      }
      const edits = list.map(function (m) {
        return { path: m.path, line: m.line, col: m.col, len: m.len, newText: viewState.replaceText }
      })
      setBusy(true)
      try {
        const res = await rpc('fs.search-replace', { edits: edits })
        let replaced = 0, failed = 0
        for (const r of ((res && res.results) || [])) {
          if (r && r.error) failed++
          else replaced += (r && r.replaced) || 0
        }
        setError('')
        setStatus('ready')
        if (failed) setError('已替换 ' + replaced + ' 处（' + failed + ' 个文件失败）')
        loadGitStatus()
        startSearch()
      } catch (e) { setStatus('error'); setError(String((e && e.message) ? e.message : e)) }
      finally { setBusy(false) }
    }

    function stopCurrentSearch() {
      if (pollDisposeRef.current) { try { pollDisposeRef.current() } catch (e) {} pollDisposeRef.current = null }
      if (jobRef.current) { rpc('fs.search-cancel', { jobId: jobRef.current }).catch(function () {}); jobRef.current = null }
    }

    function invalidateSearch(q) {
      searchSeqRef.current++
      stopCurrentSearch()
      setSearchResults([])
      setSearchTruncated(false)
      setSearchFiles(0)
      setScrollTop(0)
      setSearching(!!(q && q.trim()))
    }

    async function startSearch() {
      const q = viewState.searchQuery
      if (!q || !q.trim()) {
        invalidateSearch('')
        return
      }
      const h = viewState.searchHistory.slice()
      const hi = h.indexOf(q)
      if (hi !== -1) h.splice(hi, 1)
      h.unshift(q)
      if (h.length > 20) h.pop()
      setSearchHistory(h)
      stopCurrentSearch()
      const mySeq = ++searchSeqRef.current
      const scope = viewState.searchScope
      const base = scope === 'root' ? (viewState.root || '/') : (viewState.cwd || viewState.root || '/')
      setSearching(true)
      setError('')
      setSearchResults([])
      setSearchTruncated(false)
      setSearchFiles(0)
      setScrollTop(0)

      let jobId = null
      try {
        const start = await rpc('fs.search-start', {
          query: q,
          root: base,
          include: viewState.include,
          exclude: viewState.exclude,
          caseSensitive: viewState.caseSensitive,
          wholeWord: viewState.wholeWord,
          useRegex: viewState.useRegex
        })
        if (mySeq !== searchSeqRef.current) {
          if (start && start.jobId) rpc('fs.search-cancel', { jobId: start.jobId }).catch(function () {})
          return
        }
        if (start && start.error) { setSearching(false); setStatus('error'); setError(start.error); return }
        jobId = start.jobId
        jobRef.current = jobId
      } catch (e) {
        if (mySeq !== searchSeqRef.current) return
        setSearching(false); setStatus('error'); setError(String((e && e.message) ? e.message : e)); return
      }

      let accumulated = []
      const fileSet = new Set()
      let pollBusy = false

      const dispose = timer.interval(function () {
        if (pollBusy) return
        if (mySeq !== searchSeqRef.current) { dispose(); return }
        pollBusy = true
        rpc('fs.search-poll', { jobId: jobId }).then(function (res) {
          pollBusy = false
          if (mySeq !== searchSeqRef.current) return
          if (res && res.error) { dispose(); pollDisposeRef.current = null; jobRef.current = null; setSearching(false); setStatus('error'); setError(res.error); return }
          if (res && res.matches && res.matches.length) {
            for (const m of res.matches) fileSet.add(m.path)
            accumulated = accumulated.concat(res.matches)
            setSearchResults(accumulated)
            setSearchFiles(fileSet.size)
          }
          if (res && res.truncated) setSearchTruncated(true)
          if (res && res.done) { dispose(); pollDisposeRef.current = null; jobRef.current = null; setSearching(false) }
        }).catch(function (e) {
          pollBusy = false
          if (mySeq !== searchSeqRef.current) return
          dispose(); pollDisposeRef.current = null; jobRef.current = null; setSearching(false)
          setStatus('error'); setError(String((e && e.message) ? e.message : e))
        })
      }, 200)
      pollDisposeRef.current = dispose
    }

    function openQuick() {
      setQuickOpen(true)
      setQuickQuery('')
      const base = viewState.cwd || viewState.root || '/'
      const needLoad = fileListBaseRef.current !== base
      fileListBaseRef.current = base
      if (needLoad) setFileList(null)
      if (needLoad) {
        rpc('fs.files', { root: base }).then(function (res) {
          if (fileListBaseRef.current === base) setFileList((res && res.files) || [])
        }).catch(function () { if (fileListBaseRef.current === base) setFileList([]) })
      }
      timer.timeout(function () { if (quickInputRef.current) quickInputRef.current.focus() }, 50)
    }

    function startMdSplitResize(e) {
      e.preventDefault()
      const startX = e.clientX
      const startRatio = splitRatio
      const area = e.currentTarget.parentElement
      const areaW = area ? area.clientWidth : 0
      const onMove = function (ev) {
        if (!areaW) return
        const r = startRatio - (ev.clientX - startX) / areaW
        setSplitRatio(Math.max(0.15, Math.min(0.85, r)))
      }
      const onUp = function () {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (editorRef.current) editorRef.current.layout()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    function onPreviewScroll(e) {
      if (syncLockRef.current) return
      const prev = e.currentTarget
      const ed = editorRef.current
      if (!ed || !prev) return
      syncLockRef.current = true
      const pMax = Math.max(1, prev.scrollHeight - prev.clientHeight)
      const ratio = prev.scrollTop / pMax
      ed.setScrollTop(ratio * Math.max(1, ed.getScrollHeight() - ed.getLayoutInfo().height))
      timer.timeout(function () { syncLockRef.current = false }, 80)
    }

    React.useEffect(function () {
      let cancelled = false
      setStatus('loading')
      loadMonaco().then(function (monaco) {
        if (cancelled) return
        live.monaco = monaco
        const el = hostRef.current
        if (!el) { setStatus('error'); setError('编辑器容器未就绪'); return }
        const active = findFile(viewState.activePath)
        const s = editorSettings
        const createOpts = {
          value: active ? active.content : '// 从左侧文件树选择一个文件开始编辑\n',
          language: active ? detectLang(active.name) : 'plaintext',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: s.minimap },
          fontSize: s.fontSize,
          wordWrap: s.wordWrap ? 'on' : 'off',
          tabSize: s.tabSize,
          lineNumbers: s.lineNumbers ? 'on' : 'off',
          scrollBeyondLastLine: false
        }
        if (s.fontFamily) createOpts.fontFamily = s.fontFamily
        const editor = monaco.editor.create(el, createOpts)
        editorRef.current = editor
        live.editor = editor
        if (theme !== undefined) applyMonacoTheme(theme.getTheme())
        if (active) setDirty(active.dirty)
        editor.onDidChangeModelContent(function () {
          if (suppressChangeRef.current) return
          const p = viewState.activePath
          if (!p) return
          const f = findFile(p)
          if (!f) return
          f.content = editor.getValue()
          if (!f.dirty) { f.dirty = true; setOpenFiles(viewState.openFiles.slice()) }
          setDirty(true)
          if (isMarkdown(f.name) && viewState.mdViewMode !== 'source') refreshMd()
        })
        editor.onDidScrollChange(function (e) {
          if (syncLockRef.current) return
          if (viewState.mdViewMode === 'source') return
          const prev = previewRef.current
          if (!prev) return
          syncLockRef.current = true
          const edMax = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
          const ratio = e.scrollTop / edMax
          prev.scrollTop = ratio * Math.max(1, prev.scrollHeight - prev.clientHeight)
          timer.timeout(function () { syncLockRef.current = false }, 80)
        })
        setStatus('ready')
      }).catch(function (e) {
        if (cancelled) return
        setStatus('error')
        setError(String((e && e.message) ? e.message : e))
      })
      return function () {
        cancelled = true
        live.editor = null
        if (editorRef.current) { try { editorRef.current.dispose() } catch (e) {} editorRef.current = null }
      }
    }, [])

    React.useEffect(function () { initRoot() }, [])

    React.useEffect(function () {
      return function () {
        searchSeqRef.current++
        stopCurrentSearch()
      }
    }, [])

    React.useEffect(function () {
      editorOpenPathRef = function (path) {
        if (openFileRef.current) openFileRef.current({ type: 'file', path: path })
      }
      if (pendingPath) {
        const p = pendingPath
        pendingPath = null
        timer.timeout(function () {
          if (openFileRef.current) openFileRef.current({ type: 'file', path: p })
        }, 250)
      }
      return function () {
        if (editorOpenPathRef) editorOpenPathRef = null
      }
    }, [])

    React.useEffect(function () {
      mdRefreshFn = function () {
        if (viewState.mdViewMode === 'source') return
        refreshMd()
      }
      return function () { mdRefreshFn = null }
    }, [])

    React.useEffect(function () {
      function onKey(e) {
        const t = e.target
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          let inMonaco = false
          try { if (t.closest && t.closest('.monaco-editor')) inMonaco = true } catch (e2) {}
          if (!inMonaco) return
        }
        const qk = parseKeyCombo(editorSettings.quickOpenKey)
        if (matchesCombo(e, qk)) { e.preventDefault(); e.stopPropagation(); openQuick(); return }
        const sk = parseKeyCombo(editorSettings.saveKey)
        if (matchesCombo(e, sk)) { e.preventDefault(); e.stopPropagation(); save(); return }
        const fk = parseKeyCombo(editorSettings.searchKey)
        if (matchesCombo(e, fk)) { e.preventDefault(); e.stopPropagation(); setSearchMode(true); timer.timeout(function () { if (searchInputRef.current) searchInputRef.current.focus() }, 50); return }
      }
      document.addEventListener('keydown', onKey, true)
      return function () { document.removeEventListener('keydown', onKey, true) }
    }, [editorSettings])

    React.useEffect(function () {
      const q = viewState.searchQuery
      if (!q || !q.trim()) {
        invalidateSearch('')
        return
      }
      return timer.timeout(function () { startSearch() }, 300)
    }, [searchQuery, include, exclude, caseSensitive, wholeWord, useRegex, searchScope])

    function refresh() {
      setTreeNodes({})
      setExpanded({})
      loadTreeDir(viewState.root || '/')
      loadGitStatus()
    }

    function toggleSidebar() {
      setSidebarCollapsed(!viewState.sidebarCollapsed)
    }

    function startResize(e) {
      e.preventDefault()
      const startX = e.clientX
      const startW = viewState.sidebarWidth
      const onMove = function (ev) {
        const w = startW + (ev.clientX - startX)
        setSidebarWidth(Math.max(160, Math.min(640, w)))
      }
      const onUp = function () {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    function relPath(abs) {
      const r = viewState.root
      if (r && r !== '/' && abs.indexOf(r) === 0) {
        const rel = abs.slice(r.length).replace(/^\//, '')
        if (rel) return rel
      }
      return abs
    }

    function highlightText(m) {
      if (!m.text) return null
      const a = (typeof m.hiStart === 'number') ? m.hiStart : -1
      const b = (typeof m.hiEnd === 'number') ? m.hiEnd : -1
      if (a < 0 || b <= a || b > m.text.length) return m.text
      return React.createElement(React.Fragment, null,
        m.text.slice(0, a),
        React.createElement('mark', { className: 'dsh-editor-hit' }, m.text.slice(a, b)),
        m.text.slice(b)
      )
    }

    function groupResults(list) {
      const map = new Map()
      for (const m of list) {
        if (!map.has(m.path)) map.set(m.path, { path: m.path, name: m.name, items: [] })
        map.get(m.path).items.push(m)
      }
      return Array.from(map.values())
    }

    function onResultsScroll(e) {
      const el = e.currentTarget
      setScrollTop(el.scrollTop)
      const h = el.clientHeight
      if (h && h !== viewH) setViewH(h)
    }

    const FILE_H = 26
    const MATCH_H = 22
    const OVERSCAN_PX = 400
    const groups = groupResults(searchResults)
    const rows = []
    for (const g of groups) {
      rows.push({ type: 'file', h: FILE_H, g: g })
      for (const m of g.items) rows.push({ type: 'match', h: MATCH_H, m: m })
    }
    const offsets = new Array(rows.length)
    let totalH = 0
    for (let i = 0; i < rows.length; i++) { offsets[i] = totalH; totalH += rows[i].h }

    function findRowAt(y) {
      let lo = 0, hi = rows.length - 1, ans = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (offsets[mid] <= y) { ans = mid; lo = mid + 1 } else hi = mid - 1
      }
      return ans
    }

    let resultsEl = null
    if (rows.length === 0) {
      resultsEl = React.createElement('div', { className: 'dsh-editor-results' },
        React.createElement('div', { className: 'dsh-editor-empty' }, searchQuery && searchQuery.trim() ? (searching ? '搜索中…' : '无结果') : '输入关键词即开始搜索')
      )
    } else {
      const startIdx = findRowAt(Math.max(0, scrollTop - OVERSCAN_PX))
      const endIdx = Math.min(rows.length - 1, findRowAt(scrollTop + viewH + OVERSCAN_PX))
      const visibleRows = []
      for (let i = startIdx; i <= endIdx; i++) {
        const r = rows[i]
        let inner = null
        if (r.type === 'file') {
          inner = React.createElement('div', { className: 'dsh-editor-result-name', title: r.g.path, style: { height: FILE_H + 'px', boxSizing: 'border-box' } }, relPath(r.g.path) + '  (' + r.g.items.length + ')')
        } else {
          inner = React.createElement('div', { className: 'dsh-editor-result-line', onClick: function () { openFromSearch(r.m) }, title: r.m.text },
            React.createElement('span', { className: 'dsh-editor-result-lineno' }, String(r.m.line)),
            React.createElement('span', { className: 'dsh-editor-result-text' }, highlightText(r.m)))
        }
        visibleRows.push(React.createElement('div', {
          key: (r.type === 'file' ? 'f:' + r.g.path : r.g.path + ':' + r.m.line + ':' + r.m.col),
          style: { position: 'absolute', top: offsets[i] + 'px', left: 0, right: 0, height: r.h + 'px', overflow: 'hidden' }
        }, inner))
      }
      resultsEl = React.createElement('div', { className: 'dsh-editor-results', onScroll: onResultsScroll, style: { position: 'relative' } },
        React.createElement('div', { style: { position: 'relative', height: totalH + 'px' } }, visibleRows)
      )
    }

    function toggleBtn(active, label, title, onClick) {
      return React.createElement('button', {
        className: 'dsh-editor-toggle' + (active ? ' active' : ''),
        title: title,
        onClick: onClick
      }, label)
    }

    const filesPane = React.createElement('div', { className: 'dsh-editor-files' },
      renderTree(viewState.root || '/', 0)
    )

    function metaText() {
      const base = viewState.searchScope === 'root' ? (viewState.root || '/') : (viewState.cwd || viewState.root || '/')
      const scopeLabel = viewState.searchScope === 'root' ? '工作区' : (viewState.cwd ? '当前项目' : '工作区(未打开文件)')
      if (searchResults.length === 0 && !searchTruncated && !searching) return null
      const parts = []
      if (searching) parts.push('搜索中…')
      parts.push(searchResults.length + ' 条结果')
      parts.push(searchFiles + ' 个文件')
      parts.push(scopeLabel + ': ' + relPath(base))
      if (searchTruncated) parts.push('已截断,请缩小范围')
      return parts.join(' · ')
    }

    const settingsPanel = showSettings
      ? React.createElement('div', { className: 'dsh-editor-settings' },
          React.createElement('div', { className: 'dsh-editor-setting-row' },
            React.createElement('label', null, '字号'),
            React.createElement(NumberField, { value: editorSettings.fontSize, min: 10, max: 24, onCommit: function (v) { updateSetting('fontSize', v) } })
          ),
          React.createElement('div', { className: 'dsh-editor-setting-row' },
            React.createElement('label', null, 'Tab 宽度'),
            React.createElement(NumberField, { value: editorSettings.tabSize, min: 2, max: 8, step: 2, onCommit: function (v) { updateSetting('tabSize', v) } })
          ),
          React.createElement('div', { className: 'dsh-editor-setting-row' },
            React.createElement('label', null, '自动换行'),
            React.createElement('button', { className: 'dsh-editor-setting-toggle' + (editorSettings.wordWrap ? ' on' : ''), onClick: function () { updateSetting('wordWrap', !editorSettings.wordWrap) } }, editorSettings.wordWrap ? '开' : '关')
          ),
          React.createElement('div', { className: 'dsh-editor-setting-row' },
            React.createElement('label', null, 'Minimap'),
            React.createElement('button', { className: 'dsh-editor-setting-toggle' + (editorSettings.minimap ? ' on' : ''), onClick: function () { updateSetting('minimap', !editorSettings.minimap) } }, editorSettings.minimap ? '开' : '关')
          )
        )
      : null

    const searchPane = React.createElement('div', { className: 'dsh-editor-search' },
      React.createElement('datalist', { id: 'dsh-search-history' },
        searchHistory.map(function (h) { return React.createElement('option', { key: h, value: h }) })
      ),
      React.createElement('div', { className: 'dsh-editor-searchbar' },
        React.createElement('input', {
          ref: searchInputRef,
          className: 'dsh-editor-search-input',
          placeholder: useRegex ? '正则表达式（输入即搜）' : '搜索文本（输入即搜）',
          value: searchQuery,
          list: 'dsh-search-history',
          onChange: function (e) {
            const v = e.target.value
            setSearchQuery(v)
            invalidateSearch(v)
          }
        }),
        React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: function () { setReplaceMode(!replaceMode) }, title: '切换替换' }, replaceMode ? '🔍' : '🔄')
      ),
      replaceMode
        ? React.createElement('div', { className: 'dsh-editor-replace-row' },
            React.createElement('input', {
              className: 'dsh-editor-search-input',
              placeholder: '替换为…',
              value: replaceText,
              onChange: function (e) { setReplaceText(e.target.value) }
            }),
            React.createElement('button', { className: 'dsh-editor-btn', onClick: doReplaceAll, disabled: !searchResults.length }, '全部替换')
          )
        : null,
      React.createElement('div', { className: 'dsh-editor-toggles' },
        toggleBtn(caseSensitive, 'Aa', '区分大小写', function () { setCaseSensitive(!caseSensitive); invalidateSearch(viewState.searchQuery) }),
        toggleBtn(wholeWord, 'ab', '全字匹配', function () { setWholeWord(!wholeWord); invalidateSearch(viewState.searchQuery) }),
        toggleBtn(useRegex, '.*', '使用正则表达式', function () { setUseRegex(!useRegex); invalidateSearch(viewState.searchQuery) })
      ),
      React.createElement('div', { className: 'dsh-editor-filter' },
        React.createElement('label', { className: 'dsh-editor-filter-label' }, '包含'),
        React.createElement('input', {
          className: 'dsh-editor-search-input',
          placeholder: '*.ts, src/**',
          value: include,
          onChange: function (e) { setInclude(e.target.value); invalidateSearch(viewState.searchQuery) }
        })
      ),
      React.createElement('div', { className: 'dsh-editor-filter' },
        React.createElement('label', { className: 'dsh-editor-filter-label' }, '排除'),
        React.createElement('input', {
          className: 'dsh-editor-search-input',
          placeholder: '**/*.test.*, dist/**',
          value: exclude,
          onChange: function (e) { setExclude(e.target.value); invalidateSearch(viewState.searchQuery) }
        })
      ),
      React.createElement('div', { className: 'dsh-editor-scope' },
        React.createElement('button', { className: 'dsh-editor-scope-btn' + (searchScope === 'cwd' ? ' active' : ''), onClick: function () { setSearchScope('cwd'); invalidateSearch(viewState.searchQuery) } }, '当前项目'),
        React.createElement('button', { className: 'dsh-editor-scope-btn' + (searchScope === 'root' ? ' active' : ''), onClick: function () { setSearchScope('root'); invalidateSearch(viewState.searchQuery) } }, '工作区')
      ),
      resultsEl,
      metaText()
        ? React.createElement('div', { className: 'dsh-editor-search-meta' }, metaText())
        : null
    )

    const tabBar = openFiles.length
      ? React.createElement('div', { className: 'dsh-editor-tabs' },
          openFiles.map(function (f) {
            const active = f.path === activePath
            return React.createElement('div', {
              key: f.path,
              className: 'dsh-editor-tab' + (active ? ' active' : ''),
              onClick: function () { if (!active) activateFile(f.path) },
              title: f.path
            },
              React.createElement('span', { className: 'dsh-editor-tab-dot' }, f.dirty ? '●' : ''),
              React.createElement('span', { className: 'dsh-editor-tab-name' }, f.name),
              React.createElement('span', { className: 'dsh-editor-tab-close', onClick: function (e) { e.stopPropagation(); closeTab(f.path) } }, '×')
            )
          })
        )
      : null

    const quickMatches = (fileList || []).filter(function (f) {
      const q = quickQuery.trim().toLowerCase()
      if (!q) return true
      const base = fileListBaseRef.current
      let rel = f
      if (base && base !== '/' && f.indexOf(base) === 0) {
        rel = f.slice(base.length).replace(/^\//, '')
      }
      return rel.toLowerCase().indexOf(q) !== -1
    }).slice(0, 50)

    const quickOpenModal = quickOpen
      ? React.createElement('div', { className: 'dsh-editor-quick-mask', onClick: function () { setQuickOpen(false) } },
          React.createElement('div', { className: 'dsh-editor-quick', onClick: function (e) { e.stopPropagation() } },
            React.createElement('input', {
              ref: quickInputRef,
              className: 'dsh-editor-search-input',
              placeholder: '快速打开文件…（当前目录及子目录）',
              value: quickQuery,
              onChange: function (e) { setQuickQuery(e.target.value) },
              onKeyDown: function (e) {
                if (e.key === 'Enter' && quickMatches.length) { openFile({ type: 'file', path: quickMatches[0] }); setQuickOpen(false) }
                if (e.key === 'Escape') setQuickOpen(false)
              }
            }),
            React.createElement('div', { className: 'dsh-editor-quick-list' },
              quickMatches.map(function (f) {
                return React.createElement('div', {
                  key: f,
                  className: 'dsh-editor-quick-item',
                  onClick: function () { openFile({ type: 'file', path: f }); setQuickOpen(false) }
                }, relPath(f))
              })
            )
          )
        )
      : null

    const diffModal = diffOpen
      ? React.createElement('div', { className: 'dsh-editor-quick-mask', onClick: function () { setDiffOpen(false) } },
          React.createElement('div', { className: 'dsh-editor-diff-panel', onClick: function (e) { e.stopPropagation() } },
            React.createElement('div', { className: 'dsh-editor-diff-head' },
              React.createElement('span', { className: 'dsh-editor-diff-title' }, 'git diff — ' + relPath(diffPath)),
              React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: function () { setDiffOpen(false) } }, '关闭')
            ),
            React.createElement('div', { className: 'dsh-editor-diff-body' }, renderDiffLines(diffText))
          )
        )
      : null

    function renderDiffLines(text) {
      if (!text) return React.createElement('div', { className: 'dsh-editor-empty' }, '加载中…')
      const lines = String(text).split('\n')
      return lines.map(function (line, i) {
        let cls = 'dsh-editor-diff-line'
        if (line[0] === '+' && line[1] !== '+') cls += ' add'
        else if (line[0] === '-' && line[1] !== '-') cls += ' del'
        else if (line.indexOf('@@') === 0) cls += ' hunk'
        else if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 || line.indexOf('---') === 0 || line.indexOf('+++') === 0) cls += ' meta'
        return React.createElement('div', { key: i, className: cls }, line || ' ')
      })
    }

    const currentFile = findFile(activePath)
    const currentFileIsMd = !!currentFile && isMarkdown(currentFile.name)

    const statusEl = status === 'error'
      ? React.createElement('div', { className: 'dsh-editor-status error' }, '错误: ', String(error))
      : React.createElement('div', { className: 'dsh-editor-status ready' },
          status === 'loading' ? '正在加载 Monaco…' : (busy ? '操作中…' : (activePath ? (dirty ? '有未保存的修改' : '已就绪') : '就绪 — 从左侧打开文件')))

    const isSplit = viewState.mdViewMode === 'split'
    const isPreview = viewState.mdViewMode === 'preview'
    let hostStyle = null
    if (isPreview) hostStyle = { display: 'none' }
    else if (isSplit) hostStyle = { flexGrow: 1 - splitRatio, flexBasis: 0, flexShrink: 0, minWidth: 0 }
    let previewStyle = null
    if (isSplit) previewStyle = { flexGrow: splitRatio, flexBasis: 0, flexShrink: 0, minWidth: 0 }

    const mdArea = React.createElement('div', { className: 'dsh-editor-md-area' },
      React.createElement('div', { className: 'dsh-editor-host', ref: hostRef, style: hostStyle }),
      isSplit ? React.createElement('div', { className: 'dsh-editor-md-resizer', onMouseDown: startMdSplitResize, title: '拖动调整分屏宽度' }) : null,
      (isPreview || isSplit)
        ? React.createElement('div', {
            className: 'dsh-editor-md-preview',
            ref: previewRef,
            style: previewStyle,
            onScroll: onPreviewScroll,
            onClick: onPreviewClick,
            dangerouslySetInnerHTML: { __html: mdHtml }
          })
        : null
    )

    return React.createElement('div', { className: 'dsh-editor-panel' },
      React.createElement('div', { className: 'dsh-editor-header' },
        React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: toggleSidebar, title: sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏' }, sidebarCollapsed ? '▶' : '◀'),
        React.createElement('span', { className: 'dsh-editor-title' }, 'DSH Editor'),
        React.createElement('span', { className: 'dsh-editor-path' }, activePath || viewState.root || ''),
        React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: refresh, title: '刷新文件树' }, '🔄'),
        currentFileIsMd ? React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: cycleMdMode, title: '切换 Markdown 视图' }, mdModeLabel()) : null,
        React.createElement('button', { className: 'dsh-editor-btn ghost', onClick: function () { setShowSettings(!showSettings) }, title: '编辑器设置' }, '⚙'),
        React.createElement('button', { className: 'dsh-editor-btn', onClick: save, disabled: !activePath || !dirty, title: '保存 (' + (editorSettings.saveKey || 'Ctrl+S') + ')' }, dirty ? '保存 ●' : '保存'),
        settingsPanel
      ),
      React.createElement('div', { className: 'dsh-editor-body' },
        sidebarCollapsed ? null : React.createElement('div', { className: 'dsh-editor-side', style: { width: sidebarWidth + 'px' } },
          React.createElement('div', { className: 'dsh-editor-lefttabs' },
            React.createElement('button', { className: 'dsh-editor-lefttab' + (!searchMode ? ' active' : ''), onClick: function () { setSearchMode(false) } }, '📁 文件'),
            React.createElement('button', { className: 'dsh-editor-lefttab' + (searchMode ? ' active' : ''), onClick: function () { setSearchMode(true) } }, '🔍 搜索')
          ),
          searchMode ? searchPane : filesPane
        ),
        sidebarCollapsed ? null : React.createElement('div', { className: 'dsh-editor-resizer', onMouseDown: startResize, title: '拖动调整宽度' }),
        React.createElement('div', { className: 'dsh-editor-main' },
          tabBar,
          mdArea,
          statusEl
        )
      ),
      quickOpenModal,
      diffModal
    )
  }

  function SettingsSection() {
    const [s, setS] = useEditorSettings()
    function upd(key, val) { setS(Object.assign({}, s, { [key]: val })) }
    function row(label, control) {
      return React.createElement('div', { className: 'dsh-editor-setting-row' },
        React.createElement('label', null, label),
        control)
    }
    function toggle(label, value, key) {
      return row(label, React.createElement('button', {
        className: 'dsh-editor-setting-toggle' + (value ? ' on' : ''),
        onClick: function () { upd(key, !value) }
      }, value ? '开' : '关'))
    }
    function text(label, value, key, ph) {
      return row(label, React.createElement('input', {
        type: 'text',
        placeholder: ph || '',
        value: value,
        onChange: function (e) { upd(key, e.target.value) }
      }))
    }

    return React.createElement('div', { className: 'dsh-editor-settings-page' },
      React.createElement('div', { className: 'dsh-editor-settings-page-title' }, '编辑器'),
      row('字号', React.createElement(NumberField, { value: s.fontSize, min: 10, max: 24, onCommit: function (v) { upd('fontSize', v) } })),
      row('Tab 宽度', React.createElement('select', {
        className: 'dsh-editor-setting-select',
        value: String(s.tabSize),
        onChange: function (e) { upd('tabSize', parseInt(e.target.value, 10) || 4) }
      },
        React.createElement('option', { value: '2' }, '2'),
        React.createElement('option', { value: '4' }, '4'),
        React.createElement('option', { value: '8' }, '8'))),
      toggle('自动换行', s.wordWrap, 'wordWrap'),
      toggle('Minimap', s.minimap, 'minimap'),
      toggle('显示行号', s.lineNumbers, 'lineNumbers'),
      row('字体', React.createElement('input', {
        type: 'text',
        placeholder: '默认（跟随主题）',
        value: s.fontFamily,
        onChange: function (e) { upd('fontFamily', e.target.value) }
      })),
      React.createElement('div', { className: 'dsh-editor-setting-hint' }, '快捷键格式示例：Ctrl+P、Cmd+Shift+F、F5。字母大小写不敏感。'),
      text('快速打开快捷键', s.quickOpenKey, 'quickOpenKey', 'Ctrl+P'),
      text('保存快捷键', s.saveKey, 'saveKey', 'Ctrl+S'),
      text('搜索快捷键', s.searchKey, 'searchKey', 'Ctrl+Shift+F'),
      React.createElement('div', { className: 'dsh-editor-setting-hint' }, '修改立即生效；快速打开列出当前文件所在目录及其子目录下的文件。')
    )
  }

  const EDITOR_SECTION_LABEL = '编辑器'
  const SETTINGS_NAV_MARKER = 'data-dsh-editor-settings-nav'
  function registerSettingsNavIcon() {
    let disposed = false
    const sync = () => {
      if (disposed) return
      let buttons
      try { buttons = document.querySelectorAll('[role="dialog"] nav button') } catch (e) { return }
      for (const button of buttons) {
        if (button.textContent && button.textContent.trim() === EDITOR_SECTION_LABEL) {
          button.setAttribute(SETTINGS_NAV_MARKER, '')
        } else {
          button.removeAttribute(SETTINGS_NAV_MARKER)
        }
      }
    }
    sync()
    let observer
    try {
      observer = new MutationObserver(sync)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    } catch (e) { return function () {} }
    return function () {
      disposed = true
      observer.disconnect()
      try {
        document.querySelectorAll('[' + SETTINGS_NAV_MARKER + ']').forEach(function (el) { el.removeAttribute(SETTINGS_NAV_MARKER) })
      } catch (e) {}
    }
  }
  ctx.effect(() => registerSettingsNavIcon(), 'dsh-code-editor: settings nav icon')

  ctx.effect(() => installPathLinkSystem(), 'dsh-code-editor: path link system')

  slots.inject('conversation.view', function () {
    return slots.register(
      { name: 'conversation.view', id: 'files', order: 20, label: '文件' },
      function (props) { return React.createElement(EditorPanel) }
    )
  })

  slots.inject('settings.section', function () {
    return slots.register(
      { name: 'settings.section', id: 'editor', order: 30, label: EDITOR_SECTION_LABEL },
      function (props) { return React.createElement(SettingsSection) }
    )
  })
}

const inject = ['slots', 'connection', 'timer']

return { inject, apply }

  }
})
