import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPreferences, PREFERENCES_KEY } from '../src/features/settings/preferences.ts'
import { updateBalanceAlert } from '../src/features/orders/balanceAlert.ts'

test('提示音默认开启，关闭设置独立保存，重建设置服务仍为关闭', () => {
  const data = new Map<string,string>([['business', 'untouched']])
  const storage = {getItem:(key:string)=>data.get(key)??null, setItem:(key:string,value:string)=>{data.set(key,value)}}
  const prefs = createPreferences(()=>storage)
  assert.equal(prefs.getSnapshot(), true)
  let notified = 0; const unsubscribe = prefs.subscribe(()=>notified++)
  assert.equal(prefs.setSoundEnabled(false), true)
  assert.equal(prefs.getSnapshot(), false)
  assert.equal(createPreferences(()=>storage).getSnapshot(), false)
  assert.equal(data.get('business'), 'untouched')
  assert.equal(JSON.parse(data.get(PREFERENCES_KEY)!).soundEnabled, false)
  unsubscribe(); prefs.setSoundEnabled(true); assert.equal(notified, 1)
})
test('配置损坏、读取失败默认开启；写入失败仍可静音且不抛异常', () => {
  for(const raw of ['broken','null','{"soundEnabled":"false"}']) assert.equal(createPreferences(()=>({getItem:()=>raw,setItem:()=>{}})).getSnapshot(),true)
  const prefs=createPreferences(()=>{throw Error('storage blocked')})
  assert.equal(prefs.getSnapshot(),true)
  assert.equal(prefs.setSoundEnabled(false),false)
  assert.equal(prefs.getSnapshot(),false)
})
test('静音期间跨5分钟和零余额只推进状态；开启不补播，充值后新跨越正常', () => {
  let state=updateBalanceAlert(null,'A',600,6000).state
  for(const balance of [500,400,0,-100]) {
    const result=updateBalanceAlert(state,'A',balance,6000,'active',false)
    assert.equal(result.warning,false);assert.equal(result.alert,false);state=result.state
  }
  let result=updateBalanceAlert(state,'A',-100,6000,'active',true)
  assert.equal(result.warning,false);assert.equal(result.alert,false)
  result=updateBalanceAlert(result.state,'A',600,6000,'active',true)
  result=updateBalanceAlert(result.state,'A',500,6000,'active',true);assert.equal(result.warning,true)
  result=updateBalanceAlert(result.state,'A',0,6000,'active',true);assert.equal(result.alert,true)
})
test('低余额静音后立即开启不补播5分钟提醒', () => {
  const initial=updateBalanceAlert(null,'A',600,6000)
  const muted=updateBalanceAlert(initial.state,'A',500,6000,'active',false)
  assert.equal(muted.warning,false)
  assert.equal(updateBalanceAlert(muted.state,'A',500,6000,'active',true).warning,false)
})
