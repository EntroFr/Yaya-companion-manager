import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createLocalStorageDataAccess } from '../src/features/storage/localStorageDataAccess.ts'
import { configureDataAccess, dataAccess } from '../src/features/data/dataAccess.ts'
import { profileKey } from '../src/features/bosses/bossIdentity.ts'
import { APP_STORAGE_KEY } from '../src/features/storage/appStore.ts'

function setup() {
  const raw = new Map<string, string>()
  const storage = { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v) }, removeItem: (k: string) => { raw.delete(k) } }
  let now = 1700000000000
  return { raw, adapter: createLocalStorageDataAccess({ storage: () => storage, clock: () => now }), advance: () => { now += 900000 } }
}
const input = { id: 'A', nickname: '小鱼', hourlyRateCents: 3500, notes: '' }

test('统一异步入口串联老板、余额、订单、暂停、打赏和一致历史/统计数据', async () => {
  const s = setup(), api = s.adapter, boss = await api.bosses.create(input)
  await api.balances.changeBalance('A', { type: 'recharge', amountCents: 7000, notes: '' })
  const order = await api.orders.start('A')
  s.advance(); await api.pauses.pause(order.id)
  const pauses = await api.pauses.list(order.id)
  assert.equal(pauses.length, 1); assert.equal(pauses[0].endedAt, null)
  pauses[0].startedAt = 0
  assert.notEqual((await api.pauses.list(order.id))[0].startedAt, 0)
  await api.pauses.resume(order.id); await api.orders.complete(order.id)
  await api.tips.create(profileKey(boss), { amountCents: 2000, receivedAt: '2026-10-07T00:00:00Z', notes: '' })
  const history = await api.history.read(), statistics = await api.statistics.read()
  assert.deepEqual(history, statistics)
  assert.deepEqual(Object.keys(history).sort(), ['entries', 'orders', 'tips'])
  assert.equal(history.orders[0].settledAmountCents, 875)
  assert.equal(history.entries.length, 2); assert.equal(history.tips.length, 1)
  assert.equal((await api.bosses.list())[0].balanceCents, 6125)
  await api.bosses.remove('A')
  assert.deepEqual(await api.history.read(), history)
  await assert.rejects(api.pauses.list('missing'), /订单不存在/)
})
test('装配入口可替换为另一实现，不需要浏览器localStorage；恢复时格式和键保持不变', async () => {
  const original = dataAccess, s = setup()
  try {
    configureDataAccess(s.adapter)
    await dataAccess.bosses.create(input)
    assert.equal((await dataAccess.bosses.list())[0].id, 'A')
    assert.deepEqual(await dataAccess.statistics.read(), { orders: [], entries: [], tips: [] })
    assert.deepEqual([...s.raw.keys()], [APP_STORAGE_KEY])
    assert.equal(JSON.parse(s.raw.get(APP_STORAGE_KEY)!).version, 3)
    assert.deepEqual(Object.keys(JSON.parse(s.raw.get(APP_STORAGE_KEY)!)).sort(), ['bosses', 'entries', 'orders', 'tips', 'version'])
    await dataAccess.development.clear()
    assert.equal(s.raw.has(APP_STORAGE_KEY), false)
    assert.deepEqual(await dataAccess.bosses.list(), [])
  } finally { configureDataAccess(original) }
})
test('通知接口封装本页与其他窗口变更，只关注应用存储键，取消订阅有效', () => {
  const windowMock = new EventTarget()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock })
  try {
    let count = 0
    const unsubscribe = setup().adapter.changes.subscribe(() => { count++ })
    windowMock.dispatchEvent(new Event('yaya:data-changed'))
    const sendStorage = (key: string | null) => { const event = new Event('storage'); Object.defineProperty(event, 'key', { value: key }); windowMock.dispatchEvent(event) }
    sendStorage('other-app'); assert.equal(count, 1)
    sendStorage(APP_STORAGE_KEY); sendStorage(null); assert.equal(count, 3)
    unsubscribe(); windowMock.dispatchEvent(new Event('yaya:data-changed')); assert.equal(count, 3)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
test('架构边界：页面、组件及React hook不直接访问存储或具体仓库实现', () => {
  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
  }
  const ui = walk('src').filter(file => file.endsWith('.tsx') || /use[A-Z].*\.ts$/.test(file))
  for (const file of ui) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /localStorage|appStore|STORAGE_KEY|DATA_CHANGED_EVENT|readStore|writeStore|from ['"][^'"]*(bossRepository|orderRepository|tipRepository|testData)['"]/, file)
  }
})
