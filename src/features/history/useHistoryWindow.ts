import { useState } from 'react'
import { historyDate,recentRecords } from './presentation'
export function useHistoryWindow<T>(records:T[],time:(record:T)=>number|string) {
  const [date,setDate]=useState(historyDate),[expanded,setExpanded]=useState(false)
  const filtered=records.filter(r=>historyDate(time(r))===date)
  return {date,expanded,total:filtered.length,visible:recentRecords(filtered,expanded),setDate:(value:string)=>{setDate(value);setExpanded(false)},toggle:()=>setExpanded(value=>!value)}
}
