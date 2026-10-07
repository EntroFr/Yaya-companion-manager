import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = dialog.current?.querySelector<HTMLElement>('input, textarea') ?? dialog.current?.querySelector<HTMLElement>('button')
    focusable?.focus()
    return () => { previous?.focus() }
  }, [])
  return <div className="modal-backdrop"><div ref={dialog} className="panel workbench-dialog" role="dialog" aria-modal="true" aria-labelledby="workbench-dialog-title" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key === 'Tab') {
      const elements = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')
      const first = elements[0], last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }}>
    <div className="section-heading"><h2 id="workbench-dialog-title">{title}</h2><button type="button" className="text-button" disabled={busy} onClick={onClose}>关闭</button></div>
    {children}
  </div></div>
}

