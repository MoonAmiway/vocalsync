import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Download, Settings, Volume2, Sliders, Radio, Timer, Zap } from 'lucide-react'
import localforage from 'localforage'

// Инициализация локального хранилища (IndexedDB)
localforage.config({ name: 'VocalSync', version: 1.0, storeName: 'settings' })

export default function Recorder() {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [processing, setProcessing] = useState(false)
  
  // Настройки эффектов (Загружаем из памяти при старте)
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 })
  const [master, setMaster] = useState(1)
  const [reverbMix, setReverbMix] = useState(0)
  const [delayTime, setDelayTime] = useState(0.3)
  const [delayFeedback, setDelayFeedback] = useState(0.4)
  const [delayMix, setDelayMix] = useState(0)
  const [distortion, setDistortion] = useState(0)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const animRef = useRef<number>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  
  // Ссылка на Worker
  const workerRef = useRef<Worker | null>(null)

  // --- Инициализация Worker и Загрузка настроек ---
  useEffect(() => {
    // 1. Запуск Worker
    workerRef.current = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
    
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'success') {
        const url = URL.createObjectURL(e.data.blob)
        setAudioURL(url)
        setProcessing(false)
      } else if (e.data.type === 'error') {
        alert('Ошибка обработки: ' + e.data.message)
        setProcessing(false)
      }
    }

    // 2. Загрузка сохраненных настроек
    localforage.getItem('lastSettings').then((saved: any) => {
      if (saved) {
        setEq(saved.eq || { low: 0, mid: 0, high: 0 })
        setMaster(saved.master || 1)
        setReverbMix(saved.reverbMix || 0)
        setDelayTime(saved.delayTime || 0.3)
        setDelayFeedback(saved.delayFeedback || 0.4)
        setDelayMix(saved.delayMix || 0)
        setDistortion(saved.distortion || 0)
      }
    })

    return () => workerRef.current?.terminate()
  }, [])

  // --- Визуализация ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const w = rect.width, h = rect.height

    const drawIdle = () => {
      ctx.fillStyle = '#0F0F1B'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#1F1F3A'
      for(let i=1; i<4; i++) { ctx.beginPath(); ctx.moveTo(0, h*i/4); ctx.lineTo(w, h*i/4); ctx.stroke() }
      ctx.strokeStyle = '#7B61FF40'; ctx.lineWidth = 2; ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#6B7280'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('🎙️ Готов к записи', w/2, h/2 - 8)
    }

    const drawActive = (data: Uint8Array) => {
      ctx.fillStyle = '#0F0F1B'; ctx.fillRect(0, 0, w, h)
      const barW = w / data.length * 2.5; let x = 0
      for (let i = 0; i < data.length; i++) {
        const barH = (data[i] / 255) * h
        const g = ctx.createLinearGradient(0, h, 0, 0)
        g.addColorStop(0, '#00D4AA'); g.addColorStop(1, '#7B61FF')
        ctx.fillStyle = g; ctx.fillRect(x, h - barH, barW - 2, barH); x += barW
      }
    }

    if (!recording) { if (animRef.current) cancelAnimationFrame(animRef.current); drawIdle(); return }

    const dataArray = new Uint8Array(analyserRef.current?.frequencyBinCount || 128)
    const loop = () => {
      if (!analyserRef.current) { drawIdle(); return }
      analyserRef.current.getByteFrequencyData(dataArray)
      drawActive(dataArray)
      animRef.current = requestAnimationFrame(loop)
    }
    loop()
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [recording])

  // Сохранение настроек при изменении
  useEffect(() => {
    localforage.setItem('lastSettings', { eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion })
  }, [eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion])

  // --- Запись ---
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser(); analyser.fftSize = 256
      source.connect(analyser); analyserRef.current = analyser

      mediaRecorder.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      chunks.current = []
      mediaRecorder.current.ondataavailable = e => e.data.size > 0 && chunks.current.push(e.data)
      
      mediaRecorder.current.onstop = async () => {
        setProcessing(true)
        try {
          const blob = new Blob(chunks.current, { type: 'audio/webm' })
          const actx = new AudioContext()
          const rawBuffer = await actx.decodeAudioData(await blob.arrayBuffer())
          
          // Подготовка данных для Worker
          const channels = rawBuffer.numberOfChannels
          const length = rawBuffer.length * channels
          const interleaved = new Float32Array(length)
          for (let i = 0; i < rawBuffer.length; i++) {
            for (let ch = 0; ch < channels; ch++) {
              interleaved[i * channels + ch] = rawBuffer.getChannelData(ch)[i]
            }
          }

          // Отправка в Worker
          workerRef.current?.postMessage({
            buffer: interleaved,
            settings: { eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion },
            sampleRate: rawBuffer.sampleRate,
            channels: channels
          }, [interleaved.buffer])
          
          actx.close()
        } catch (err) {
          alert('Ошибка: ' + (err as Error).message)
          setProcessing(false)
        }
      }
      
      mediaRecorder.current.start()
      setRecording(true)
    } catch (err: any) {
      alert(err.name === 'NotAllowedError' ? '❌ Разрешите доступ к микрофону' : 'Ошибка: ' + err.message)
    }
  }

  const stop = () => {
    if (mediaRecorder.current && recording) {
      mediaRecorder.current.stop()
      setRecording(false)
    }
  }

  return (
    <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">🎤 VocalSync Studio</h2>
        <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-[#0F0F1B] rounded-lg transition">
          <Settings className="w-5 h-5 text-[#7B61FF]" />
        </button>
      </div>

      <div className="relative w-full h-24 bg-[#0F0F1B] rounded-lg mb-6 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      
      <div className="flex justify-center gap-4 mb-6">
        {!recording ? (
          <button onClick={start} disabled={processing} className="bg-[#00D4AA] hover:bg-[#00D4AA]/80 disabled:opacity-50 text-black px-8 py-4 rounded-full font-bold flex items-center gap-2 transition hover:scale-105">
            <Mic className="w-6 h-6" /> {processing ? '⏳ Обработка...' : 'Начать запись'}
          </button>
        ) : (
          <button onClick={stop} className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 animate-pulse">
            <Square className="w-6 h-6" /> Остановить
          </button>
        )}
      </div>

      {showSettings && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 mb-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <h3 className="font-bold flex items-center gap-2"><Sliders className="w-4 h-4" /> Эффекты</h3>
          
          <div className="space-y-2 border-b border-gray-700 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#7B61FF]"><Radio className="w-4 h-4" /> Реверб</div>
            <input type="range" min="0" max="1" step="0.05" value={reverbMix} onChange={e => setReverbMix(Number(e.target.value))} className="w-full accent-[#7B61FF]" />
          </div>

          <div className="space-y-2 border-b border-gray-700 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#00D4AA]"><Timer className="w-4 h-4" /> Эхо (Delay)</div>
            <div className="flex gap-2">
              <input type="range" min="0.1" max="1" step="0.05" value={delayTime} onChange={e => setDelayTime(Number(e.target.value))} className="flex-1 accent-[#00D4AA]" />
              <input type="range" min="0" max="0.8" step="0.05" value={delayFeedback} onChange={e => setDelayFeedback(Number(e.target.value))} className="flex-1 accent-[#00D4AA]" />
              <input type="range" min="0" max="1" step="0.05" value={delayMix} onChange={e => setDelayMix(Number(e.target.value))} className="flex-1 accent-[#00D4AA]" />
            </div>
          </div>

          <div className="space-y-2 border-b border-gray-700 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-orange-400"><Zap className="w-4 h-4" /> Дисторшн</div>
            <input type="range" min="0" max="100" step="5" value={distortion} onChange={e => setDistortion(Number(e.target.value))} className="w-full accent-orange-400" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-300"><Volume2 className="w-4 h-4" /> Эквалайзер</div>
            <div className="flex items-center gap-2"><span className="text-xs w-8">Low</span><input type="range" min="-12" max="12" step="0.5" value={eq.low} onChange={e => setEq(p=>({...p,low:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-8">{eq.low}</span></div>
            <div className="flex items-center gap-2"><span className="text-xs w-8">Mid</span><input type="range" min="-12" max="12" step="0.5" value={eq.mid} onChange={e => setEq(p=>({...p,mid:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-8">{eq.mid}</span></div>
            <div className="flex items-center gap-2"><span className="text-xs w-8">High</span><input type="range" min="-12" max="12" step="0.5" value={eq.high} onChange={e => setEq(p=>({...p,high:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-8">{eq.high}</span></div>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <button onClick={() => {setReverbMix(0.3);setDelayMix(0.1);setDelayTime(0.35);setDistortion(0);setEq({low:2,mid:0,high:1})}} className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded">🎙️ Студия</button>
            <button onClick={() => {setReverbMix(0);setDelayMix(0);setDistortion(0);setEq({low:0,mid:0,high:0})}} className="text-xs px-3 py-1 bg-gray-700/30 hover:bg-gray-700/50 rounded">🔄 Сброс</button>
          </div>
        </div>
      )}

      {audioURL && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 space-y-4">
          <h3 className="font-bold">🎵 Результат:</h3>
          <audio controls src={audioURL} className="w-full" />
          <a href={audioURL} download={`vocal_${Date.now()}.wav`} className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-4 py-2 rounded-lg transition">
            <Download className="w-5 h-5" /> Скачать WAV
          </a>
        </div>
      )}
    </div>
  )
}