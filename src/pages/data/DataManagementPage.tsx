import { useEffect, useState } from 'react'
import { dataAccess } from '../../features/data/dataAccess'
import type { DatabaseInfo, BackupInfo, RestorePreview } from '../../features/data/contracts'

function Summary({ value }: { value: DatabaseInfo }) {
  return <><p>{value.name} · {value.appVersion} · 数据库版本 {value.schemaVersion}</p>
    <p className="muted">老板 {value.bosses} · 订单 {value.orders} · 流水 {value.entries} · 打赏 {value.tips}</p>
    <p className="muted">文件大小：{(value.size / 1024).toFixed(2)} KB</p><p className="muted" style={{overflowWrap:'anywhere'}}>文件位置：{value.path}</p></>
}
export function DataManagementPage() {
  const [info,setInfo]=useState<DatabaseInfo|null>(null),[backup,setBackup]=useState<BackupInfo|null>(null),[preview,setPreview]=useState<RestorePreview|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const formal=window.yayaDesktop?.mode==='sqlite'
  useEffect(()=>{ if(!formal) return; let alive=true; const load=()=>{ void dataAccess.management.info().then(v=>{if(alive)setInfo(v)}).catch(e=>{if(alive)setError(e.message)}) }; load(); const off=dataAccess.changes.subscribe(load); return()=>{alive=false;off()} },[formal])
  async function run(action:()=>Promise<void>) { setBusy(true);setError('');setNotice('');try{await action();setInfo(await dataAccess.management.info())}catch(e){setError(e instanceof Error?e.message:'数据管理失败，请保留原资料。')}finally{setBusy(false)} }
  return <><header className="page-header"><div><p className="eyebrow">YAYA’S DIARY</p><h1>数据管理</h1><p className="muted">备份陪玩日记，安心保留每一笔记录。</p></div></header>
    {!formal ? <section className="panel"><p>备份与恢复功能仅在桌面应用的 SQLite 正式模式提供。</p><a href="#migration">迁移原本地资料</a></section> : <>
      <section className="panel"><h2>当前数据库</h2>{info ? <Summary value={info}/> : <p>正在读取…</p>}<div className="form-actions">
        <button className="button primary" disabled={busy} onClick={()=>void run(async()=>{const result=await dataAccess.management.backup();if(result){setBackup(result);setNotice('备份完成。请将备份另存到安全位置。')}})}>备份数据</button>
        <button className="button" disabled={busy} onClick={()=>void run(async()=>{setPreview(await dataAccess.management.inspectRestore())})}>恢复备份</button>
        <button className="button" disabled={busy} onClick={()=>void run(()=>dataAccess.management.openFolder())}>打开数据文件夹</button>
      </div><p className="muted">恢复将替换当前资料，确认前先校验，确认后自动保留当前数据库备份。有进行中或暂停订单时不能恢复。</p>
      {error&&<p role="alert" className="feedback error">{error}</p>}{notice&&<p role="status">{notice}</p>}</section>
      {backup&&<section className="panel"><h2>最近备份</h2><p>备份时间：{new Date(backup.createdAt).toLocaleString()}</p><Summary value={backup}/></section>}
      {preview&&<section className="panel"><h2>备份校验通过，请确认恢复</h2><p style={{overflowWrap:'anywhere'}}>来源：{preview.sourcePath}</p><Summary value={preview}/>
        {(preview.active+preview.paused)>0&&<p className="feedback error">备份含未结束订单。恢复后将保留原开始时间，计时和结算会按实际经过时间继续；请确认这符合你的预期。</p>}
        <div className="form-actions"><button className="button primary" disabled={busy} onClick={()=>{
          if(window.confirm('确认用此备份替换当前全部资料吗？应用将先自动备份当前数据库。恢复失败会回到原数据。')) void run(async()=>{const result=await dataAccess.management.restore(preview.token);setBackup(result.protectedBackup);setPreview(null);setNotice('恢复成功。恢复前资料已自动备份，可在下方查看。')})
        }}>确认恢复备份</button><button className="button" disabled={busy} onClick={()=>void run(async()=>{await dataAccess.management.cancelRestore();setPreview(null)})}>取消恢复</button></div></section>}
      <section className="panel"><h2>旧版本资料</h2><p className="muted">首次使用时可以导入旧版本导出的迁移文件。已记账的正式库不会通过迁移被覆盖。</p><a className="button" href="#migration">导入旧资料</a></section>
    </>}</>
}
