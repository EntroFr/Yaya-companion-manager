import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { APP_STORAGE_KEY } from '../src/features/storage/appStore.ts'
import { chargeCents, liveBilling } from '../src/features/orders/billing.ts'
import { updateBalanceAlert } from '../src/features/orders/balanceAlert.ts'
async function setup(balance=7000,rate=3500) {
  const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}};let now=1700000000000
  const bosses=new LocalStorageBossRepository(()=>storage),options={storage:()=>storage,clock:()=>now},orders=new LocalStorageOrderRepository(options)
  await bosses.create({id:'A',nickname:'小鱼',hourlyRateCents:rate,notes:''});await bosses.changeBalance('A',{type:'recharge',amountCents:balance,notes:''});const order=await orders.start('A')
  return{data,storage,bosses,orders,order,options,advance:(s:number)=>{now+=s*1000},now:()=>now,balance:async()=>(await bosses.list())[0].balanceCents,consumption:async()=>(await bosses.entries('A')).filter(e=>e.type==='order_consumption')}
}
test('15/30分钟只计算消费；读取、刷新和恢复不写余额或流水',async()=>{
  const s=await setup(),before=s.data.get(APP_STORAGE_KEY);s.advance(900);await s.orders.settle();assert.equal(liveBilling(s.order,7000,s.now()).consumptionCents,875)
  s.advance(900);await new LocalStorageOrderRepository(s.options).settle();assert.equal(liveBilling(s.order,7000,s.now()).consumptionCents,1750);assert.equal(await s.balance(),7000);assert.equal((await s.consumption()).length,0);assert.equal(s.data.get(APP_STORAGE_KEY),before)
})
test('3小时结束一次扣105元，一条消费流水；重复结束拒绝',async()=>{
  const s=await setup();s.advance(10800);const done=await s.orders.complete(s.order.id);assert.equal(done.finalChargeCents,10500);assert.equal(done.balanceAtEndCents,-3500);assert.equal((await s.consumption()).length,1);assert.equal((await s.consumption())[0].deltaCents,-10500);await assert.rejects(s.orders.complete(done.id),/已结束/)
})
test('23分钟1342分，最终时长、余额和原因保留',async()=>{
  const s=await setup();s.advance(1380);const done=await s.orders.complete(s.order.id);assert.equal(done.finalChargeCents,1342);assert.equal(done.balanceAtEndCents,5658);assert.equal(done.accumulatedMs,1380000);assert.equal(done.endReason,'用户手动结束');assert.equal((await s.consumption())[0].deltaCents,-1342)
})
test('暂停不增长，恢复继续累计；单价快照和充值预计余额',async()=>{
  const s=await setup(500);s.advance(600);const paused=await s.orders.pause(s.order.id);s.advance(7200);assert.equal(liveBilling(paused,500,s.now()).consumptionCents,583)
  await s.bosses.update('A',{nickname:'新昵称',hourlyRateCents:7000,notes:''});await s.orders.resume(paused.id);s.advance(300);const current=(await s.orders.list())[0]
  assert.equal(liveBilling(current,500,s.now()).estimatedBalanceCents,-375);assert.equal(await s.balance(),500)
  await s.bosses.changeBalance('A',{type:'recharge',amountCents:1000,notes:''});assert.equal(liveBilling(current,await s.balance(),s.now()).estimatedBalanceCents,625);assert.equal((await s.consumption()).length,0)
})
test('欠费结束后充值、手动增加补回；清零仍生成独立流水',async()=>{
  const s=await setup(350);s.advance(900);await s.orders.complete(s.order.id);assert.equal(await s.balance(),-525);await s.bosses.clearDebt('A');assert.equal((await s.bosses.entries('A'))[0].type,'debt_clear');await assert.rejects(s.bosses.clearDebt('A'),/无需清零/)
  await s.bosses.changeBalance('A',{type:'recharge',amountCents:2000,notes:''});await s.bosses.changeBalance('A',{type:'manual_add',amountCents:1000,notes:''});assert.equal(await s.balance(),3000)
})
test('零秒和低单价零消费订单也只留一条最终流水；统一舍入',async()=>{
  for(const seconds of [0,1,1800]){const s=await setup(100,1);s.advance(seconds);const done=await s.orders.complete(s.order.id);assert.equal(done.finalChargeCents,chargeCents(1,seconds));assert.equal((await s.consumption()).length,1);await s.orders.list()}
  assert.equal(chargeCents(3500,1380),1342);assert.throws(()=>chargeCents(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),/安全范围/)
})
test('结束保存失败全部保持原值；只读恢复不需要写存储',async()=>{
  const s=await setup();s.advance(900);const before=s.data.get(APP_STORAGE_KEY),broken=new LocalStorageOrderRepository({...s.options,storage:()=>({...s.storage,setItem:()=>{throw new Error('quota')}})})
  await broken.settle();await assert.rejects(broken.complete(s.order.id),/保存失败/);assert.equal(s.data.get(APP_STORAGE_KEY),before);await s.orders.complete(s.order.id);assert.equal(await s.balance(),6125)
})
test('并发结束与充值不会重复扣费或丢充值',async()=>{
  const s=await setup();s.advance(900);const r=await Promise.allSettled([s.orders.complete(s.order.id),new LocalStorageOrderRepository(s.options).complete(s.order.id),s.bosses.changeBalance('A',{type:'recharge',amountCents:1000,notes:''})]);assert.equal(r.filter(x=>x.status==='rejected').length,1);assert.equal(await s.balance(),7125);assert.equal((await s.consumption()).length,1)
})
for(const paused of [false,true])test(`旧${paused?'paused':'active'}分段订单保留875分，仅补467分差额`,async()=>{
  const s=await setup(),store=JSON.parse(s.data.get(APP_STORAGE_KEY)!);delete store.orders[0].billingModel
  Object.assign(store.orders[0],{settledServiceSeconds:900,settledAmountCents:875,...(paused?{status:'paused',accumulatedMs:900000,pauses:[{startedAt:s.now()+900000,endedAt:null}]}:{})});store.bosses[0].balanceCents=6125
  const old={id:'old',bossId:'A',profileId:s.order.profileId,nicknameSnapshot:'小鱼',orderId:s.order.id,type:'order_consumption',deltaCents:-875,beforeCents:7000,afterCents:6125,settledThroughSeconds:900,createdAt:new Date(s.now()+900000).toISOString(),notes:'15分钟自动结算'};store.entries.push(old);s.data.set(APP_STORAGE_KEY,JSON.stringify(store));s.advance(1380)
  await s.orders.settle();assert.equal(await s.balance(),6125);assert.equal(liveBilling((await s.orders.list())[0],6125,s.now()).estimatedBalanceCents,paused?6125:5658)
  if(paused){await s.orders.resume(s.order.id);s.advance(480)}const done=await s.orders.complete(s.order.id);assert.equal(done.finalChargeCents,1342);assert.equal(done.balanceAtEndCents,5658);assert.deepEqual((await s.consumption()).find(e=>e.id==='old'),old);assert.equal((await s.consumption())[0].deltaCents,-467)
})
test('耗尽只在正余额跨零提醒，持续负余额不重复，充值后可再提醒',()=>{
  let state=updateBalanceAlert(null,'A',100).state;for(const [balance,expected]of [[0,true],[-100,false],[-200,false],[100,false],[0,true],[-1,false]]){const next=updateBalanceAlert(state,'A',balance);assert.equal(next.alert,expected);state=next.state}
  assert.equal(updateBalanceAlert(null,'A',-100).alert,false);assert.equal(updateBalanceAlert(state,'B',-100).alert,false);assert.equal(updateBalanceAlert(state,null,0).state,null)
})
