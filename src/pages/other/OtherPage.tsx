import { dataAccess } from '../../features/data/dataAccess'
import { useEffect, useState } from 'react'
import { Modal } from '../../components/dialog/Modal'
import { transitionUninstall } from '../../features/uninstall/flow'
import type { UninstallAction, UninstallStep } from '../../features/uninstall/flow'
const titles = ['', '你真的要卸载这本小小的日记吗？', '你又要离开我了对吗？', '真的要走吗？']
const images = ['', 'step-1.jpg', 'step-2.webp', 'step-3.avif']
export function OtherPage() {
  const [clearStep, setClearStep] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [clearNotice, setClearNotice] = useState('')
  const [step, setStep] = useState<UninstallStep>(0)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [availability, setAvailability] = useState({ available: false, message: window.yayaDesktop?.uninstall ? '正在检查卸载环境…' : '浏览器仅可预览确认流程，请在 Windows Portable 中卸载。' })
  useEffect(() => {
    let live = true
    const api = window.yayaDesktop?.uninstall
    if (!api) return
    void api.status().then(reply => { if (live) setAvailability(reply.ok ? reply.value : { available: false, message: reply.message }) }).catch(() => { if (live) setAvailability({ available: false, message: '无法检查卸载环境，已禁止卸载。' }) })
    return () => { live = false }
  }, [])
  function act(action: UninstallAction) { const next = transitionUninstall(step, action); setStep(next.step); setNotice(next.notice) }
  async function uninstall() {
    if (busy || !availability.available) return
    setBusy(true); setNotice('')
    try {
      const reply = await window.yayaDesktop!.uninstall!.execute()
      if (!reply.ok) throw Error(reply.message)
      setNotice('卸载已启动，应用退出后将删除程序和本机资料。')
    } catch (error) { setNotice(error instanceof Error ? error.message : '卸载启动失败，请稍后重试。'); setBusy(false) }
  }
  return <>
    <header className="page-header"><h1>其他</h1><p>应用相关操作</p></header>
    <section className="panel"><h2>卸载丫丫的陪玩日记</h2><p className="muted">离开前，你仍可以通过“数据管理”备份资料。</p><button type="button" className="text-button danger" onClick={() => act('open')}>卸载丫丫的陪玩日记</button></section>
    <section className="panel"><h2>清空测试数据</h2><p className="muted">删除所有测试模式产生的老板、订单、流水和打赏，不影响正式数据。</p><button className="text-button danger" onClick={() => { setClearNotice(''); setClearStep(1) }}>清空测试数据</button>{clearNotice && <p role="status">{clearNotice}</p>}</section>
    {clearStep > 0 && <Modal title={clearStep === 1 ? '确定要清空全部测试数据吗？' : '确认清空测试数据'} busy={clearing} onClose={() => setClearStep(0)}>
      {clearStep === 2 && <p>测试模式中的老板、订单、流水和打赏都会被删除，正式数据不会受到影响。此操作不可恢复。</p>}
      <div className="form-actions"><button className="button" disabled={clearing} onClick={() => setClearStep(0)}>取消</button><button className="button primary" disabled={clearing} onClick={() => {
        if (clearStep === 1) { setClearStep(2); return }
        setClearing(true)
        void Promise.resolve().then(() => dataAccess.testing.clear()).then(() => { setClearStep(0); setClearNotice('测试数据已清空，正式数据未改变。') }).catch(e => setClearNotice(e instanceof Error ? e.message : '清理失败，数据未更改。')).finally(() => setClearing(false))
      }}>{clearing ? '正在清理…' : clearStep === 1 ? '继续' : '确认清空'}</button></div>
      {clearNotice && <p role="status">{clearNotice}</p>}
    </Modal>}
    {notice && step === 0 && <p role="status">{notice}</p>}
    {step > 0 && <Modal key={step} title={titles[step]} onClose={() => act('cancel')} busy={busy}>
      <div className="uninstall-content">
        <img className="uninstall-image" src={`${import.meta.env.BASE_URL}uninstall/${images[step]}`} alt={`卸载确认配图${step}`} />
        {step === 3 && <p className="uninstall-warning">这将删除程序文件、快捷方式以及本机保存的数据（数据库、自动备份、Excel 日报），且不可恢复。</p>}
        {step === 3 && !availability.available && <p role="status" className="muted">{availability.message}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="uninstall-actions">
          {step === 1 && <><button type="button" onClick={() => act('cancel')}>骗你的我才舍不得呢</button><button type="button" className="text-button danger" onClick={() => act('next')}>是的我自己记也可以</button></>}
          {step === 2 && <><button type="button" onClick={() => act('cancel')}>不是的！我们和好！</button><button type="button" onClick={() => act('cancel')}>我才不会不会离开你呢！</button><button type="button" className="text-button danger" onClick={() => act('next')}>嗯。</button></>}
          {step === 3 && <><button type="button" disabled={busy} onClick={() => act('stay')}>你好好哄哄我我们就和好！</button><button type="button" className="text-button danger" disabled={busy || !availability.available} onClick={() => void uninstall()}>{busy ? '正在准备卸载…' : '我真的走了，以后的日子照顾好自己。'}</button></>}
        </div>
      </div>
    </Modal>}
  </>
}
