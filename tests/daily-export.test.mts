import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import ExcelJS from 'exceljs'
import {openFormalDatabase} from '../electron/sqlite/migration.ts'
import {DailyExportManager,buildDailyWorkbook,dailyRange} from '../electron/sqlite/dailyExport.ts'
import {calculateStatistics} from '../src/features/statistics/statistics.ts'
import {historyDate,readableNotes,recentRecords} from '../src/features/history/presentation.ts'

test('历史最近3条、展开、收起；备注隐藏 UUID 不改变原数据',()=>{
  const data=[1,2,3,4,5];assert.deepEqual(recentRecords(data,false),[1,2,3]);assert.deepEqual(recentRecords(data,true),data);assert.deepEqual(recentRecords(data,false),[1,2,3]);assert.deepEqual(recentRecords([1,2],false),[1,2])
  const original='订单 12345678-1234-1234-1234-123456789abc，结束订单，一次性结算';assert.equal(readableNotes(original),'结束订单，一次性结算');assert.match(original,/12345678/)
})
test('日报生成、同日覆盖、次日独立文件、四张业务表与统计一致、历史快照保留',async t=>{
  const root=mkdtempSync(join(tmpdir(),'yaya-daily-')),file=join(root,'formal.db'),service=openFormalDatabase(file,true)
  t.after(()=>{service.close();rmSync(root,{recursive:true,force:true})})
  const boss=service.execute('bosses.create',[{id:'A',nickname:'小鱼',hourlyRateCents:3500,notes:''}]) as {profileId:string}
  service.execute('balances.changeBalance',['A',{type:'recharge',amountCents:7000,notes:''}])
  service.execute('tips.create',[boss.profileId,{amountCents:2000,receivedAt:new Date().toISOString(),notes:'谢谢'}])
  const order=service.execute('orders.start',['A']) as {id:string};service.execute('orders.complete',[order.id])
  const data=service.snapshot(),now=Date.now(),date=historyDate(now),manager=new DailyExportManager(root,'sqlite',()=>now)
  manager.request(data);await manager.whenIdle();assert.equal(manager.info().error,null)
  const path=join(manager.directory,`YayaDiary-${date}.xlsx`),book=new ExcelJS.Workbook();await book.xlsx.readFile(path)
  for(const name of ['每日概览','订单记录','余额流水','打赏记录'])assert(book.getWorksheet(name))
  const stats=calculateStatistics(data,dailyRange(date,now)),row=book.getWorksheet('每日概览')!.getRow(2)
  assert.equal(row.getCell(3).value,stats.serviceIncomeCents/100);assert.equal(row.getCell(4).value,20);assert.equal(row.getCell(5).value,stats.incomeCents/100);assert.equal(row.getCell(6).value,70)
  assert.equal(book.getWorksheet('订单记录')!.rowCount,2);assert.equal(book.getWorksheet('余额流水')!.rowCount,3);assert.equal(book.getWorksheet('打赏记录')!.rowCount,2)
  assert.equal(book.getWorksheet('余额流水')!.getRow(1).font.bold,true);assert.equal(book.getWorksheet('余额流水')!.views[0].state,'frozen');assert.match(book.getWorksheet('打赏记录')!.getColumn(3).numFmt,/¥/)
  assert(!JSON.stringify(book.getWorksheet('订单记录')!.getSheetValues()).includes(order.id))
  service.execute('bosses.remove',['A']);manager.request(service.snapshot());await manager.whenIdle()
  assert.equal(readdirSync(manager.directory).filter(n=>n.endsWith('.xlsx')).length,1)
  const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);const next=new DailyExportManager(root,'sqlite',()=>tomorrow.getTime());next.request(service.snapshot());await next.whenIdle();assert.equal(readdirSync(manager.directory).filter(n=>n.endsWith('.xlsx')).length,2)
  const reopened=new DailyExportManager(root,'sqlite');await reopened.load();assert(reopened.info().lastSuccessAt)
  const prior=readFileSync(path),bad=new DailyExportManager(root,'sqlite',()=>now,async()=>{throw Error('文件被占用')});bad.request(data);await bad.whenIdle();assert.deepEqual(readFileSync(path),prior);assert.match(bad.info().error!,/文件被占用/)
})
test('导出失败不回滚已提交充值；事务失败不触发导出；非正式模式不生成文件',async t=>{
  const root=mkdtempSync(join(tmpdir(),'yaya-daily-fail-')),service=openFormalDatabase(join(root,'formal.db'),true)
  t.after(()=>{service.close();rmSync(root,{recursive:true,force:true})})
  service.execute('bosses.create',[{id:'A',nickname:'',hourlyRateCents:3500,notes:''}])
  let attempts=0
  const manager=new DailyExportManager(root,'sqlite',Date.now,async()=>{attempts++;throw Error('模拟导出失败')})
  const base={lastChanged:false,async execute(method:string,args:unknown[]){this.lastChanged=false;const value=service.execute(method,args);this.lastChanged=true;return value}}
  const wrapped=manager.wrap(base,()=>service.snapshot())
  await wrapped.execute('balances.changeBalance',['A',{type:'recharge',amountCents:2000,notes:''}]);await wrapped.whenIdle()
  assert.equal(service.snapshot().bosses[0].balanceCents,2000);assert.equal(service.snapshot().entries.length,1);assert.equal(attempts,1)
  await assert.rejects(wrapped.execute('balances.changeBalance',['A',{type:'recharge',amountCents:-1,notes:''}]));await wrapped.whenIdle();assert.equal(attempts,1)
  for(const mode of ['sqlite-test','local-storage']){const disabled=new DailyExportManager(root,mode,Date.now,async()=>{throw Error('不应执行')});disabled.request(service.snapshot());await disabled.whenIdle();assert.equal(disabled.info().enabled,false)}
})
test('跨天日报概览沿用统计拆分与暂停排除，订单表整单与日报区分',()=>{
  const start=new Date(2026,9,7,23,50).getTime(),end=new Date(2026,9,8,0,30).getTime()
  const order={id:'hidden',bossId:'A',nicknameSnapshot:'',hourlyRateCentsSnapshot:3500,startedAt:start,endedAt:end,status:'completed' as const,accumulatedMs:1800000,pauses:[{startedAt:start+300000,endedAt:start+900000}],settledServiceSeconds:1800,settledAmountCents:1750,finalChargeCents:1750,balanceAtEndCents:0,endReason:'用户手动结束',createdAt:start}
  const data={orders:[order],entries:[],tips:[]}
  for(const date of ['2026-10-07','2026-10-08']){const expected=calculateStatistics(data,dailyRange(date,end)),book=buildDailyWorkbook(data,date,end);assert.equal(book.getWorksheet('每日概览')!.getRow(2).getCell(3).value,expected.serviceIncomeCents/100)}
})
test('补录打赏与修改日期会更新受影响旧日报；删除后旧日报金额归零',async t=>{
  const root=mkdtempSync(join(tmpdir(),'yaya-daily-tip-')),service=openFormalDatabase(join(root,'formal.db'),true)
  t.after(()=>{service.close();rmSync(root,{recursive:true,force:true})})
  const boss=service.execute('bosses.create',[{id:'A',nickname:'',hourlyRateCents:3500,notes:''}]) as {profileId:string}
  const manager=new DailyExportManager(root,'sqlite'),base={lastChanged:false,async execute(method:string,args:unknown[]){this.lastChanged=false;const result=service.execute(method,args);this.lastChanged=true;return result}},wrapped=manager.wrap(base,()=>service.snapshot())
  const old=new Date();old.setDate(old.getDate()-2);const next=new Date();next.setDate(next.getDate()-1)
  const tip=await wrapped.execute('tips.create',[boss.profileId,{amountCents:2000,receivedAt:old.toISOString(),notes:''}]) as {id:string};await wrapped.whenIdle()
  await wrapped.execute('tips.update',[tip.id,{amountCents:3000,receivedAt:next.toISOString(),notes:''}]);await wrapped.whenIdle()
  const read=async(date:Date)=>{const book=new ExcelJS.Workbook();await book.xlsx.readFile(join(manager.directory,`YayaDiary-${historyDate(date.getTime())}.xlsx`));return book.getWorksheet('每日概览')!.getRow(2).getCell(4).value}
  assert.equal(await read(old),0);assert.equal(await read(next),30)
  await wrapped.execute('tips.remove',[tip.id]);await wrapped.whenIdle();assert.equal(await read(next),0)
})
