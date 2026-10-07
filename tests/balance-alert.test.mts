import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateBalanceAlert, formatRemainingServiceTime } from '../src/features/orders/balanceAlert.ts'
import { playLocalAlert } from '../src/features/orders/localAlertAudio.ts'

test('5分钟独立阈值、边界、持续状态与充值重新允许提醒', () => {
  let state = updateBalanceAlert(null, 'A', 600, 6000).state
  for (const [balance, warning, alert] of [[501,false,false],[500,true,false],[400,false,false],[600,false,false],[500,true,false],[0,false,true],[-100,false,false],[100,false,false],[0,false,true]] as const) {
    const result = updateBalanceAlert(state, 'A', balance, 6000)
    assert.equal(result.warning, warning); assert.equal(result.alert, alert); state = result.state
  }
})
for (const status of ['active', 'paused']) test(`恢复旧${status}低余额或欠费订单不补播；恢复阈值后可重新触发`, () => {
  for (const balance of [400, 0, -100]) {
    let result = updateBalanceAlert(null, 'old', balance, 6000, status)
    assert.equal(result.warning, false); assert.equal(result.alert, false)
    result = updateBalanceAlert(result.state, 'old', balance, 6000, 'active')
    assert.equal(result.warning, false); assert.equal(result.alert, false)
    result = updateBalanceAlert(result.state, 'old', 600, 6000)
    result = updateBalanceAlert(result.state, 'old', 500, 6000)
    assert.equal(result.warning, true)
    result = updateBalanceAlert(result.state, 'old', 0, 6000)
    assert.equal(result.alert, true)
  }
})
test('暂停期间所有跨越静默，继续不补播，充值后重新触发', () => {
  let result = updateBalanceAlert(null, 'A', 600, 6000)
  result = updateBalanceAlert(result.state, 'A', 500, 6000, 'paused')
  assert.equal(result.warning, false)
  result = updateBalanceAlert(result.state, 'A', -100, 6000, 'paused')
  assert.equal(result.alert, false)
  result = updateBalanceAlert(result.state, 'A', -100, 6000)
  assert.equal(result.alert, false)
  result = updateBalanceAlert(result.state, 'A', 600, 6000)
  result = updateBalanceAlert(result.state, 'A', 500, 6000)
  assert.equal(result.warning, true)
})
test('换订单不继承提醒，剩余时间按分秒显示', () => {
  const initial = updateBalanceAlert(null, 'A', 600, 6000)
  assert.equal(updateBalanceAlert(initial.state, 'B', 500, 6000).warning, false)
  assert.equal(updateBalanceAlert(initial.state, null, 0).state, null)
  assert.equal(formatRemainingServiceTime(272), '4分32秒')
})
test('本地录音不循环；播放拒绝和构造失败被隔离，提醒状态照常推进', async () => {
  let loop = true
  assert.equal(await playLocalAlert('local.m4a', () => ({set loop(value: boolean) {loop=value}, get loop(){return loop}, play:async()=>{}})), true)
  assert.equal(loop, false)
  assert.equal(await playLocalAlert('local.m4a', () => ({loop:false, play:async()=>{throw Error('blocked')}})), false)
  assert.equal(await playLocalAlert('local.m4a', () => {throw Error('load failed')}), false)
  const before = updateBalanceAlert(null, 'A', 600, 6000)
  const crossed = updateBalanceAlert(before.state, 'A', 500, 6000)
  assert.equal(crossed.warning, true)
  await playLocalAlert('missing.m4a', () => {throw Error('missing')})
  assert.equal(updateBalanceAlert(crossed.state, 'A', 499, 6000).warning, false)
})
