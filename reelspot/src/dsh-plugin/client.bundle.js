/*
 * ReelSpot — DSH composition plugin, CLIENT bundle body.
 *
 * This source is written for the composition-plugin module format (NOT the
 * dynamic-plugin sandbox): build.mjs wraps it into dsh/lib/client.js as
 *
 *   window.__ModuleLoader__.load({ id: 'dsh-reelspot', factory: (require) => {
 *     const React = require('react')
 *     const ReelSpot = (() => { ...core... })()
 *     ...this file...
 *   } })
 *
 * Inside the factory: real browser globals (fetch/document/window) and a real
 * cordis ctx (ctx.slots, ctx.effect, timer mixin via inject: ['timer']).
 * Plain JavaScript only — no JSX, no imports.
 */

const CSS = [
  '.reelspot-wrap{display:inline-flex;align-items:center;gap:4px}',
  '.reelspot-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer;user-select:none;font-family:inherit}',
  '.reelspot-btn:hover{background:rgba(127,127,127,.12)}',
  '.reelspot-dot{width:8px;height:8px;border-radius:50%;background:#e5484d;flex:none}',
  '.reelspot-btn.recording{border-color:#e5484d;color:#e5484d;font-variant-numeric:tabular-nums}',
  '.reelspot-btn.recording .reelspot-dot{animation:reelspot-pulse 1.2s ease-in-out infinite}',
  '@keyframes reelspot-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
  '.reelspot-tog{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:inherit;font-size:13px;cursor:pointer;user-select:none;font-family:inherit}',
  '.reelspot-tog:hover{background:rgba(127,127,127,.12)}',
  '.reelspot-tog.off{opacity:.4}',
  '.reelspot-tog.on{border-color:var(--dsw-alias-brand-primary,#4f7cff);color:var(--dsw-alias-brand-primary,#4f7cff)}',
  '.reelspot-badge{background:#e5484d;color:#fff;border-radius:8px;min-width:16px;height:16px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px}',
  '.reelspot-panel{position:fixed;top:56px;right:12px;z-index:9999;width:340px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-overlay,#222);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.4));border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.35);padding:10px;font-size:12px;font-family:inherit}',
  '.reelspot-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}',
  '.reelspot-x{background:none;border:none;color:inherit;font-size:16px;cursor:pointer;line-height:1;padding:2px 6px}',
  '.reelspot-item{margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}',
  '.reelspot-item:last-child{margin-bottom:0;padding-bottom:0;border-bottom:none}',
  '.reelspot-video{width:100%;border-radius:6px;background:#000;display:block}',
  '.reelspot-meta{color:var(--dsw-alias-label-secondary,#999);margin:6px 0;word-break:break-all}',
  '.reelspot-ops{display:flex;gap:6px;flex-wrap:wrap}',
  '.reelspot-op{padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.4));background:transparent;color:inherit;cursor:pointer;text-decoration:none;font-size:12px;font-family:inherit}',
  '.reelspot-op:hover{background:rgba(127,127,127,.15)}',
  '.reelspot-op[disabled]{opacity:.5;cursor:default}',
  '.reelspot-path{margin-top:6px;color:var(--dsw-alias-state-success-primary,#4caf50);word-break:break-all}',
  '.reelspot-err{margin-top:6px;color:var(--dsw-alias-state-error-primary,#e5484d);word-break:break-all}',
].join('\n')

function pad2(n) { return String(n).padStart(2, '0') }

function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

const audioText = (mode) => mode === 'system+mic' ? '系统+麦克风'
  : mode === 'mic' ? '麦克风'
  : mode === 'system' ? '系统/标签页'
  : '无音频'

let nextId = 1

function ReelSpotButton(ctx) {
  return function ReelSpotButtonView() {
    const [state, setState] = React.useState('idle') // idle | recording
    const [elapsed, setElapsed] = React.useState(0)
    const [micOn, setMicOn] = React.useState(true)
    const [zoomOn, setZoomOn] = React.useState(false)
    const [items, setItems] = React.useState([]) // {id,name,url,blob,size,audioMode,zoomed,savedPath,saving,error}
    const [panelOpen, setPanelOpen] = React.useState(false)
    const recRef = React.useRef(null) // ReelSpot recorder instance
    const startedAtRef = React.useRef(0)
    const micRef = React.useRef(true)
    const zoomRef = React.useRef(false)
    const itemsRef = React.useRef([])
    micRef.current = micOn
    zoomRef.current = zoomOn
    itemsRef.current = items

    const patchItem = (id, patch) => {
      setItems((prev) => prev.map((it) => (it.id === id ? Object.assign({}, it, patch) : it)))
    }

    const start = async () => {
      const recorder = ReelSpot.createRecorder({ mic: micRef.current, zoom: zoomRef.current })
      recRef.current = recorder
      recorder.on('stop', (result) => {
        recRef.current = null
        setState('idle')
        setElapsed(0)
        const item = {
          id: nextId++,
          name: result.name,
          blob: result.blob,
          url: URL.createObjectURL(result.blob),
          size: result.size,
          audioMode: result.audioMode,
          zoomed: result.zoomed,
          savedPath: '',
          saving: false,
          error: '',
        }
        setItems((prev) => [item].concat(prev))
        setPanelOpen(true)
      })
      recorder.on('state', (s) => {
        if (s === 'recording') {
          startedAtRef.current = Date.now()
          setElapsed(0)
          setState('recording')
        }
      })
      recorder.on('error', (e) => console.error('ReelSpot:', e && e.message ? e.message : e))
      const begun = await recorder.start()
      if (!begun && recorder.getState() === 'idle') recRef.current = null // cancelled
    }

    const stop = () => {
      const recorder = recRef.current
      if (recorder) recorder.stop()
    }

    const saveToWorkspace = async (item) => {
      patchItem(item.id, { saving: true, error: '' })
      try {
        const base64 = await toBase64(item.blob)
        const res = await fetch('/dsh-reelspot/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: item.name, base64 }),
        })
        const data = await res.json()
        if (data && data.ok) patchItem(item.id, { saving: false, savedPath: String(data.path || '') })
        else patchItem(item.id, { saving: false, error: '保存失败: ' + (data && data.error ? data.error : 'HTTP ' + res.status) })
      } catch (e) {
        patchItem(item.id, { saving: false, error: '保存失败: ' + String(e && e.message ? e.message : e) })
      }
    }

    const removeItem = (item) => {
      try { URL.revokeObjectURL(item.url) } catch (e) {}
      setItems((prev) => prev.filter((it) => it.id !== item.id))
    }

    // elapsed ticker while recording
    React.useEffect(() => {
      if (state !== 'recording') return undefined
      return ctx.interval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500)
    }, [state])

    // unmount cleanup: halt capture, revoke URLs
    React.useEffect(() => () => {
      const recorder = recRef.current
      if (recorder) { recRef.current = null; try { recorder.stop() } catch (e) {} }
      itemsRef.current.forEach((it) => { try { URL.revokeObjectURL(it.url) } catch (e) {} })
    }, [])

    const recording = state === 'recording'
    const label = recording
      ? pad2(Math.floor(elapsed / 60)) + ':' + pad2(elapsed % 60)
      : '录屏'

    const zoomButton = React.createElement('button', {
      className: 'reelspot-tog' + (zoomOn ? ' on' : ''),
      title: zoomOn
        ? '放大聚焦：开（点击关闭）。光标移动时自动放大跟随，静止后缩回；仅录制本标签页时可跟踪光标'
        : '放大聚焦：关（点击开启）',
      disabled: recording,
      onClick: () => setZoomOn(!zoomOn),
    }, '🔍')

    const micButton = React.createElement('button', {
      className: 'reelspot-tog' + (micOn ? '' : ' off'),
      title: micOn ? '麦克风：开（点击关闭）' : '麦克风：关（点击开启）',
      disabled: recording,
      onClick: () => setMicOn(!micOn),
    }, '🎤')

    const button = React.createElement('button', {
      className: 'reelspot-btn' + (recording ? ' recording' : ''),
      title: recording
        ? '停止录屏 (ReelSpot)'
        : items.length
          ? '开始录屏；点击查看已录 ' + items.length + ' 段视频'
          : '开始录屏：选择屏幕 / 窗口 / 标签页 (ReelSpot)',
      onClick: () => {
        if (recording) { stop(); return }
        if (items.length && !panelOpen) { setPanelOpen(true); return }
        start()
      },
    },
      React.createElement('span', { className: 'reelspot-dot' }),
      label,
      !recording && items.length
        ? React.createElement('span', { className: 'reelspot-badge' }, String(items.length))
        : null,
    )

    const panel = panelOpen && items.length
      ? React.createElement('div', { className: 'reelspot-panel' },
          React.createElement('div', { className: 'reelspot-panel-head' },
            React.createElement('span', null, '录制完成 (' + items.length + ')'),
            React.createElement('button', { className: 'reelspot-x', title: '关闭', onClick: () => setPanelOpen(false) }, '×'),
          ),
          items.map((it) => React.createElement('div', { className: 'reelspot-item', key: it.id },
            React.createElement('video', { className: 'reelspot-video', src: it.url, controls: true, preload: 'metadata' }),
            React.createElement('div', { className: 'reelspot-meta' },
              it.name + ' · ' + fmtSize(it.size) + ' · ' + audioText(it.audioMode) + (it.zoomed ? ' · 聚焦' : '')),
            React.createElement('div', { className: 'reelspot-ops' },
              React.createElement('a', { className: 'reelspot-op', href: it.url, download: it.name }, '下载'),
              React.createElement('button', {
                className: 'reelspot-op',
                disabled: it.saving || !!it.savedPath,
                onClick: () => saveToWorkspace(it),
              }, it.saving ? '保存中…' : it.savedPath ? '已存到工作区' : '存到工作区'),
              React.createElement('button', { className: 'reelspot-op', onClick: () => removeItem(it) }, '删除'),
            ),
            it.savedPath ? React.createElement('div', { className: 'reelspot-path' }, it.savedPath) : null,
            it.error ? React.createElement('div', { className: 'reelspot-err' }, it.error) : null,
          )),
        )
      : null

    return React.createElement(React.Fragment, null,
      React.createElement('span', { className: 'reelspot-wrap' }, zoomButton, micButton, button),
      panel,
    )
  }
}

function apply(ctx) {
  // package-owned stylesheet, removed with the plugin fiber
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-reelspot'
    tag.textContent = CSS
    document.head.append(tag)
    return () => tag.remove()
  }, 'dsh-reelspot: styles')

  const View = ReelSpotButton(ctx)
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'reelspot', order: 30, label: 'ReelSpot 录屏' },
    () => React.createElement(View),
  ))
}

exports.name = 'dsh-reelspot'
exports.inject = ['slots', 'timer']
exports.apply = apply
