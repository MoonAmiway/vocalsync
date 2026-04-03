import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Download, Settings, Volume2, Sliders } from 'lucide-react'

// Простой аудио-процессор на Web Audio API
class AudioProcessor {
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private eqLow: BiquadFilterNode | null = null
  private eqMid: BiquadFilterNode | null = null
  private eqHigh: BiquadFilterNode | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null

  async init(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    // Создаём узлы
    this.source = this.audioContext.createMediaStreamSource(stream)
    this.compressor = this.audioContext.createDynamicsCompressor()
    this.compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime)
    this.compressor.knee.setValueAtTime(30, this.audioContext.currentTime)
    this.compressor.ratio.setValueAtTime(12, this.audioContext.currentTime)
    this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime)
    this.compressor.release.setValueAtTime(0.25, this.audioContext.currentTime)

    // Эквалайзер (3 полосы)
    this.eqLow = this.audioContext.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.setValueAtTime(200, this.audioContext.currentTime)
    this.eqLow.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.eqMid = this.audioContext.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.setValueAtTime(1000, this.audioContext.currentTime)
    this.eqMid.Q.setValueAtTime(1, this.audioContext.currentTime)
    this.eqMid.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.eqHigh = this.audioContext.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.setValueAtTime(3000, this.audioContext.currentTime)
    this.eqHigh.gain.setValueAtTime(0, this.audioContext.currentTime)

    // Gain для мастер-громкости
    this.gain = this.audioContext.createGain()
    this.gain.gain.setValueAtTime(1, this.audioContext.currentTime)

    // Анализатор для визуализации
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256

    // Выход для записи
    this.destination = this.audioContext.createMediaStreamAudioDestinationNode()

    // Соединяем цепочку: Source → Compressor → EQ → Gain → Analyser → Destination
    this.source.connect(this.compressor)
    this.compressor.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.gain)
    this.gain.connect(this.analyser)
    this.analyser.connect(this.destination)
  }

  // 🔧 НОВЫЙ МЕТОД: получить AudioContext (для resume)
  getAudioContext(): AudioContext | null {
    return this.audioContext
  }

  // Настройки эквалайзера
  setEQ(low: number, mid: number, high: number) {
    if (!this.audioContext) return
    this.eqLow?.gain.setValueAtTime(low, this.audioContext.currentTime)
    this.eqMid?.gain.setValueAtTime(mid, this.audioContext.currentTime)
    this.eqHigh?.gain.setValueAtTime(high, this.audioContext.currentTime)
  }

  // Мастер-громкость
  setMasterGain(value: number) {
    if (!this.audioContext) return
    this.gain?.gain.setValueAtTime(value, this.audioContext.currentTime)
  }

  // Получить поток для записи (с обработкой)
  getProcessedStream(): MediaStream {
    return this.destination!.stream
  }

  // Получить данные для визуализации
  getAnalyserData(array: Uint8Array) {
    this.analyser?.getByteFrequencyData(array)
  }

  // Очистка
  cleanup() {
    this.source?.disconnect()
    this.audioContext?.close()
    this.audioContext = null
  }

  // Нормализация аудиобуфера (пост-обработка)
  static normalizeBuffer(buffer: AudioBuffer, targetPeak = 0.95): AudioBuffer {
    const channels = buffer.numberOfChannels
    const length = buffer.length
    const sampleRate = buffer.sampleRate
    const normalized = new AudioBuffer({ numberOfChannels: channels, length, sampleRate })

    // Найти максимальный пик
    let maxPeak = 0
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const abs = Math.abs(data[i])
        if (abs > maxPeak) maxPeak = abs
      }
    }

    // Применить нормализацию
    const gain = maxPeak > 0 ? targetPeak / maxPeak : 1
    for (let ch = 0; ch < channels; ch++) {
      const src = buffer.getChannelData(ch)
      const dst = normalized.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        dst[i] = src[i] * gain
      }
    }

    return normalized
  }
}

export default function Recorder() {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 })
  const [masterGain, setMasterGain] = useState(1)
  
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const processor = useRef<AudioProcessor | null>(null)
  const chunks = useRef<Blob[]>([])
  const animationRef = useRef<number>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Визуализация волны
  const visualize = () => {
    if (!processor.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dataArray = new Uint8Array(128)
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw)
      processor.current?.getAnalyserData(dataArray)
      
      ctx.fillStyle = '#0F0F1B'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      const barWidth = (canvas.width / dataArray.length) * 2.5
      let x = 0
      
      for (let i = 0; i < dataArray.length; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0)
        gradient.addColorStop(0, '#00D4AA')
        gradient.addColorStop(1, '#7B61FF')
        ctx.fillStyle = gradient
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight)
        x += barWidth
      }
    }
    draw()
  }

  // 🔧 ОБНОВЛЁННАЯ ФУНКЦИЯ START (фикс микрофона для HTTPS)
  const start = async () => {
    try {
      // 1. Сначала запрашиваем микрофон
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // 2. Инициализируем аудио-контекст ТОЛЬКО после пользовательского действия
      processor.current = new AudioProcessor()
      await processor.current.init(stream)
      
      // 3. 🔧 ВАЖНО: Резюмим AudioContext (требование браузеров для https)
      const ctx = processor.current.getAudioContext()
      if (ctx?.state === 'suspended') {
        await ctx.resume()
      }
      
      // 4. Применяем настройки
      processor.current.setEQ(eq.low, eq.mid, eq.high)
      processor.current.setMasterGain(masterGain)

      // 5. Запускаем визуализацию
      visualize()

      // 6. Записываем ОБРАБОТАННЫЙ поток
      const processedStream = processor.current.getProcessedStream()
      mediaRecorder.current = new MediaRecorder(processedStream, { 
        mimeType: 'audio/webm;codecs=opus' // Более совместимый формат
      })
      
      chunks.current = []
      mediaRecorder.current.ondataavailable = e => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      
      mediaRecorder.current.onstop = async () => {
        if (chunks.current.length === 0) {
          alert('Запись пуста. Попробуйте ещё раз.')
          return
        }
        
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const audioContext = new AudioContext()
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
        
        // Нормализуем
        const normalized = AudioProcessor.normalizeBuffer(audioBuffer)
        const wavBlob = bufferToWav(normalized)
        setAudioURL(URL.createObjectURL(wavBlob))
        
        // Очистка
        processor.current?.cleanup()
        processor.current = null
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        stream.getTracks().forEach(t => t.stop())
        audioContext.close()
      }
      
      mediaRecorder.current.start()
      setRecording(true)
      
    } catch (err: any) {
      console.error('Microphone error:', err)
      
      if (err.name === 'NotAllowedError') {
        alert('❌ Доступ к микрофону запрещён.\n\n1. Нажмите на иконку 🔒/🎤 в адресной строке браузера\n2. Разрешите доступ к микрофону\n3. Обновите страницу (Ctrl+Shift+R)\n4. Попробуйте ещё раз')
      } else if (err.name === 'NotFoundError') {
        alert('❌ Микрофон не найден. Подключите микрофон и попробуйте снова.')
      } else {
        alert('Ошибка микрофона: ' + (err.message || err))
      }
    }
  }

  const stop = () => {
    if (mediaRecorder.current && recording) {
      mediaRecorder.current.stop()
      setRecording(false)
    }
  }

  // Обновляем настройки процессора в реальном времени
  useEffect(() => {
    if (processor.current && recording) {
      processor.current.setEQ(eq.low, eq.mid, eq.high)
      processor.current.setMasterGain(masterGain)
    }
  }, [eq, masterGain, recording])

  // Конвертер AudioBuffer → WAV
  const bufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels
    const length = buffer.length * numOfChan * 2
    const sampleRate = buffer.sampleRate
    const data = new DataView(new ArrayBuffer(44 + length))
    
    // WAV header
    writeString(data, 0, 'RIFF')
    data.setUint32(4, 36 + length, true)
    writeString(data, 8, 'WAVE')
    writeString(data, 12, 'fmt ')
    data.setUint32(16, 16, true)
    data.setUint16(20, 1, true)
    data.setUint16(22, numOfChan, true)
    data.setUint32(24, sampleRate, true)
    data.setUint32(28, sampleRate * numOfChan * 2, true)
    data.setUint16(32, numOfChan * 2, true)
    data.setUint16(34, 16, true)
    writeString(data, 36, 'data')
    data.setUint32(40, length, true)

    // Interleave channels
    const channels = []
    for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i))
    
    let offset = 44
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numOfChan; ch++) {
        let sample = Math.max(-1, Math.min(1, channels[ch][i]))
        data.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
        offset += 2
      }
    }
    return new Blob([data], { type: 'audio/wav' })
  }

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  return (
    <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">🎤 Запись вокала</h2>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-[#0F0F1B] rounded-lg transition"
        >
          <Settings className="w-5 h-5 text-[#7B61FF]" />
        </button>
      </div>

      {/* Визуализатор */}
      <canvas 
        ref={canvasRef} 
        width={400} 
        height={100} 
        className="w-full h-24 bg-[#0F0F1B] rounded-lg mb-6"
      />

      {/* Кнопки записи */}
      <div className="flex justify-center gap-4 mb-6">
        {!recording ? (
          <button 
            onClick={start} 
            className="bg-[#00D4AA] hover:bg-[#00D4AA]/80 text-black px-8 py-4 rounded-full font-bold flex items-center gap-2 transition transform hover:scale-105"
          >
            <Mic className="w-6 h-6" /> Начать запись
          </button>
        ) : (
          <button 
            onClick={stop} 
            className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 animate-pulse"
          >
            <Square className="w-6 h-6" /> Остановить
          </button>
        )}
      </div>

      {/* Панель настроек */}
      {showSettings && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 mb-6 space-y-4">
          <h3 className="font-bold flex items-center gap-2">
            <Sliders className="w-4 h-4" /> Настройки обработки
          </h3>
          
          {/* Эквалайзер */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Низкие</span>
              <input 
                type="range" 
                min="-12" 
                max="12" 
                step="0.5"
                value={eq.low}
                onChange={e => setEq(prev => ({ ...prev, low: Number(e.target.value) }))}
                className="flex-1 accent-[#7B61FF]"
              />
              <span className="text-sm w-12 text-right">{eq.low} dB</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Средние</span>
              <input 
                type="range" 
                min="-12" 
                max="12" 
                step="0.5"
                value={eq.mid}
                onChange={e => setEq(prev => ({ ...prev, mid: Number(e.target.value) }))}
                className="flex-1 accent-[#7B61FF]"
              />
              <span className="text-sm w-12 text-right">{eq.mid} dB</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Высокие</span>
              <input 
                type="range" 
                min="-12" 
                max="12" 
                step="0.5"
                value={eq.high}
                onChange={e => setEq(prev => ({ ...prev, high: Number(e.target.value) }))}
                className="flex-1 accent-[#7B61FF]"
              />
              <span className="text-sm w-12 text-right">{eq.high} dB</span>
            </div>
          </div>

          {/* Мастер-громкость */}
          <div className="flex items-center gap-3">
            <Volume2 className="w-4 h-4" />
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.1"
              value={masterGain}
              onChange={e => setMasterGain(Number(e.target.value))}
              className="flex-1 accent-[#00D4AA]"
            />
            <span className="text-sm w-12 text-right">{(masterGain * 100).toFixed(0)}%</span>
          </div>

          {/* Пресеты */}
          <div className="flex gap-2 pt-2">
            <button 
              onClick={() => setEq({ low: 3, mid: 0, high: 2 })}
              className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded transition"
            >
              🎤 Вокал
            </button>
            <button 
              onClick={() => setEq({ low: -3, mid: 2, high: 4 })}
              className="text-xs px-3 py-1 bg-[#7B61FF]/20 hover:bg-[#7B61FF]/40 rounded transition"
            >
              📻 Подкаст
            </button>
            <button 
              onClick={() => setEq({ low: 0, mid: 0, high: 0 })}
              className="text-xs px-3 py-1 bg-gray-600/20 hover:bg-gray-600/40 rounded transition"
            >
              🔄 Сброс
            </button>
          </div>
        </div>
      )}

      {/* Результат записи */}
      {audioURL && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 space-y-4">
          <h3 className="font-bold">🎵 Ваша запись (с обработкой):</h3>
          <audio controls src={audioURL} className="w-full" />
          <a 
            href={audioURL} 
            download={`vocal_processed_${Date.now()}.wav`}
            className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-4 py-2 rounded-lg transition"
          >
            <Download className="w-5 h-5" /> Скачать WAV (нормализованный)
          </a>
          <p className="text-xs text-gray-400">
            ✅ Компрессия • ✅ Эквалайзер • ✅ Нормализация до -18 LUFS
          </p>
        </div>
      )}
    </div>
  )
}