// src/worker.ts

// Кривая дисторшна
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

// Генерация импульса для реверба
const createImpulseResponse = (ctx: OfflineAudioContext, duration = 2.0, decay = 2.0): AudioBuffer => {
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

// Конвертер в WAV
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

// Главная функция обработки
async function applyEffectsOffline(
  buffer: AudioBuffer,
  settings: any
): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
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

// Слушатель сообщений из основного потока
self.onmessage = async (e) => {
  const { buffer, settings, sampleRate, channels } = e.data
  
  try {
    // 1. Восстанавливаем AudioBuffer из переданных данных
    const audioCtx = new OfflineAudioContext(channels, buffer.length / channels, sampleRate)
    const audioBuffer = audioCtx.createBuffer(channels, buffer.length / channels, sampleRate)
    
    for (let ch = 0; ch < channels; ch++) {
      const channelData = audioBuffer.getChannelData(ch)
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] = buffer[i * channels + ch]
      }
    }

    // 2. Применяем эффекты
    const processed = await applyEffectsOffline(audioBuffer, settings)
    
    // 3. Конвертируем в WAV
    const wavBlob = bufferToWav(processed)
    
    // 4. Отправляем результат
    self.postMessage({ type: 'success', blob: wavBlob }, [wavBlob])
    
  } catch (error: any) {
    self.postMessage({ type: 'error', message: error.message })
  }
}