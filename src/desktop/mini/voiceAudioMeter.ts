/** An optional observer of the existing Voice stream. Never requests a microphone. */
export function observeVoiceAudio(stream: MediaStream, publish: (level: number) => void): () => void {
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  const stop = () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    try { source?.disconnect() } catch { /* Voice owns the stream lifetime. */ }
    if (context) void context.close().catch(() => {})
  }
  try {
    context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source = context.createMediaStreamSource(stream)
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    void context.resume().catch(() => {})
    timer = setInterval(() => {
      if (!stream.active) { stop(); return }
      try {
        analyser.getByteTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length)
        publish(Math.min(1, rms * 5))
      } catch { stop() }
    }, 80)
  } catch { stop() }
  return stop
}
