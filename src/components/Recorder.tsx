import { useState, useRef } from 'react'
import { Mic, Square, Download } from 'lucide-react'

export default function Recorder() {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState<string | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder.current = new MediaRecorder(stream)
      chunks.current = []
      mediaRecorder.current.ondataavailable = e => chunks.current.push(e.data)
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/wav' })
        setAudioURL(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRecorder.current.start()
      setRecording(true)
    } catch (err) {
      alert('Нет доступа к микрофону. Разрешите доступ в настройках браузера.')
    }
  }

  const stop = () => {
    if (mediaRecorder.current && recording) {
      mediaRecorder.current.stop()
      setRecording(false)
    }
  }

  return (
    <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20 text-center">
      <h2 className="text-2xl font-bold mb-6">🎤 Запись вокала</h2>
      <div className="flex justify-center gap-4 mb-6">
        {!recording ? (
          <button onClick={start} className="bg-[#00D4AA] hover:bg-[#00D4AA]/80 text-black px-8 py-4 rounded-full font-bold flex items-center gap-2 transition transform hover:scale-105">
            <Mic className="w-6 h-6" /> Начать запись
          </button>
        ) : (
          <button onClick={stop} className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 animate-pulse">
            <Square className="w-6 h-6" /> Остановить
          </button>
        )}
      </div>
      {recording && (
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-full">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            Идёт запись...
          </span>
        </div>
      )}
      {audioURL && (
        <div className="bg-[#0F0F1B] rounded-lg p-4 space-y-4">
          <h3 className="font-bold text-left">🎵 Ваша запись:</h3>
          <audio controls src={audioURL} className="w-full" />
          <a href={audioURL} download={`vocal_${Date.now()}.wav`} className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-4 py-2 rounded-lg transition">
            <Download className="w-5 h-5" /> Скачать WAV
          </a>
        </div>
      )}
    </div>
  )
}