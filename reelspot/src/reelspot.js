/*
 * ReelSpot core — zero-dependency browser screen recorder.
 *
 * Screen / window / tab capture + microphone mixing + cursor-follow zoom
 * + MP4 (H.264/AAC) output with WebM fallback.
 *
 * Plain script, no imports/exports:
 *   - Browser <script>: sets window.ReelSpot
 *   - Node-like loader: module.exports
 *   - DSH build (build.mjs): the marked core region is inlined into the plugin
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
    zoom: false,             // cursor-follow zoom pipeline (canvas)
    zoomFactor: 1.8,         // magnification while the cursor is active
    zoomIdleMs: 2000,        // idle delay before zooming back out
    frameRate: 30,
    maxWidth: 1920,          // zoom-pipeline canvas width cap
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

  /**
   * Canvas zoom pipeline: display track -> hidden <video> -> zoomed canvas -> captureStream.
   * The cursor position is only knowable while the pointer is over THIS page, so
   * cursor-follow zoom works when recording this tab; for other windows the view
   * simply stays at the wide shot (browser limitation, not a bug).
   */
  async function createZoomPipe(display, opts) {
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

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.style.display = 'none'
    video.srcObject = new MediaStream([srcTrack])
    document.body.append(video)
    try { await video.play() } catch (e) {}

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) { video.remove(); return null }

    const st = { zoom: 1, tzoom: 1, cx: w / 2, cy: h / 2, tx: w / 2, ty: h / 2, lastMove: 0 }
    const onMove = (ev) => {
      const iw = (typeof window !== 'undefined' && window.innerWidth) || w
      const ih = (typeof window !== 'undefined' && window.innerHeight) || h
      st.tx = (ev.clientX / iw) * w
      st.ty = (ev.clientY / ih) * h
      st.tzoom = opts.zoomFactor
      st.lastMove = Date.now()
    }
    document.addEventListener('mousemove', onMove)

    const pipe = { video, canvas, raf: 0, onMove, stream: null, dead: false }
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
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      try { g.drawImage(video, cx - vw / 2, cy - vh / 2, vw, vh, 0, 0, w, h) } catch (e) {}
      pipe.raf = requestAnimationFrame(draw)
    }
    pipe.raf = requestAnimationFrame(draw)
    try { pipe.stream = canvas.captureStream(opts.frameRate) } catch (e) { pipe.stream = null }
    if (!pipe.stream) { destroyZoomPipe(pipe); return null }
    return pipe
  }

  function destroyZoomPipe(pipe) {
    if (!pipe) return
    pipe.dead = true
    try { cancelAnimationFrame(pipe.raf) } catch (e) {}
    try { document.removeEventListener('mousemove', pipe.onMove) } catch (e) {}
    stopStream(pipe.stream)
    try { pipe.video.srcObject = null; pipe.video.remove() } catch (e) {}
  }

  /**
   * Create a recorder instance.
   *
   * @param {object} [options] see DEFAULTS
   * @returns {{
   *   start: () => Promise<{audioMode:string, zoomed:boolean, ext:string, mime:string} | null>,
   *   stop: () => void,
   *   getState: () => 'idle' | 'recording',
   *   on: (event: 'state' | 'stop' | 'error', fn: Function) => () => void,
   * }}
   *
   * Events:
   *   'state' -> 'idle' | 'recording'
   *   'stop'  -> { blob, size, name, ext, mime, audioMode, zoomed, startedAt, durationMs }
   *   'error' -> Error
   *
   * start() resolves null when the user cancels the share picker.
   * audioMode: 'system+mic' | 'system' | 'mic' | 'none'
   *   ('system' = tab/system audio from getDisplayMedia; on Windows Chrome it is
   *   only available for tab capture — that is a browser limitation.)
   */
  function createRecorder(options) {
    const opts = Object.assign({}, DEFAULTS, options || {})
    const listeners = { state: [], stop: [], error: [] }
    const emit = (ev, arg) => {
      listeners[ev].slice().forEach((fn) => { try { fn(arg) } catch (e) {} })
    }
    let active = null

    function cleanupCapture(rec) {
      destroyZoomPipe(rec.pipe)
      stopStream(rec.display)
      stopStream(rec.mic)
      if (rec.audioCtx) { try { rec.audioCtx.close() } catch (e) {} }
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
        startedAt: rec.startedAt,
        durationMs: Date.now() - rec.startedAt,
      })
    }

    async function start() {
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

      let pipe = null
      if (opts.zoom) {
        try { pipe = await createZoomPipe(display, opts) } catch (e) { pipe = null }
      }

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
        destroyZoomPipe(pipe)
        stopStream(display)
        stopStream(mic)
        if (audioCtx) { try { audioCtx.close() } catch (e2) {} }
        emit('error', e)
        return null
      }

      const rec = {
        recorder, display, mic, audioCtx, pipe,
        chunks: [], mime: format.mime, ext: format.ext,
        startedAt: Date.now(), audioMode, zoomed: !!(pipe && pipe.stream),
      }
      active = rec
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data) }
      recorder.onstop = () => finalize()
      const vt = display.getVideoTracks()[0]
      if (vt) vt.onended = () => stop() // browser "stop sharing" UI
      recorder.start(1000)
      emit('state', 'recording')
      return { audioMode, zoomed: rec.zoomed, ext: format.ext, mime: format.mime }
    }

    function stop() {
      const rec = active
      if (!rec) return
      try { rec.recorder.stop() } catch (e) { finalize() } // onstop -> finalize
    }

    function getState() { return active ? 'recording' : 'idle' }

    function on(ev, fn) {
      if (!listeners[ev] || typeof fn !== 'function') return () => {}
      listeners[ev].push(fn)
      return () => {
        const i = listeners[ev].indexOf(fn)
        if (i >= 0) listeners[ev].splice(i, 1)
      }
    }

    return { start, stop, getState, on }
  }

  return { createRecorder, pickFormat, isSupported }
  // __CORE_END__
})()
if (typeof module !== 'undefined' && module.exports) module.exports = ReelSpot
if (typeof window !== 'undefined') window.ReelSpot = ReelSpot
