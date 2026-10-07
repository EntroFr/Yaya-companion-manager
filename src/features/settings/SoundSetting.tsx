import { useState } from 'react'
import { preferences } from './preferences'
import { useSoundEnabled } from './usePreferences'
export function SoundSetting() {
  const enabled = useSoundEnabled()
  const [failed, setFailed] = useState(false)
  return <div className="sound-setting">
    <label className="sound-control" title="余额不足和余额归零时播放语音提醒">
      <svg className="sound-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></svg>
      <span>提示音</span>
      <input className="sound-switch-input" type="checkbox" role="switch" aria-label="提示音" aria-checked={enabled} checked={enabled} onChange={event => setFailed(!preferences.setSoundEnabled(event.target.checked))} />
      <span className="sound-switch-track" aria-hidden="true" />
    </label>
    {failed && <p className="sound-setting-error" role="status">设置未能保存，本次运行仍生效；重启后可能恢复之前的设置。</p>}
  </div>
}
