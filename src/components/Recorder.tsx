import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Download, Settings, Volume2, Sliders, Radio, Timer, Zap } from 'lucide-react'

// Генерация импульса для реверберации
const createImpulseResponse = (ctx: AudioContext, duration = 2.0, decay = 2.0): AudioBuffer => {
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

// Кривая дисторшна (мягкая сатурация)
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

// Простой аудио-процессор с эффектами
class AudioProcessor {
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  
  // EQ
  private eqLow: BiquadFilterNode | null = null
  private eqMid: BiquadFilterNode | null = null
  private eqHigh: BiquadFilterNode | null = null

  // Эффекты
  private reverbNode: ConvolverNode | null = null
  private reverbWet: GainNode | null = null
  private reverbDry: GainNode | null = null

  private delayNode: DelayNode | null = null
  private delayFeedback: GainNode | null = null
  private delayWet: GainNode | null = null
  private delayDry: GainNode | null = null

  private distortionNode: WaveShaperNode | null = null
  private distortionWet: GainNode | null = null
  private distortionDry: GainNode | null = null

  // Мастер
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  
  private isDestinationSupported = false

  async init(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    this.isDestinationSupported = typeof this.audioContext.createMediaStreamAudioDestinationNode === 'function'

    // 1. Источник
    this.source = this.audioContext.createMediaStreamSource(stream)

    // 2. Компрессор
    this.compressor = this.audioContext.createDynamicsCompressor()
    Object.assign(this.compressor, { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 })

    // 3. Эквалайзер
    this.eqLow = this.audioContext.createBiquadFilter()
    this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 200; this.eqLow.gain.value = 0

    this.eqMid = this.audioContext.createBiquadFilter()
    this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 1; this.eqMid.gain.value = 0

    this.eqHigh = this.audioContext.createBiquadFilter()
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 3000; this.eqHigh.gain.value = 0

    // 4. Реверберация
    this.reverbNode = this.audioContext.createConvolver()
    this.reverbNode.buffer = createImpulseResponse(this.audioContext)
    this.reverbWet = this.audioContext.createGain(); this.reverbWet.gain.value = 0
    this.reverbDry = this.audioContext.createGain(); this.reverbDry.gain.value = 1

    // 5. Дилей (Эхо)
    this.delayNode = this.audioContext.createDelay(5.0)
    this.delayNode.delayTime.value = 0.3
    this.delayFeedback = this.audioContext.createGain(); this.delayFeedback.gain.value = 0.4
    this.delayWet = this.audioContext.createGain(); this.delayWet.gain.value = 0
    this.delayDry = this.audioContext.createGain(); this.delayDry.gain.value = 1

    // 6. Дисторшн (Сатурация)
    this.distortionNode = this.audioContext.createWaveShaper()
    this.distortionNode.curve = makeDistortionCurve(0)
    this.distortionNode.oversample = '4x'
    this.distortionWet = this.audioContext.createGain(); this.distortionWet.gain.value = 0
    this.distortionDry = this.audioContext.createGain(); this.distortionDry.gain.value = 1

    // 7. Мастер и Анализатор
    this.masterGain = this.audioContext.createGain(); this.masterGain.gain.value = 1
    this.analyser = this.audioContext.createAnalyser(); this.analyser.fftSize = 256

    // 8. Выход
    if (this.isDestinationSupported) {
      this.destination = this.audioContext.createMediaStreamAudioDestinationNode()
    }

    this.buildChain()
  }

  private buildChain() {
    if (!this.audioContext || !this.source) return

    // Базовая цепочка: Source → Compressor → EQ
    this.source.connect(this.compressor)
    this.compressor.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)

    // Параллельная маршрутизация эффектов
    const afterEQ = this.eqHigh

    // --- Реверберация ---
    afterEQ.connect(this.reverbDry)
    afterEQ.connect(this.reverbNode)
    this.reverbNode.connect(this.reverbWet)

    // --- Дилей ---
    afterEQ.connect(this.delayDry)
    afterEQ.connect(this.delayNode)
    this.delayNode.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayNode) // Feedback loop
    this.delayNode.connect(this.delayWet)

    // --- Дисторшн ---
    afterEQ.connect(this.distortionDry)
    afterEQ.connect(this.distortionNode)
    this.distortionNode.connect(this.distortionWet)

    // --- Сборка мастер-шины ---
    const mergeGain = this.audioContext.createGain()
    this.reverbDry.connect(mergeGain)
    this.reverbWet.connect(mergeGain)
    this.delayDry.connect(mergeGain)
    this.delayWet.connect(mergeGain)
    this.distortionDry.connect(mergeGain)
    this.distortionWet.connect(mergeGain)

    mergeGain.connect(this.masterGain)
    this.masterGain.connect(this.analyser)
    
    if (this.isDestinationSupported && this.destination) {
      this.analyser.connect(this.destination)
    }
  }

  getAudioContext(): AudioContext | null { return this.audioContext }
  needsDirectRecording(): boolean { return !this.isDestinationSupported }
  getProcessedStream(): MediaStream | null { return this.destination?.stream || null }
  getAnalyserData(arr: Uint8Array) { this.analyser?.getByteFrequencyData(arr) }

  // Настройки
  setEQ(low: number, mid: number, high: number) {
    if (!this.audioContext) return
    this.eqLow?.gain.setValueAtTime(low, this.audioContext.currentTime)
    this.eqMid?.gain.setValueAtTime(mid, this.audioContext.currentTime)
    this.eqHigh?.gain.setValueAtTime(high, this.audioContext.currentTime)
  }
  setMaster(value: number) { this.masterGain?.gain.setValueAtTime(value, this.audioContext?.currentTime || 0) }
  
  setReverb(mix: number) {
    if (!this.audioContext) return
    this.reverbWet?.gain.setValueAtTime(mix, this.audioContext.currentTime)
    this.reverbDry?.gain.setValueAtTime(1 - mix * 0.5, this.audioContext.currentTime)
  }
  setDelay(time: number, feedback: number, mix: number) {
    if (!this.audioContext) return
    this.delayNode?.delayTime.setValueAtTime(time, this.audioContext.currentTime)
    this.delayFeedback?.gain.setValueAtTime(feedback, this.audioContext.currentTime)
    this.delayWet?.gain.setValueAtTime(mix, this.audioContext.currentTime)
    this.delayDry?.gain.setValueAtTime(1 - mix, this.audioContext.currentTime)
  }
  setDistortion(amount: number) {
    if (!this.audioContext || !this.distortionNode) return
    this.distortionNode.curve = makeDistortionCurve(amount)
  }

  cleanup() {
    this.source?.disconnect()
    this.destination?.disconnect()
    this.audioContext?.close()
    this.audioContext = null
  }

  static normalizeBuffer(buffer: AudioBuffer, targetPeak = 0.95): AudioBuffer {
    const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate
    const norm = new AudioBuffer({ numberOfChannels: ch, length: len, sampleRate: sr })
    let max = 0
    for (let c = 0; c < ch; c++) for (let i = 0; i < len; i++) max = Math.max(max, Math.abs(buffer.getChannelData(c)[i]))
    const gain = max > 0 ? targetPeak / max : 1
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c), dst = norm.getChannelData(c)
      for (let i = 0; i < len; i++) dst[i] = src[i] * gain
    }
    return norm
  }
}

export default function Recorder() {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [isSupported, setIsSupported] = useState(true)
  
  // Параметры эффектов
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 })
  const [master, setMaster] = useState(1)
  const [reverbMix, setReverbMix] = useState(0)
  const [delayTime, setDelayTime] = useState(0.3)
  const [delayFeedback, setDelayFeedback] = useState(0.4)
  const [delayMix, setDelayMix] = useState(0)
  const [distortion, setDistortion] = useState(0)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const processor = useRef<AudioProcessor | null>(null)
  const chunks = useRef<Blob[]>([])
  const animRef = useRef<number>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Визуализация
  const visualize = () => {
    if (!processor.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    const data = new Uint8Array(128)
    const draw = () => {
      animRef.current = requestAnimationFrame(draw)
      processor.current?.getAnalyserData(data)
      ctx.fillStyle = '#0F0F1B'
      ctx.fillRect(0, 0, 400, 100)
      const w = 400 / data.length * 2.5
      let x = 0
      for (let i = 0; i < data.length; i++) {
        const h = (data[i] / 255) * 100
        const g = ctx.createLinearGradient(0, 100, 0, 0)
        g.addColorStop(0, '#00D4AA'); g.addColorStop(1, '#7B61FF')
        ctx.fillStyle = g
        ctx.fillRect(x, 100 - h, w - 2, h)
        x += w
      }
    }
    draw()
  }

  const applySettings = () => {
    const p = processor.current
    if (!p) return
    p.setEQ(eq.low, eq.mid, eq.high)
    p.setMaster(master)
    p.setReverb(reverbMix)
    p.setDelay(delayTime, delayFeedback, delayMix)
    p.setDistortion(distortion)
  }

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      processor.current = new AudioProcessor()
      await processor.current.init(stream)
      setIsSupported(!processor.current.needsDirectRecording())
      
      const ctx = processor.current.getAudioContext()
      if (ctx?.state === 'suspended') await ctx.resume()
      
      applySettings()
      visualize()

      const recordStream = processor.current.needsDirectRecording() ? stream : processor.current.getProcessedStream()!
      mediaRecorder.current = new MediaRecorder(recordStream, { mimeType: 'audio/webm;codecs=opus' })
      chunks.current = []
      
      mediaRecorder.current.ondataavailable = e => e.data.size > 0 && chunks.current.push(e.data)
      mediaRecorder.current.onstop = async () => {
        if (!chunks.current.length) return alert('Запись пуста')
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        const actx = new AudioContext()
        const buf = await actx.decodeAudioData(await blob.arrayBuffer())
        const norm = AudioProcessor.normalizeBuffer(buf)
        
        // Конвертер в WAV (встроенная функция)
        const wav = bufferToWav(norm)
        setAudioURL(URL.createObjectURL(wav))
        
        processor.current?.cleanup()
        processor.current = null
        if (animRef.current) cancelAnimationFrame(animRef.current)
        stream.getTracks().forEach(t => t.stop())
        actx.close()
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

  // Конвертер WAV
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

  useEffect(() => { if (processor.current && recording) applySettings() }, [eq, master, reverbMix, delayTime, delayFeedback, delayMix, distortion, recording])

  return (
    <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">🎤 Запись вокала</h2>
        <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-[#0F0F1B] rounded-lg transition">
          <Settings className={`w-5 h-5 ${isSupported ? 'text-[#7B61FF]' : 'text-gray-600'}`} />
        </button>
      </div>

      <canvas ref={canvasRef} width={400} height={100} className="w-full h-24 bg-[#0F0F1B] rounded-lg mb-6" />
      
      {!isSupported && recording && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-3 mb-4 text-sm text-yellow-200">
          ⚠️ Браузер не поддерживает обработку в реальном времени. Запись идёт в чистом виде, эффекты применятся только к превью.
        </div>
      )}

      <div className="flex justify-center gap-4 mb-6">
        {!recording ? (
          <button onClick={start} className="bg-[#00D4AA] hover:bg-[#00D4AA]/80 text-black px-8 py-4 rounded-full font-bold flex items-center gap-2 transition hover:scale-105">
            <Mic className="w-6 h-6" /> Начать запись
          </button>
        ) : (
          <button onClick={stop} className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 animate-pulse">
            <Square className="w-6 h-6" /> Остановить
          </button>
        )}
      </div>

      {showSettings && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 mb-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <h3 className="font-bold flex items-center gap-2"><Sliders className="w-4 h-4" /> Эффекты и обработка</h3>
          
          {!isSupported ? <p className="text-sm text-gray-400">Эффекты недоступны в этом браузере.</p> : (
            <>
              <div className="space-y-2 border-b border-gray-700 pb-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#7B61FF]"><Radio className="w-4 h-4" /> Реверберация</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs w-12">Микс</span>
                  <input type="range" min="0" max="1" step="0.05" value={reverbMix} onChange={e => setReverbMix(Number(e.target.value))} className="flex-1 accent-[#7B61FF]" />
                </div>
              </div>

              <div className="space-y-2 border-b border-gray-700 pb-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#00D4AA]"><Timer className="w-4 h-4" /> Эхо (Delay)</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs">Время</span>
                    <input type="range" min="0.1" max="1" step="0.05" value={delayTime} onChange={e => setDelayTime(Number(e.target.value))} className="accent-[#00D4AA]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs">Фидбек</span>
                    <input type="range" min="0" max="0.8" step="0.05" value={delayFeedback} onChange={e => setDelayFeedback(Number(e.target.value))} className="accent-[#00D4AA]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs">Микс</span>
                    <input type="range" min="0" max="1" step="0.05" value={delayMix} onChange={e => setDelayMix(Number(e.target.value))} className="accent-[#00D4AA]" />
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-b border-gray-700 pb-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-orange-400"><Zap className="w-4 h-4" /> Сатурация</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs w-12">Драйв</span>
                  <input type="range" min="0" max="100" step="5" value={distortion} onChange={e => setDistortion(Number(e.target.value))} className="flex-1 accent-orange-400" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-300"><Volume2 className="w-4 h-4" /> Эквалайзер</div>
                <div className="flex items-center gap-3"><span className="text-xs w-12">Низ</span><input type="range" min="-12" max="12" step="0.5" value={eq.low} onChange={e => setEq(p=>({...p,low:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-10">{eq.low}</span></div>
                <div className="flex items-center gap-3"><span className="text-xs w-12">Сред</span><input type="range" min="-12" max="12" step="0.5" value={eq.mid} onChange={e => setEq(p=>({...p,mid:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-10">{eq.mid}</span></div>
                <div className="flex items-center gap-3"><span className="text-xs w-12">Верх</span><input type="range" min="-12" max="12" step="0.5" value={eq.high} onChange={e => setEq(p=>({...p,high:Number(e.target.value)}))} className="flex-1 accent-gray-400" /><span className="text-xs w-10">{eq.high}</span></div>
              </div>

              <div className="pt-2">
                <span className="text-xs font-semibold text-gray-400 block mb-2">ПРЕСЕТЫ</span>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => {setReverbMix(0.3);setDelayMix(0.1);setDelayTime(0.35);setDistortion(0);setEq({low:2,mid:0,high:1})}} className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded">🎙️ Студия</button>
                  <button onClick={() => {setReverbMix(0.6);setDelayMix(0.25);setDelayTime(0.12);setDistortion(10);setEq({low:4,mid:-2,high:3})}} className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded">🏟️ Концерт</button>
                  <button onClick={() => {setReverbMix(0);setDelayMix(0);setDistortion(0);setEq({low:0,mid:2,high:4})}} className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded">📻 Радио</button>
                  <button onClick={() => {setReverbMix(0);setDelayMix(0);setDistortion(0);setEq({low:0,mid:0,high:0})}} className="text-xs px-3 py-1 bg-gray-700/30 hover:bg-gray-700/50 rounded">🔄 Сброс</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {audioURL && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 space-y-4">
          <h3 className="font-bold">🎵 Результат:</h3>
          <audio controls src={audioURL} className="w-full" />
          <a href={audioURL} download={`vocal_fx_${Date.now()}.wav`} className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-4 py-2 rounded-lg transition">
            <Download className="w-5 h-5" /> Скачать WAV
          </a>
        </div>
      )}
    </div>
  )
}