import { useEffect, useRef, useState } from 'react'
import { clearWakeEnrollment, saveWakeEnrollmentSample } from './desktopBridge'

const SAMPLE_TOTAL = 60

function instructionFor(index: number) {
  if (index < 10) return 'Voz normal, a unos 30 cm del Mac.'
  if (index < 20) return 'Voz normal, a aproximadamente 1 metro del Mac.'
  if (index < 28) return 'Voz baja, en una habitación silenciosa.'
  if (index < 34) return 'Con música o YouTube de fondo a volumen moderado.'
  if (index < 40) return 'Voz normal, en condiciones cotidianas.'
  if (index < 50) return 'Validación: voz normal, a una distancia distinta.'
  return 'Validación: voz baja o con ruido moderado de fondo.'
}

export function WakeEnrollment({ onComplete }: { onComplete: () => void }) {
  const [runId] = useState(() => crypto.randomUUID())
  const [sampleIndex, setSampleIndex] = useState(0)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('No se almacena ni se envía audio hasta que pulses “Grabar”.')
  const recorder = useRef<{ stop: () => Promise<void> } | undefined>(undefined)

  useEffect(() => () => { void recorder.current?.stop() }, [])

  const record = async () => {
    if (recording || sampleIndex >= SAMPLE_TOTAL) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(2048, 1, 1)
      const chunks: Float32Array[] = []
      let settled = false
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        chunks.push(input.slice())
        event.outputBuffer.getChannelData(0).fill(0)
      }
      source.connect(processor)
      processor.connect(context.destination)
      const stop = async () => {
        if (settled) return
        settled = true
        processor.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop())
        await context.close().catch(() => undefined)
        const audio = join(chunks)
        const wav = encodeWav(resample(audio, context.sampleRate, 16_000), 16_000)
        await saveWakeEnrollmentSample(runId, sampleIndex, Array.from(wav))
        setSampleIndex((value) => value + 1)
        setRecording(false)
        setMessage(sampleIndex + 1 === SAMPLE_TOTAL ? 'Las 60 muestras locales están listas para el entrenamiento y la validación.' : 'Muestra guardada localmente. Continúa cuando estés listo.')
      }
      recorder.current = { stop }
      setRecording(true)
      setMessage('Di una sola vez “FARO”. La muestra se detendrá en 2.6 segundos.')
      window.setTimeout(() => { void stop() }, 2_600)
    } catch (error) {
      setRecording(false)
      setMessage(error instanceof Error ? error.message : 'No se pudo abrir el micrófono.')
    }
  }

  const discard = async () => {
    await clearWakeEnrollment(runId)
    setSampleIndex(0)
    setMessage('Las muestras de este enrollment se eliminaron de este Mac.')
  }

  return <div className="desktop-enrollment">
    <p><strong>Enrollment local de “FARO”</strong><span>Di la palabra exactamente <b>60 veces</b>: 40 para entrenar y 20 reservadas para validar. Ningún audio sale de FARO.app y no se conserva después del entrenamiento.</span></p>
    {sampleIndex < SAMPLE_TOTAL ? <div className="desktop-enrollment__step"><span>Muestra {sampleIndex + 1} de {SAMPLE_TOTAL}</span><small>{instructionFor(sampleIndex)}</small><button type="button" disabled={recording} onClick={() => void record()}>{recording ? 'Grabando…' : 'Grabar “FARO”'}</button></div> : <button type="button" onClick={onComplete}>Preparar entrenamiento local</button>}
    <small>{message}</small>
    {sampleIndex > 0 && sampleIndex < SAMPLE_TOTAL && <button className="desktop-enrollment__discard" type="button" disabled={recording} onClick={() => void discard()}>Descartar estas muestras</button>}
  </div>
}

function join(chunks: Float32Array[]) { const size = chunks.reduce((total, chunk) => total + chunk.length, 0); const output = new Float32Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length } return output }
function resample(input: Float32Array, sourceRate: number, targetRate: number) { if (sourceRate === targetRate) return input; const output = new Float32Array(Math.round(input.length * targetRate / sourceRate)); const ratio = sourceRate / targetRate; for (let index = 0; index < output.length; index += 1) { const at = index * ratio; const before = Math.floor(at); const after = Math.min(before + 1, input.length - 1); output[index] = input[before] * (1 - (at - before)) + input[after] * (at - before) } return output }
function encodeWav(samples: Float32Array, sampleRate: number) { const bytes = new Uint8Array(44 + samples.length * 2); const view = new DataView(bytes.buffer); view.setUint32(0, 0x52494646, false); view.setUint32(4, bytes.length - 8, true); view.setUint32(8, 0x57415645, false); view.setUint32(12, 0x666d7420, false); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(36, 0x64617461, false); view.setUint32(40, samples.length * 2, true); for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * 0x7fff, true); return bytes }
