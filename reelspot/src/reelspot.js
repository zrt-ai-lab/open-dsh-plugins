/*
 * ReelSpot core — zero-dependency browser screen recorder.
 *
 * Screen / window / tab capture + microphone mixing + webcam bubble +
 * cursor-follow zoom + cursor highlight/click ripples + countdown +
 * pause/resume + MP4 (H.264/AAC) output with WebM fallback.
 *
 * Plain script, no imports/exports:
 *   - Browser <script>: sets window.ReelSpot
 *   - Node-like loader: module.exports
 *   - DSH build (build.mjs): the marked core region is inlined into plugins
 */
const ReelSpot = (() => {
  // __CORE_BEGIN__
  const MIME_CANDIDATES = [
    { mime: 'video/mp4;codecs=avc1.64001f,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ]

  const DEFAULTS = {
    mic: true,               // request the microphone and mix it in
    webcam: false,           // webcam bubble overlay (needs the compose pipe)
    webcamSize: 0.18,        // bubble diameter as a fraction of frame width
    webcamPosition: 'bottom-right', // bottom-right | bottom-left | top-right | top-left
    webcamMirror: true,      // mirror the webcam (self-view convention)
    zoom: false,             // cursor-follow zoom pipeline (canvas)
    zoomFactor: 1.8,         // magnification while the cursor is active
    zoomIdleMs: 2000,        // idle delay before zooming back out
    zoomWheel: true,         // Alt+mouse-wheel adjusts the zoom factor live (1x = full view)
    zoomMax: 3.5,            // wheel-adjustable zoom ceiling
    zoomStep: 0.2,           // wheel step per notch
    zoomMinimap: true,       // viewport minimap + factor badge while zoomed in
    operatorPreview: true,   // live "what is being recorded" monitor window (see below)
    previewWindow: null,     // optional Document PiP window handed in by the caller
    // Operator preview: callers with a user gesture should open
    // `documentPictureInPicture.requestWindow()` at click time and pass it as
    // previewWindow — the core pipes the composed canvas into it, so the
    // operator sees the exact recorded frame live. A Document PiP window is a
    // separate top-level window: it is NOT captured when recording this tab.
    cursorFx: false,         // cursor highlight ring + click ripples (this-tab only)
    countdown: 3,            // seconds before recording starts (0 = off)
    frameRate: 30,
    maxWidth: 1920,          // compose-pipeline canvas width cap
    videoBitsPerSecond: 6000000,
    audioBitsPerSecond: 192000,
    filePrefix: 'reelspot',
  }

  function isSupported() {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getDisplayMedia === 'function'
      && typeof MediaRecorder !== 'undefined'
  }

  /** Pick the best recording container: MP4 (Chrome/Edge 126+) first, WebM fallback. */
  function pickFormat() {
    if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' }
    for (const c of MIME_CANDIDATES) {
      try { if (MediaRecorder.isTypeSupported(c.mime)) return c } catch (e) { /* keep looking */ }
    }
    return { mime: '', ext: 'webm' }
  }

  function stopStream(stream) {
    if (!stream) return
    try { stream.getTracks().forEach((t) => { try { t.stop() } catch (e) {} }) } catch (e) {}
  }

  function pad2(n) { return String(n).padStart(2, '0') }

  function defaultName(prefix, ext, startedAt) {
    const d = new Date(startedAt)
    return prefix + '-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.' + ext
  }

  function makeHiddenVideo(stream) {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.style.display = 'none'
    video.srcObject = stream
    document.body.append(video)
    return video
  }

  /**
   * Compose pipeline: display track (+ optional webcam) -> hidden <video>s ->
   * canvas (zoom transform, webcam bubble, cursor fx) -> captureStream.
   *
   * The cursor position is only knowable while the pointer is over THIS page,
   * so cursor-follow zoom and cursor fx only track when recording this tab;
   * for other windows the view stays at the wide shot (browser limitation).
   */
  async function createComposePipe(display, opts) {
    const srcTrack = display.getVideoTracks()[0]
    if (!srcTrack) return null
    let w = 1920
    let h = 1080
    try {
      const s = srcTrack.getSettings ? srcTrack.getSettings() : {}
      if (s.width && s.height) { w = s.width; h = s.height }
    } catch (e) {}
    const scale = Math.min(1, opts.maxWidth / w)
    w = Math.max(2, Math.round(w * scale))
    h = Math.max(2, Math.round(h * scale))

    const video = makeHiddenVideo(new MediaStream([srcTrack]))
    try { await video.play() } catch (e) {}

    // webcam bubble source
    let cam = null
    let camVideo = null
    if (opts.webcam) {
      try {
        cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280 }, audio: false })
        camVideo = makeHiddenVideo(cam)
        try { await camVideo.play() } catch (e) {}
      } catch (e) {
        cam = null // webcam denied/unavailable — record without it
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) {
      video.remove()
      stopStream(cam)
      if (camVideo) camVideo.remove()
      return null
    }

    const st = {
      zoom: 1, tzoom: 1, factor: opts.zoomFactor, factorAt: 0,
      cx: w / 2, cy: h / 2, tx: w / 2, ty: h / 2,
      lastMove: 0, cursorX: null, cursorY: null, ripples: [],
    }
    const toSource = (ev) => {
      const iw = (typeof window !== 'undefined' && window.innerWidth) || w
      const ih = (typeof window !== 'undefined' && window.innerHeight) || h
      return [(ev.clientX / iw) * w, (ev.clientY / ih) * h]
    }
    const onMove = (ev) => {
      const [sx, sy] = toSource(ev)
      st.tx = sx
      st.ty = sy
      st.cursorX = sx
      st.cursorY = sy
      st.tzoom = st.factor
      st.lastMove = Date.now()
    }
    // Alt+wheel: live zoom-factor control — down to 1x for the full page,
    // up towards zoomMax for a closer follow (this-tab only, like the cursor)
    const onWheel = (ev) => {
      if (!ev.altKey) return
      ev.preventDefault()
      const dir = ev.deltaY < 0 ? 1 : -1
      st.factor = Math.min(opts.zoomMax, Math.max(1, Math.round((st.factor + dir * opts.zoomStep) * 10) / 10))
      st.tzoom = st.factor
      st.lastMove = Date.now()
      st.factorAt = Date.now()
    }
    const onDown = (ev) => {
      const [sx, sy] = toSource(ev)
      st.ripples.push({ x: sx, y: sy, t: Date.now() })
      if (st.ripples.length > 12) st.ripples.shift()
    }
    const onLeave = () => { st.cursorX = null; st.cursorY = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseleave', onLeave)
    if (opts.zoomWheel) document.addEventListener('wheel', onWheel, { passive: false })

    const pipe = { video, camVideo, cam, canvas, raf: 0, stream: null, dead: false, detach: null }
    pipe.detach = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseleave', onLeave)
      if (opts.zoomWheel) document.removeEventListener('wheel', onWheel)
    }

    const draw = () => {
      if (pipe.dead) return
      if (Date.now() - st.lastMove > opts.zoomIdleMs) st.tzoom = 1
      st.zoom += (st.tzoom - st.zoom) * 0.08
      st.cx += (st.tx - st.cx) * 0.12
      st.cy += (st.ty - st.cy) * 0.12
      const vw = w / st.zoom
      const vh = h / st.zoom
      const cx = Math.min(Math.max(st.cx, vw / 2), w - vw / 2)
      const cy = Math.min(Math.max(st.cy, vh / 2), h - vh / 2)
      const sx0 = cx - vw / 2
      const sy0 = cy - vh / 2
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      try { g.drawImage(video, sx0, sy0, vw, vh, 0, 0, w, h) } catch (e) {}

      // webcam bubble
      if (camVideo) {
        const diameter = Math.round(w * opts.webcamSize)
        const radius = diameter / 2
        const margin = Math.round(diameter * 0.25)
        const bx = opts.webcamPosition.indexOf('left') >= 0 ? margin + radius : w - margin - radius
        const by = opts.webcamPosition.indexOf('top') >= 0 ? margin + radius : h - margin - radius
        const cw = camVideo.videoWidth || 1280
        const ch = camVideo.videoHeight || 720
        const crop = Math.min(cw, ch)
        g.save()
        g.beginPath()
        g.arc(bx, by, radius, 0, Math.PI * 2)
        g.closePath()
        g.clip()
        g.fillStyle = '#000'
        g.fillRect(bx - radius, by - radius, diameter, diameter)
        if (opts.webcamMirror) {
          g.translate(bx, by)
          g.scale(-1, 1)
          g.translate(-bx, -by)
        }
        try { g.drawImage(camVideo, (cw - crop) / 2, (ch - crop) / 2, crop, crop, bx - radius, by - radius, diameter, diameter) } catch (e) {}
        g.restore()
        g.beginPath()
        g.arc(bx, by, radius, 0, Math.PI * 2)
        g.lineWidth = Math.max(2, Math.round(diameter * 0.03))
        g.strokeStyle = 'rgba(255,255,255,.9)'
        g.stroke()
      }

      // zoom minimap: full-page thumbnail + viewport marker + factor badge,
      // drawn while zoomed in so the operator (and viewers) can see which
      // region of the page the video currently shows
      if (opts.zoomMinimap && st.zoom > 1.02) {
        const mw = Math.round(w * 0.14)
        const mh = Math.round(h * 0.14)
        const mm = Math.max(10, Math.round(mw * 0.18))
        const mx = opts.webcamPosition === 'top-right' && camVideo ? mm : w - mm - mw
        const my = mm
        g.globalAlpha = 0.85
        g.fillStyle = '#000'
        g.fillRect(mx - 2, my - 2, mw + 4, mh + 4)
        try { g.drawImage(video, mx, my, mw, mh) } catch (e) {}
        g.globalAlpha = 1
        g.lineWidth = 2
        g.strokeStyle = 'rgba(255,255,255,.55)'
        g.strokeRect(mx - 2, my - 2, mw + 4, mh + 4)
        g.strokeStyle = 'rgba(255,213,74,.95)'
        g.strokeRect(mx + (sx0 / w) * mw, my + (sy0 / h) * mh, (vw / w) * mw, (vh / h) * mh)
        // factor badge, briefly after wheel adjustments
        if (Date.now() - st.factorAt < 1500) {
          const label = st.factor.toFixed(1) + '×'
          g.font = 'bold ' + Math.max(14, Math.round(mw * 0.22)) + 'px system-ui, sans-serif'
          const tw = g.measureText(label).width
          g.fillStyle = 'rgba(0,0,0,.65)'
          g.fillRect(mx + mw - tw - 14, my + mh - 26, tw + 12, 24)
          g.fillStyle = '#ffd54a'
          g.fillText(label, mx + mw - tw - 8, my + mh - 8)
        }
      }

      // cursor fx: highlight ring + click ripples (mapped through the zoom transform)
      if (opts.cursorFx) {
        const mapX = (x) => (x - sx0) * st.zoom
        const mapY = (y) => (y - sy0) * st.zoom
        if (st.cursorX !== null) {
          g.beginPath()
          g.arc(mapX(st.cursorX), mapY(st.cursorY), 14 * st.zoom, 0, Math.PI * 2)
          g.lineWidth = 3
          g.strokeStyle = 'rgba(255,213,74,.95)'
          g.stroke()
        }
        const now = Date.now()
        st.ripples = st.ripples.filter((r) => now - r.t < 600)
        for (const r of st.ripples) {
          const t = (now - r.t) / 600
          g.beginPath()
          g.arc(mapX(r.x), mapY(r.y), (8 + t * 46) * st.zoom, 0, Math.PI * 2)
          g.lineWidth = 3 * (1 - t) + 1
          g.strokeStyle = 'rgba(255,213,74,' + (0.9 * (1 - t)).toFixed(3) + ')'
          g.stroke()
        }
      }

      pipe.raf = requestAnimationFrame(draw)
    }
    pipe.raf = requestAnimationFrame(draw)
    try { pipe.stream = canvas.captureStream(opts.frameRate) } catch (e) { pipe.stream = null }
    if (!pipe.stream) { destroyComposePipe(pipe); return null }

    // operator preview: pipe the composed canvas into the Document PiP window
    if (opts.operatorPreview && opts.previewWindow) {
      try {
        const doc = opts.previewWindow.document
        doc.body.style.margin = '0'
        doc.body.style.background = '#000'
        const pv = doc.createElement('video')
        pv.muted = true
        pv.autoplay = true
        pv.playsInline = true
        pv.style.cssText = 'width:100%;height:100%;display:block'
        pv.srcObject = pipe.stream
        doc.body.append(pv)
        pv.play().catch(() => {})
        pipe.previewWin = opts.previewWindow
        opts.previewWindow.addEventListener('pagehide', () => { pipe.previewWin = null })
      } catch (e) { /* preview is best-effort */ }
    }
    return pipe
  }

  function closePreviewWindow(win) {
    if (!win) return
    try { win.close() } catch (e) {}
  }

  function destroyComposePipe(pipe) {
    if (!pipe) return
    pipe.dead = true
    try { cancelAnimationFrame(pipe.raf) } catch (e) {}
    try { pipe.detach() } catch (e) {}
    closePreviewWindow(pipe.previewWin)
    stopStream(pipe.stream)
    stopStream(pipe.cam)
    try { pipe.video.srcObject = null; pipe.video.remove() } catch (e) {}
    if (pipe.camVideo) { try { pipe.camVideo.srcObject = null; pipe.camVideo.remove() } catch (e) {} }
  }

  /**
   * Create a recorder instance.
   *
   * @param {object} [options] see DEFAULTS
   * @returns {{
   *   start: () => Promise<{audioMode:string, zoomed:boolean, webcam:boolean, ext:string, mime:string} | null>,
   *   stop: () => void,
   *   pause: () => void,
   *   resume: () => void,
   *   getState: () => 'idle' | 'countdown' | 'recording' | 'paused',
   *   on: (event: 'state' | 'countdown' | 'stop' | 'error', fn: Function) => () => void,
   * }}
   *
   * Events:
   *   'state'    -> 'idle' | 'countdown' | 'recording' | 'paused'
   *   'countdown'-> remaining whole seconds (3, 2, 1)
   *   'stop'     -> { blob, size, name, ext, mime, audioMode, zoomed, webcam, startedAt, durationMs }
   *   'error'    -> Error (non-fatal, e.g. mic denied)
   *
   * start() resolves null when the user cancels the share picker or the countdown.
   * stop() during the countdown cancels the recording.
   * audioMode: 'system+mic' | 'system' | 'mic' | 'none'
   *   ('system' = tab/system audio from getDisplayMedia; on Windows Chrome it is
   *   only available for tab capture — that is a browser limitation.)
   */
  function createRecorder(options) {
    const opts = Object.assign({}, DEFAULTS, options || {})
    const listeners = { state: [], countdown: [], stop: [], error: [] }
    const emit = (ev, arg) => {
      listeners[ev].slice().forEach((fn) => { try { fn(arg) } catch (e) {} })
    }
    let active = null
    let starting = false

    function cleanupCapture(rec) {
      destroyComposePipe(rec.pipe)
      stopStream(rec.display)
      stopStream(rec.mic)
      if (rec.audioCtx) { try { rec.audioCtx.close() } catch (e) {} }
    }

    function netDurationMs(rec) {
      const end = rec.phase === 'paused' && rec.pausedAt ? rec.pausedAt : Date.now()
      return Math.max(0, end - rec.recordStartedAt - rec.pausedMs)
    }

    function finalize() {
      const rec = active
      if (!rec) return
      active = null
      cleanupCapture(rec)
      const blob = new Blob(rec.chunks, { type: rec.mime || ('video/' + rec.ext) })
      emit('state', 'idle')
      if (!blob.size) return
      emit('stop', {
        blob,
        size: blob.size,
        name: defaultName(opts.filePrefix, rec.ext, rec.startedAt),
        ext: rec.ext,
        mime: rec.mime,
        audioMode: rec.audioMode,
        zoomed: rec.zoomed,
        webcam: !!rec.webcam,
        startedAt: rec.startedAt,
        durationMs: netDurationMs(rec),
      })
    }

    // rAF-based countdown (no timers — safe inside every sandbox)
    function countdownWait(seconds, rec) {
      return new Promise((resolve) => {
        const start = Date.now()
        let last = -1
        const tick = () => {
          if (rec.cancelled) { resolve(false); return }
          const elapsed = (Date.now() - start) / 1000
          const remaining = Math.ceil(seconds - elapsed)
          if (elapsed >= seconds) { resolve(true); return }
          if (remaining !== last) { last = remaining; emit('countdown', remaining) }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    }

    // re-entry lock: start() is async and `active` is only set AFTER the
    // share picker resolves — a second call during that window would open
    // another picker and tear down the first pipeline
    async function start() {
      if (active || starting) return null
      starting = true
      try {
        return await startInner()
      } finally {
        starting = false
      }
    }

    async function startInner() {
      if (active) return null
      if (!isSupported()) {
        emit('error', new Error('ReelSpot: this browser does not support screen capture'))
        return null
      }
      let display
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: opts.frameRate },
          audio: true,
        })
      } catch (e) {
        return null // user cancelled the share picker
      }

      let mic = null
      if (opts.mic) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
        } catch (e) {
          emit('error', new Error('ReelSpot: microphone unavailable, recording without it'))
        }
      }

      const needsPipe = !!(opts.zoom || opts.cursorFx || opts.webcam)
      let pipe = null
      if (needsPipe) {
        try { pipe = await createComposePipe(display, opts) } catch (e) { pipe = null }
      }
      if (opts.webcam && (!pipe || !pipe.cam)) {
        emit('error', new Error('ReelSpot: webcam unavailable, recording without it'))
      }
      if (!pipe || !pipe.stream) closePreviewWindow(opts.previewWindow)

      const hasSysAudio = display.getAudioTracks().length > 0
      const recordStream = new MediaStream()
      if (pipe && pipe.stream) pipe.stream.getVideoTracks().forEach((t) => recordStream.addTrack(t))
      else display.getVideoTracks().forEach((t) => recordStream.addTrack(t))

      let audioCtx = null
      let audioMode = 'none'
      if (mic && hasSysAudio && typeof AudioContext !== 'undefined') {
        try {
          audioCtx = new AudioContext()
          if (audioCtx.resume) audioCtx.resume()
          const dest = audioCtx.createMediaStreamDestination()
          audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest)
          audioCtx.createMediaStreamSource(mic).connect(dest)
          dest.stream.getAudioTracks().forEach((t) => recordStream.addTrack(t))
          audioMode = 'system+mic'
        } catch (e) {
          display.getAudioTracks().forEach((t) => recordStream.addTrack(t))
          audioMode = 'system'
        }
      } else if (mic) {
        mic.getAudioTracks().forEach((t) => recordStream.addTrack(t))
        audioMode = 'mic'
      } else if (hasSysAudio) {
        display.getAudioTracks().forEach((t) => recordStream.addTrack(t))
        audioMode = 'system'
      }

      const format = pickFormat()
      let recorder
      try {
        recorder = new MediaRecorder(recordStream, format.mime
          ? { mimeType: format.mime, videoBitsPerSecond: opts.videoBitsPerSecond, audioBitsPerSecond: opts.audioBitsPerSecond }
          : undefined)
      } catch (e) {
        destroyComposePipe(pipe)
        stopStream(display)
        stopStream(mic)
        if (audioCtx) { try { audioCtx.close() } catch (e2) {} }
        emit('error', e)
        return null
      }

      const rec = {
        recorder, display, mic, audioCtx, pipe,
        chunks: [], mime: format.mime, ext: format.ext,
        startedAt: Date.now(), recordStartedAt: 0,
        audioMode, zoomed: !!(pipe && pipe.stream && opts.zoom),
        webcam: !!(pipe && pipe.cam),
        phase: 'countdown', cancelled: false,
        pausedMs: 0, pausedAt: 0,
      }
      active = rec
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data) }
      recorder.onstop = () => finalize()
      const vt = display.getVideoTracks()[0]
      if (vt) vt.onended = () => stop() // browser "stop sharing" UI

      // countdown before the recorder starts rolling
      if (opts.countdown > 0) {
        emit('state', 'countdown')
        const proceed = await countdownWait(opts.countdown, rec)
        if (!proceed || active !== rec) {
          if (active === rec) active = null
          cleanupCapture(rec)
          emit('state', 'idle')
          return null
        }
      }

      recorder.start(1000)
      rec.recordStartedAt = Date.now()
      rec.phase = 'recording'
      emit('state', 'recording')
      return { audioMode, zoomed: rec.zoomed, webcam: rec.webcam, ext: format.ext, mime: format.mime }
    }

    function stop() {
      const rec = active
      if (!rec) return
      if (rec.phase === 'countdown') { rec.cancelled = true; return }
      try { rec.recorder.stop() } catch (e) { finalize() } // onstop -> finalize
    }

    function pause() {
      const rec = active
      if (!rec || rec.phase !== 'recording') return
      try {
        rec.recorder.pause()
        rec.phase = 'paused'
        rec.pausedAt = Date.now()
        emit('state', 'paused')
      } catch (e) {}
    }

    function resume() {
      const rec = active
      if (!rec || rec.phase !== 'paused') return
      try {
        rec.recorder.resume()
        rec.pausedMs += Date.now() - rec.pausedAt
        rec.pausedAt = 0
        rec.phase = 'recording'
        emit('state', 'recording')
      } catch (e) {}
    }

    function getState() { return active ? active.phase : 'idle' }

    function on(ev, fn) {
      if (!listeners[ev] || typeof fn !== 'function') return () => {}
      listeners[ev].push(fn)
      return () => {
        const i = listeners[ev].indexOf(fn)
        if (i >= 0) listeners[ev].splice(i, 1)
      }
    }

    return { start, stop, pause, resume, getState, on }
  }

  return { createRecorder, pickFormat, isSupported }
  // __CORE_END__
})()
if (typeof module !== 'undefined' && module.exports) module.exports = ReelSpot
if (typeof window !== 'undefined') window.ReelSpot = ReelSpot
