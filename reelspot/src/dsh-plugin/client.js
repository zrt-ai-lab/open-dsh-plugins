/*
 * ReelSpot — DSH dynamic Cordis plugin, CLIENT half.
 *
 * This file is the thin UI shell for the DYNAMIC plugin form. It expects the
 * ReelSpot core to be inlined above it as `const ReelSpot = ...` — use
 * `node build.mjs`, which produces dist/reelspot-dsh.client.js
 * (core + this file, ready for cordis_define code.client).
 *
 * Dynamic-sandbox notes: host.call() for Host RPC, styles.insert() for CSS,
 * ctx.interval() for timers (inject: ['timer']).
 * Plain JavaScript only: no JSX / TypeScript / imports. React via React.createElement.
 */
return {
  name: 'reelspot-recorder',
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert([
      '.reelspot-wrap{display:inline-flex;align-items:center;gap:4px}',
      '.reelspot-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer;user-select:none;font-family:inherit}',
      '.reelspot-btn:hover{background:rgba(127,127,127,.12)}',
      '.reelspot-dot{width:8px;height:8px;border-radius:50%;background:#e5484d;flex:none}',
      '.reelspot-btn.recording{border-color:#e5484d;color:#e5484d;font-variant-numeric:tabular-nums}',
      '.reelspot-btn.recording .reelspot-dot{animation:reelspot-pulse 1.2s ease-in-out infinite}',
      '.reelspot-btn.paused{border-color:var(--dsw-alias-state-warn-primary,#e6a23c);color:var(--dsw-alias-state-warn-primary,#e6a23c);font-variant-numeric:tabular-nums}',
      '.reelspot-btn.countdown{border-color:var(--dsw-alias-brand-primary,#4f7cff);color:var(--dsw-alias-brand-primary,#4f7cff);font-weight:700}',
      '@keyframes reelspot-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
      '.reelspot-tog{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:inherit;font-size:13px;cursor:pointer;user-select:none;font-family:inherit}',
      '.reelspot-tog:hover{background:rgba(127,127,127,.12)}',
      '.reelspot-tog.off{opacity:.4}',
      '.reelspot-tog.on{border-color:var(--dsw-alias-brand-primary,#4f7cff);color:var(--dsw-alias-brand-primary,#4f7cff)}',
      '.reelspot-tog[disabled]{opacity:.35;cursor:default}',
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
      '.reelspot-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary,#e6a23c);max-width:170px;line-height:1.35}',
    ].join('\n'), 'reelspot')

    // map core error messages to short inline Chinese warnings
    function warnText(e) {
      const m = String(e && e.message ? e.message : e)
      if (m.indexOf('webcam') >= 0) return '⚠️ 摄像头不可用，本次录制不含摄像头'
      if (m.indexOf('microphone') >= 0) return '⚠️ 麦克风不可用，本次录制无麦克风声音'
      if (m.indexOf('support') >= 0) return '⚠️ 当前浏览器不支持录屏'
      return '⚠️ ' + m.slice(0, 80)
    }

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
    // set by the mounted component so the global keyboard shortcut can reach it
    const shortcutToggleRef = { current: null }

    function ReelSpotButton() {
      const [state, setState] = React.useState('idle') // idle | countdown | recording | paused
      const [countNum, setCountNum] = React.useState(3)
      const [elapsed, setElapsed] = React.useState(0)
      const [micOn, setMicOn] = React.useState(true)
      const [zoomOn, setZoomOn] = React.useState(false)
      const [webcamOn, setWebcamOn] = React.useState(false)
      const [cursorFxOn, setCursorFxOn] = React.useState(false)
      const [items, setItems] = React.useState([])
      const [warn, setWarn] = React.useState('')
      const [panelOpen, setPanelOpen] = React.useState(false)
      const recRef = React.useRef(null)
      const startRef = React.useRef(false) // start-in-flight guard (picker open / countdown)
      const elapsedBaseRef = React.useRef(0)
      const micRef = React.useRef(true)
      const zoomRef = React.useRef(false)
      const webcamRef = React.useRef(false)
      const cursorFxRef = React.useRef(false)
      const itemsRef = React.useRef([])
      const stateRef = React.useRef('idle')
      micRef.current = micOn
      zoomRef.current = zoomOn
      webcamRef.current = webcamOn
      cursorFxRef.current = cursorFxOn
      itemsRef.current = items
      stateRef.current = state

      const patchItem = (id, patch) => {
        setItems((prev) => prev.map((it) => (it.id === id ? Object.assign({}, it, patch) : it)))
      }

      const start = async () => {
        if (startRef.current) return
        startRef.current = true
        const recorder = ReelSpot.createRecorder({
          mic: micRef.current,
          zoom: zoomRef.current,
          webcam: webcamRef.current,
          cursorFx: cursorFxRef.current,
          countdown: 3,
        })
        recRef.current = recorder
        recorder.on('countdown', (n) => setCountNum(n))
        recorder.on('stop', (result) => {
          recRef.current = null
          setState('idle')
          setElapsed(0)
          elapsedBaseRef.current = 0
          const item = {
            id: nextId++,
            name: result.name,
            ext: result.ext,
            blob: result.blob,
            url: URL.createObjectURL(result.blob),
            size: result.size,
            audioMode: result.audioMode,
            zoomed: result.zoomed,
            webcam: result.webcam,
            savedPath: '',
            saving: false,
            transcoding: false,
            transcodedPath: '',
            error: '',
          }
          setItems((prev) => [item].concat(prev))
          setPanelOpen(true)
        })
        recorder.on('state', (s) => {
          if (s === 'recording') setState('recording')
          else if (s === 'paused') {
            elapsedBaseRef.current = elapsedRefNow()
            setState('paused')
          } else if (s === 'countdown') setState('countdown')
          else if (s === 'idle') setState('idle')
        })
        recorder.on('error', (e) => {
          console.error('ReelSpot:', e && e.message ? e.message : e)
          setWarn(warnText(e))
          ctx.timeout(() => setWarn(''), 5000)
        })
        const begun = await recorder.start()
        if (!begun && recorder.getState() === 'idle') {
          recRef.current = null
          setState('idle')
        }
        startRef.current = false
      }

      const stop = () => {
        const recorder = recRef.current
        if (recorder) recorder.stop()
      }

      const pauseOrResume = () => {
        const recorder = recRef.current
        if (!recorder) return
        if (recorder.getState() === 'paused') recorder.resume()
        else recorder.pause()
      }

      let elapsedRefNow = () => elapsed
      React.useEffect(() => { elapsedRefNow = () => elapsed })

      React.useEffect(() => {
        if (state !== 'recording') return undefined
        const segStart = Date.now()
        return ctx.interval(() => {
          setElapsed(elapsedBaseRef.current + Math.floor((Date.now() - segStart) / 1000))
        }, 500)
      }, [state])

      React.useEffect(() => {
        shortcutToggleRef.current = () => {
          const s = stateRef.current
          if (s === 'recording' || s === 'paused' || s === 'countdown') stop()
          else start()
        }
        return () => { shortcutToggleRef.current = null }
      })

      React.useEffect(() => () => {
        const recorder = recRef.current
        if (recorder) { recRef.current = null; try { recorder.stop() } catch (e) {} }
        itemsRef.current.forEach((it) => { try { URL.revokeObjectURL(it.url) } catch (e) {} })
      }, [])

      const saveToWorkspace = async (item) => {
        patchItem(item.id, { saving: true, error: '' })
        try {
          const base64 = await toBase64(item.blob)
          const data = await host.call('save-recording', { name: item.name, base64 })
          if (data && data.ok) patchItem(item.id, { saving: false, savedPath: String(data.path || '') })
          else patchItem(item.id, { saving: false, error: '保存失败: ' + (data && data.error ? data.error : '未知错误') })
        } catch (e) {
          patchItem(item.id, { saving: false, error: '保存失败: ' + String(e && e.message ? e.message : e) })
        }
      }

      const transcode = async (item) => {
        patchItem(item.id, { transcoding: true, error: '' })
        try {
          const base64 = await toBase64(item.blob)
          const data = await host.call('transcode', { name: item.name, base64 })
          if (data && data.ok) patchItem(item.id, { transcoding: false, transcodedPath: String(data.path || '') })
          else patchItem(item.id, { transcoding: false, error: '转码失败: ' + (data && data.error ? data.error : '未知错误') })
        } catch (e) {
          patchItem(item.id, { transcoding: false, error: '转码失败: ' + String(e && e.message ? e.message : e) })
        }
      }

      const removeItem = (item) => {
        try { URL.revokeObjectURL(item.url) } catch (e) {}
        setItems((prev) => prev.filter((it) => it.id !== item.id))
      }

      const busy = state !== 'idle'
      const recording = state === 'recording'
      const paused = state === 'paused'
      const counting = state === 'countdown'

      const tog = (on, setOn, title, icon) => React.createElement('button', {
        className: 'reelspot-tog' + (on ? ' on' : ' off'),
        title,
        disabled: busy,
        onClick: () => setOn(!on),
      }, icon)

      const label = counting ? String(countNum)
        : (recording || paused)
          ? pad2(Math.floor(elapsed / 60)) + ':' + pad2(elapsed % 60)
          : '录屏'

      const mainButton = React.createElement('button', {
        className: 'reelspot-btn' + (recording ? ' recording' : '') + (paused ? ' paused' : '') + (counting ? ' countdown' : ''),
        title: counting ? '倒计时中，点击取消'
          : recording ? '停止录屏 (Alt+Shift+R)'
          : paused ? '已暂停，点击停止'
          : items.length
            ? '开始录屏 (Alt+Shift+R)；点击查看已录 ' + items.length + ' 段视频'
            : '开始录屏 (Alt+Shift+R)：选择屏幕 / 窗口 / 标签页',
        onClick: () => {
          if (counting) { stop(); return }
          if (recording || paused) { stop(); return }
          if (items.length && !panelOpen) { setPanelOpen(true); return }
          start()
        },
      },
        React.createElement('span', { className: 'reelspot-dot' }),
        label,
        !busy && items.length
          ? React.createElement('span', { className: 'reelspot-badge' }, String(items.length))
          : null,
      )

      const pauseButton = (recording || paused)
        ? React.createElement('button', {
            className: 'reelspot-tog',
            title: paused ? '继续录制' : '暂停录制',
            onClick: pauseOrResume,
          }, paused ? '▶' : '⏸')
        : null

      const panel = panelOpen && items.length
        ? React.createElement('div', { className: 'reelspot-panel' },
            React.createElement('div', { className: 'reelspot-panel-head' },
              React.createElement('span', null, '录制完成 (' + items.length + ')'),
              React.createElement('button', { className: 'reelspot-x', title: '关闭', onClick: () => setPanelOpen(false) }, '×'),
            ),
            items.map((it) => React.createElement('div', { className: 'reelspot-item', key: it.id },
              React.createElement('video', { className: 'reelspot-video', src: it.url, controls: true, preload: 'metadata' }),
              React.createElement('div', { className: 'reelspot-meta' },
                it.name + ' · ' + fmtSize(it.size) + ' · ' + audioText(it.audioMode)
                + (it.zoomed ? ' · 聚焦' : '') + (it.webcam ? ' · 摄像头' : '')),
              React.createElement('div', { className: 'reelspot-ops' },
                React.createElement('a', { className: 'reelspot-op', href: it.url, download: it.name }, '下载'),
                React.createElement('button', {
                  className: 'reelspot-op',
                  disabled: it.saving || !!it.savedPath,
                  onClick: () => saveToWorkspace(it),
                }, it.saving ? '保存中…' : it.savedPath ? '已存到工作区' : '存到工作区'),
                it.ext === 'webm'
                  ? React.createElement('button', {
                      className: 'reelspot-op',
                      disabled: it.transcoding || !!it.transcodedPath,
                      title: '需要主机安装 ffmpeg',
                      onClick: () => transcode(it),
                    }, it.transcoding ? '转码中…' : it.transcodedPath ? '已转 MP4' : '转 MP4')
                  : null,
                React.createElement('button', { className: 'reelspot-op', onClick: () => removeItem(it) }, '删除'),
              ),
              it.savedPath ? React.createElement('div', { className: 'reelspot-path' }, it.savedPath) : null,
              it.transcodedPath ? React.createElement('div', { className: 'reelspot-path' }, it.transcodedPath) : null,
              it.error ? React.createElement('div', { className: 'reelspot-err' }, it.error) : null,
            )),
          )
        : null

      return React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'reelspot-wrap' },
          tog(cursorFxOn, setCursorFxOn, cursorFxOn ? '光标高亮+点击波纹：开（仅录本标签页时跟踪）' : '光标高亮+点击波纹：关（点击开启）', '🖱️'),
          tog(zoomOn, setZoomOn, zoomOn ? '放大聚焦：开（录制中 Alt+滚轮调倍数，滚到 1× 看整页；点击关闭）' : '放大聚焦：关（点击开启，光标移动自动跟随放大）', '🔍'),
          tog(webcamOn, setWebcamOn, webcamOn ? '摄像头气泡：开（点击关闭）' : '摄像头气泡：关（点击开启）', '📹'),
          tog(micOn, setMicOn, micOn ? '麦克风：开（点击关闭）' : '麦克风：关（点击开启）', '🎤'),
          pauseButton,
          mainButton,
          warn ? React.createElement('span', { className: 'reelspot-warn' }, warn) : null,
        ),
        panel,
      )
    }

    // global keyboard shortcut: Alt+Shift+R toggles recording
    ctx.effect(() => {
      const handler = (e) => {
        if (e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
          e.preventDefault()
          if (shortcutToggleRef.current) shortcutToggleRef.current()
        }
      }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }, 'reelspot: shortcut')

    slots.inject('conversation.session.header.actions', () => slots.register(
      { name: 'conversation.session.header.actions', id: 'reelspot', order: 30, label: 'ReelSpot 录屏' },
      () => React.createElement(ReelSpotButton),
    ))
  },
}
