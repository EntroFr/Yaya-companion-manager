import { formalData } from '../../src/features/data/formalData.ts'
import ExcelJS from 'exceljs'
import { mkdir, rename, unlink, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HistoryData } from '../../src/features/data/contracts.ts'
import { calculateStatistics, serviceIntervals } from '../../src/features/statistics/statistics.ts'
import { formatDuration, serviceDurationMs } from '../../src/features/orders/orderTime.ts'
import { balanceLabels,compactTime,historyDate,readableNotes } from '../../src/features/history/presentation.ts'
import { displayNickname } from '../../src/features/bosses/bossPresentation.ts'

export interface DailyExportInfo { enabled:boolean; directory:string; lastSuccessAt:string|null; error:string|null }
export function dailyRange(date:string,now:number) {
  const [y,m,d]=date.split('-').map(Number),start=new Date(y,m-1,d),next=new Date(y,m-1,d+1)
  return {start:start.getTime(),end:Math.min(next.getTime()-1,now)}
}
export function buildDailyWorkbook(data:HistoryData,date:string,now:number) {
  data = formalData(data)
  const range=dailyRange(date,now),stats=calculateStatistics(data,range),book=new ExcelJS.Workbook()
  const orders=data.orders.filter(o=>serviceIntervals(o,range.end).some(i=>i.end>range.start&&i.start<=range.end)||(o.endedAt!==null&&o.endedAt>=range.start&&o.endedAt<=range.end)||(o.startedAt>=range.start&&o.startedAt<=range.end))
  const within=(s:string)=>Date.parse(s)>=range.start&&Date.parse(s)<=range.end
  const money='"¥"#,##0.00;"-¥"#,##0.00'
  function sheet(name:string,headers:string[],rows:ExcelJS.CellValue[][],amounts:number[]=[]) {
    const s=book.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]})
    s.columns=headers.map(h=>({header:h,width:h.includes('时间')?22:h==='备注'?36:20}))
    s.addRows(rows);s.getRow(1).font={bold:true};s.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}}
    for(const col of amounts)s.getColumn(col).numFmt=money
    return s
  }
  sheet('每日概览',['日期','有效服务总时长','服务收入','打赏收入','实际收入','充值收款','当日订单数量'],[[date,formatDuration(stats.serviceMs),stats.serviceIncomeCents/100,stats.tipCents/100,stats.incomeCents/100,stats.rechargeCents/100,orders.length]],[3,4,5,6])
  sheet('订单记录',['老板 ID','老板昵称','开始时间','结束时间','有效服务时长','最终消费','结束时余额','结束原因','状态'],orders.sort((a,b)=>b.startedAt-a.startedAt).map(o=>[o.bossId,displayNickname(o.nicknameSnapshot),compactTime(o.startedAt),o.endedAt===null?'未结束':compactTime(o.endedAt),formatDuration(serviceDurationMs(o,now)),o.finalChargeCents===null?'未结算':o.finalChargeCents/100,o.balanceAtEndCents===null?'未记录':o.balanceAtEndCents/100,o.endReason??'—',{active:'进行中',paused:'已暂停',completed:'已结束'}[o.status]]),[6,7])
  sheet('余额流水',['老板 ID','老板昵称','类型','金额变化','变化前余额','变化后余额','时间','备注'],data.entries.filter(e=>within(e.createdAt)).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(e=>[e.bossId,displayNickname(e.nicknameSnapshot??''),balanceLabels[e.type],e.deltaCents/100,e.beforeCents/100,e.afterCents/100,compactTime(e.createdAt),readableNotes(e.notes)]),[4,5,6])
  sheet('打赏记录',['老板 ID','老板昵称','打赏金额','收到时间','备注'],data.tips.filter(t=>within(t.receivedAt)).sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)).map(t=>[t.bossIdSnapshot,displayNickname(t.nicknameSnapshot),t.amountCents/100,compactTime(t.receivedAt),t.notes]),[3])
  const explanation=book.addWorksheet('说明',{views:[{state:'frozen',ySplit:1}]});explanation.columns=[{width:90}];explanation.addRows([['报表说明'],['每日概览复用收入统计口径，跨天服务按有效区间分摊。'],['订单记录列出当日涉及的订单，时长与最终消费为整单信息，不可直接相加作为当日服务收入。'],['进行中订单统计截至导出时间；暂停不计时。日报仅在启动或业务写入后更新，不逐秒更新。'],['SQLite 是业务数据源；Excel 为辅助日报，不能替代数据库备份。']])
  explanation.getRow(1).font={bold:true}
  return book
}
interface BusinessService {lastChanged:boolean;execute(method:string,args:unknown[]):Promise<unknown>}
export class DailyExportManager {
  readonly directory:string
  private readonly mode:string
  private lastSuccessAt:string|null=null
  private error:string|null=null
  private pending=new Map<string,{data:HistoryData;now:number}>()
  private running:Promise<void>|null=null
  private readonly clock:()=>number
  private readonly writer:(book:ExcelJS.Workbook,file:string)=>Promise<void>
  constructor(root:string,mode:string,clock:()=>number=Date.now,writer=(book:ExcelJS.Workbook,file:string)=>book.xlsx.writeFile(file)) {
    this.directory=join(root,'exports','daily');this.mode=mode;this.clock=clock;this.writer=writer
  }
  info():DailyExportInfo {return {enabled:this.mode==='sqlite',directory:this.directory,lastSuccessAt:this.lastSuccessAt,error:this.error}}
  async load() {if(this.mode!=='sqlite')return;try{const s=JSON.parse(await readFile(join(this.directory,'export-status.json'),'utf8'));if(typeof s.lastSuccessAt==='string'&&Number.isFinite(Date.parse(s.lastSuccessAt)))this.lastSuccessAt=s.lastSuccessAt}catch{/* 初次运行无配置正常。 */}}
  request(data:HistoryData,dates=[historyDate(this.clock())]) {
    if(this.mode!=='sqlite')return
    const now=this.clock()
    for(const date of dates)if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=historyDate(now))this.pending.set(date,{data:structuredClone(data),now})
    if(!this.running)this.running=Promise.resolve().then(()=>this.drain()).finally(()=>{this.running=null})
  }
  private async drain() {
    while(this.pending.size) {
      const [date,job]=this.pending.entries().next().value!;this.pending.delete(date)
      const temporary=join(this.directory,`.${randomUUID()}.xlsx`)
      try {
        await mkdir(this.directory,{recursive:true})
        await this.writer(buildDailyWorkbook(job.data,date,job.now),temporary)
        await rename(temporary,join(this.directory,`YayaDiary-${date}.xlsx`))
        this.lastSuccessAt=new Date().toISOString();this.error=null
        const state=join(this.directory,'export-status.json')
        await writeFile(state+'.new',JSON.stringify({lastSuccessAt:this.lastSuccessAt}),'utf8');await rename(state+'.new',state)
      } catch(e) {this.error=`每日 Excel 导出失败：${e instanceof Error?e.message:'未知错误'}。业务数据已保存，下次启动或业务变更时将重试。`;console.warn(this.error)}
      finally {await unlink(temporary).catch(()=>{})}
    }
  }
  async whenIdle(){await this.running}
  wrap(base:BusinessService,snapshot:()=>HistoryData):BusinessService & {whenIdle:()=>Promise<void>} {
    return {
      get lastChanged(){return base.lastChanged},
      execute: async (method,args) => {
        let previous:HistoryData['tips'][number]|undefined
        try {if(this.mode==='sqlite'&&['tips.update','tips.remove'].includes(method))previous=snapshot().tips.find(t=>t.id===args[0])}
        catch(e){this.error='日报旧日期读取失败，业务操作将继续。';console.warn(this.error,e)}
        const result=await base.execute(method,args)
        if(base.lastChanged&&this.mode==='sqlite') {
          // 业务已提交；导出调度中的任何异常也不得改变业务成功结果。
          try {
            const data=snapshot(),dates=new Set([historyDate(this.clock())])
            if(previous)dates.add(historyDate(previous.receivedAt))
            if(method.startsWith('tips.'))for(const tip of data.tips)if(tip.id===(result as {id?:string}|undefined)?.id)dates.add(historyDate(tip.receivedAt))
            if(method==='orders.complete') {
              const order=data.orders.find(o=>o.id===args[0])
              if(order){const start=new Date(order.startedAt);start.setHours(0,0,0,0);while(start.getTime()<=order.endedAt!){dates.add(historyDate(start.getTime()));start.setDate(start.getDate()+1)}}
            }
            this.request(data,[...dates])
          } catch(e){this.error='每日 Excel 调度失败，业务数据已保存。';console.warn(this.error,e)}
        }
        return result
      },
      whenIdle:()=>this.whenIdle(),
    }
  }
}
