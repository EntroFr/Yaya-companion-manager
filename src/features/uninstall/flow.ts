export type UninstallStep = 0 | 1 | 2 | 3
export type UninstallAction = 'open' | 'cancel' | 'next' | 'stay'
export function transitionUninstall(step: UninstallStep, action: UninstallAction): { step: UninstallStep; notice: string } {
  if (action === 'stay') return { step: 0, notice: '给我发个平底锅我就知道啦！' }
  if (action === 'cancel') return { step: 0, notice: '' }
  if (action === 'open') return { step: 1, notice: '' }
  return { step: step === 1 ? 2 : step === 2 ? 3 : step, notice: '' }
}
