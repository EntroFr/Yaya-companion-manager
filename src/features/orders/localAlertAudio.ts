interface AlertAudio {
  loop: boolean
  play(): Promise<void>
}
// 兼容 Vite 开发地址与 Electron 本地文件地址；只播放本地录音，不合成蜂鸣音。
export async function playLocalAlert(url: string, create: (url: string) => AlertAudio = url => new Audio(url)): Promise<boolean> {
  try {
    const audio = create(url)
    audio.loop = false
    await audio.play()
    return true
  } catch {
    // 自动播放限制、解码或文件加载失败只影响声音，界面提示仍保留。
    return false
  }
}
