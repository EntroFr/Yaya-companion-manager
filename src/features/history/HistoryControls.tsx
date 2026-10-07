export function HistoryDateControl({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  return <label className="history-date">查看日期<input type="date" value={value} onChange={e=>onChange(e.target.value)} /></label>
}
export function HistoryToggle({total,expanded,onClick}:{total:number;expanded:boolean;onClick:()=>void}) {
  return total>3?<button type="button" className="text-button history-toggle" aria-expanded={expanded} onClick={onClick}>{expanded?'收起 ↑':'展开全部 ↓'}</button>:null
}
