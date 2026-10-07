import { useEffect, useRef } from 'react'
import { updateBalanceAlert } from './balanceAlert'
import type { BalanceAlertState } from './balanceAlert'
let audio: AudioContext | undefined
function unlockAudio() {
  try { audio ??= new AudioContext(); if(audio.state==='suspended') void audio.resume().catch(()=>{}) } catch { /* 视觉提示始终保留。 */ }
}
export function playBalanceAlert() {
  if (!audio || audio.state !== 'running') return false
  const start=audio.currentTime
  // 离线合成两个短音，淡入淡出；不循环、不请求外部资源。
  for(const [offset,frequency] of [[0,660],[0.28,520]]) {
    const tone=audio.createOscillator(),gain=audio.createGain()
    tone.type='sine';tone.frequency.value=frequency
    gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(0.22,start+offset+0.025);gain.gain.linearRampToValueAtTime(0,start+offset+0.23)
    tone.connect(gain);gain.connect(audio.destination);tone.start(start+offset);tone.stop(start+offset+0.25)
    tone.onended=()=>{tone.disconnect();gain.disconnect()}
  }
  return true
}
export function useBalanceAlert(orderId: string | null, balanceCents: number) {
  const state=useRef<BalanceAlertState|null>(null)
  useEffect(()=>{
    document.addEventListener('pointerdown',unlockAudio);document.addEventListener('keydown',unlockAudio)
    return()=>{document.removeEventListener('pointerdown',unlockAudio);document.removeEventListener('keydown',unlockAudio)}
  },[])
  useEffect(()=>{
    const result=updateBalanceAlert(state.current,orderId,balanceCents);state.current=result.state
    if(result.alert)playBalanceAlert()
  },[orderId,balanceCents])
}
