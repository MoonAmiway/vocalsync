import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Download, Settings, Volume2, Sliders, Radio, Timer, Zap } from 'lucide-react'
import localforage from 'localforage'

localforage.config({ name: 'VocalSync', version: 1.0, storeName: 'settings' })

// 🆕 Универсальный доступ к OfflineAudioContext (для всех браузеров)
const getOfflineAudioContext = (): typeof OfflineAudioContext => {
  // @ts-ignore
  return window.OfflineAudioContext || window.webkitOfflineAudioContext
}

// 🆕 Универсальный доступ к AudioContext
const getAudioContext = (): typeof AudioContext => {
  // @ts-ignore
  return window.AudioContext || window.webkitAudioContext
}

// --- Утилиты для эффектов ---
const createImpulseResponse = (ctx: OfflineAudioContext | AudioContext, duration = 2.0, decay = 2.0): AudioBuffer => {
  const length = ctx.sampleRate * duration
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
}

const makeDistortionCurve = (amount: number): Float32Array => {
  const samples = 44100
  const curve = new Float32Array(samples)
  const deg = Math.PI / 180
  for (let i = 0; i < samples; ++i) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x))
  }
  return curve
}

async function applyEffectsOffline(
  buffer: AudioBuffer,
  settings: { eq: { low: number; mid: number; high: number }; master: number; reverbMix: number; delayTime: number; delayFeedback: number; delayMix: number; distortion: number }
): Promise<AudioBuffer> {
  // 🆕 Безопасное создание контекста
  const OfflineCtx = getOfflineAudioContext()
  if (!OfflineCtx) {
    throw new Error('OfflineAudioContext не поддерживается в этом браузере')
  }
  
  const offlineCtx = new OfflineCtx(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = buffer

  const comp = offlineCtx.createDynamicsCompressor()
  comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 12

  const eqL = offlineCtx.createBiquadFilter(); eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = settings.eq.low
  const eqM = offlineCtx.createBiquadFilter(); eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.gain.value = settings.eq.mid
  const eqH = offlineCtx.createBiquadFilter(); eqH.type = 'highshelf'; eqH.frequency.value = 3000; eqH.gain.value = settings.eq.high

  const revNode = offlineCtx.createConvolver(); revNode.buffer = createImpulseResponse(offlineCtx)
  const revWet = offlineCtx.createGain(); revWet.gain.value = settings.reverbMix
  const revDry = offlineCtx.createGain(); revDry.gain.value = 1 - settings.reverbMix * 0.5

  const delNode = offlineCtx.createDelay(5.0); delNode.delayTime.value = settings.delayTime
  const delFb = offlineCtx.createGain(); delFb.gain.value = settings.delayFeedback
  const delWet = offlineCtx.createGain(); delWet.gain.value = settings.delayMix
  const delDry = offlineCtx.createGain(); delDry.gain.value = 1 - settings.delayMix

  const distNode = offlineCtx.createWaveShaper(); distNode.curve = makeDistortionCurve(settings.distortion)
  const distWet = offlineCtx.createGain(); distWet.gain.value = Math.min(1, settings.distortion / 100)
  const distDry = offlineCtx.createGain(); distDry.gain.value = 1

  const master = offlineCtx.createGain(); master.gain.value = settings.master
  const merger = offlineCtx.createGain()

  source.connect(comp); comp.connect(eqL); eqL.connect(eqM); eqM.connect(eqH)
  const afterEQ = eqH
  afterEQ.connect(revDry); afterEQ.connect(revNode); revNode.connect(revWet)
  afterEQ.connect(delDry); afterEQ.connect(delNode); delNode.connect(delFb); delFb.connect(delNode); delNode.connect(delWet)
  afterEQ.connect(distDry); afterEQ.connect(distNode); distNode.connect(distWet)
  revDry.connect(merger); revWet.connect(merger)
  delDry.connect(merger); delWet.connect(merger)
  distDry.connect(merger); distWet.connect(merger)
  merger.connect(master); master.connect(offlineCtx.destination)

  source.start()
  return await offlineCtx.startRendering()
}

const bufferToWav = (buf: AudioBuffer): Blob => {
  const ch = buf.numberOfChannels, len = buf.length * ch * 2, sr = buf.sampleRate
  const view = new DataView(new ArrayBuffer(44 + len))
  const write = (o: number, s: string) => { for(let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)) }
  write(0,'RIFF'); view.setUint32(4,36+len,true); write(8,'WAVE'); write(12,'fmt ')
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,ch,true)
  view.setUint32(24,sr,true); view.setUint32(28,sr*ch*2,true); view.setUint16(32,ch*2,true)
  view.setUint16(34,16,true); write(36,'data'); view.setUint32(40,len,true)
  const channels = Array.from({length:ch}, (_,i)=>buf.getChannelData(i))
  let off = 44
  for(let i=0;i<buf.length;i++) for(let c=0;c<ch;c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]))
    view.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true); off+=2
  }
  return new Blob([view], {type:'audio/wav'})
}

export default function Recorder() {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [processing, setProcessing] = useState(false)
  
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

  // Визуализация
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

  // Сохранение настроек
  useEffect(() => {
    localforage.setItem('lastSettings', { eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion })
  }, [eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion])

  // Загрузка настроек при старте
  useEffect(() => {
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
  }, [])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // 🆕 Безопасное создание AudioContext
      const AudioCtx = getAudioContext()
      if (!AudioCtx) {
        throw new Error('Web Audio API не поддерживается в этом браузере')
      }
      
      const audioCtx = new AudioCtx()
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
          const actx = new AudioCtx()
          const rawBuffer = await actx.decodeAudioData(await blob.arrayBuffer())
          
          const processed = await applyEffectsOffline(rawBuffer, {
            eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion
          })
          
          const wav = bufferToWav(processed)
          setAudioURL(URL.createObjectURL(wav))
          
          actx.close()
        } catch (err: any) {
          alert('Ошибка обработки: ' + (err.message || err))
        } finally {
          setProcessing(false)
          stream.getTracks().forEach(t => t.stop())
          streamRef.current = null
          analyserRef.current = null
          if (animRef.current) cancelAnimationFrame(animRef.current)
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
        <h2 className="text-2xl font-bold">🎤 VocalSync</h2>
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
            <Mic className="w-6 h-6" /> {processing ? '⏳ Обработка...' : 'Запись'}
          </button>
        ) : (
          <button onClick={stop} className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 animate-pulse">
            <Square className="w-6 h-6" /> Стоп
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
            <div className="flex items-center gap-2 text-sm font-semibold text-[#00D4AA]"><Timer className="w-4 h-4" /> Эхо</div>
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
        </div>
      )}

      {audioURL && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 space-y-4">
          <h3 className="font-bold">🎵 Результат:</h3>
          <audio controls src={audioURL} className="w-full" />
          <a href={audioURL} download={`vocal_${Date.now()}.wav`} className="inline-flex items-center justify-center gap-2 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-4 py-3 rounded-lg transition font-bold">
            <Download className="w-5 h-5" /> Скачать WAV
          </a>
        </div>
      )}
    </div>
  )
}