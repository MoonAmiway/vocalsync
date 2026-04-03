import { useState } from 'react'
import { Mic, BookOpen, Home } from 'lucide-react'
import Recorder from './components/Recorder'
import LearningHub from './components/LearningHub'

function App() {
  const [page, setPage] = useState<'home' | 'record' | 'learn'>('home')

  return (
    <div className="min-h-screen bg-[#0F0F1B] pb-20">
      {/* Header */}
      <header className="bg-[#1A1A2E] border-b border-[#7B61FF]/20 p-4">
        <h1 className="text-2xl font-bold text-center bg-gradient-to-r from-[#7B61FF] to-[#00D4AA] bg-clip-text text-transparent">
          🎛 VocalSync Studio
        </h1>
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-4xl mx-auto">
        {page === 'home' && (
          <div className="space-y-4">
            <div className="bg-[#1A1A2E] rounded-xl p-6 border border-[#7B61FF]/20">
              <h2 className="text-xl font-bold mb-2">👋 Добро пожаловать!</h2>
              <p className="text-gray-300 mb-4">
                Начни свой 17-дневный путь к мастерству создания музыки с ИИ
              </p>
              <button 
                onClick={() => setPage('record')}
                className="bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white px-6 py-3 rounded-lg font-semibold transition"
              >
                🎤 Начать запись
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setPage('record')}
                className="bg-[#1A1A2E] p-6 rounded-xl border border-[#7B61FF]/20 hover:border-[#7B61FF] transition text-left"
              >
                <Mic className="w-8 h-8 mb-2 text-[#00D4AA]" />
                <h3 className="font-bold">Запись вокала</h3>
                <p className="text-sm text-gray-400">Запиши свой голос</p>
              </button>
              
              <button 
                onClick={() => setPage('learn')}
                className="bg-[#1A1A2E] p-6 rounded-xl border border-[#7B61FF]/20 hover:border-[#7B61FF] transition text-left"
              >
                <BookOpen className="w-8 h-8 mb-2 text-[#00D4AA]" />
                <h3 className="font-bold">Обучение</h3>
                <p className="text-sm text-gray-400">17-дневный план</p>
              </button>
            </div>
          </div>
        )}

        {page === 'record' && <Recorder />}
        {page === 'learn' && <LearningHub />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#1A1A2E] border-t border-[#7B61FF]/20 p-4">
        <div className="max-w-4xl mx-auto flex justify-around">
          <button 
            onClick={() => setPage('home')}
            className={`flex flex-col items-center gap-1 ${page === 'home' ? 'text-[#7B61FF]' : 'text-gray-400'}`}
          >
            <Home className="w-6 h-6" />
            <span className="text-xs">Главная</span>
          </button>
          <button 
            onClick={() => setPage('record')}
            className={`flex flex-col items-center gap-1 ${page === 'record' ? 'text-[#7B61FF]' : 'text-gray-400'}`}
          >
            <Mic className="w-6 h-6" />
            <span className="text-xs">Запись</span>
          </button>
          <button 
            onClick={() => setPage('learn')}
            className={`flex flex-col items-center gap-1 ${page === 'learn' ? 'text-[#7B61FF]' : 'text-gray-400'}`}
          >
            <BookOpen className="w-6 h-6" />
            <span className="text-xs">Обучение</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

export default App