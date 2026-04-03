import { useState, useEffect } from 'react'
import { CheckCircle, Circle } from 'lucide-react'

export default function LearningHub() {
  const [day, setDay] = useState(1)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('vs_day')
    if (saved) setDay(Number(saved))
  }, [])

  const finish = () => {
    setDone(true)
    const next = day < 17 ? day + 1 : day
    localStorage.setItem('vs_day', String(next))
    setDay(next)
    setTimeout(() => setDone(false), 1500)
  }

  const tasks = [
    'Запиши чистый образец голоса (30 сек)', 'Создай клон голоса в ElevenLabs', 'Сгенерируй первый трек в Suno',
    'Создай аватар в HeyGen', 'Изучи формулу промптов', 'Создай 3 трека разных жанров', 'Синхронизируй аудио и видео',
    'Изучи модели монетизации', 'Создай полный цикл продукта', 'Проанализируй метрики', 'Выбери свою нишу',
    'Освой постобработку', 'Упакуй портфолио', 'Найди первых клиентов', 'Оптимизируй воркфлоу',
    'Автоматизируй процессы', 'Запусти флагманский продукт'
  ]

  return (
    <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20">
      <h2 className="text-2xl font-bold mb-2">📚 17-дневный план</h2>
      <p className="text-gray-400 mb-6">Твой путь от новичка до мастера</p>

      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span>Прогресс</span>
          <span>{day}/17 дней</span>
        </div>
        <div className="bg-[#0F0F1B] rounded-full h-3 overflow-hidden">
          <div className="bg-gradient-to-r from-[#7B61FF] to-[#00D4AA] h-full transition-all duration-500" style={{ width: `${(day / 17) * 100}%` }} />
        </div>
      </div>

      <div className="bg-[#0F0F1B] rounded-lg p-4 mb-6 border border-[#7B61FF]/30">
        <h3 className="font-bold text-[#00D4AA] mb-2">День {day}</h3>
        <p className="text-gray-300 mb-4">{tasks[day - 1]}</p>
        <button onClick={finish} disabled={done} className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${done ? 'bg-green-500 text-white' : 'bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white'}`}>
          {done ? <><CheckCircle className="w-5 h-5" /> Выполнено!</> : <><Circle className="w-5 h-5" /> Отметить выполненным</>}
        </button>
      </div>
    </div>
  )
}