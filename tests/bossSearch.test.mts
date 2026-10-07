import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { searchBosses, displayNickname } from '../src/features/bosses/bossPresentation.ts'
function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const bosses = new LocalStorageBossRepository(() => storage)
  return { storage, bosses }
}
test('昵称选填且可重复，ID仍必填唯一，编辑可清空昵称并持久化', async () => {
  const { storage, bosses } = setup()
  const fields = { nickname: '', hourlyRateCents: 3500, notes: '' }
  await bosses.create({ ...fields, id: 'A' })
  await bosses.create({ ...fields, id: 'B', nickname: '小鱼' })
  await bosses.create({ ...fields, id: 'C', nickname: '小鱼' })
  await assert.rejects(bosses.create({ ...fields, id: ' ' }), /不能为空/)
  await assert.rejects(bosses.create({ ...fields, id: 'A' }), /已存在/)
  await bosses.update('B', { ...fields, nickname: '  ' })
  const restored = await new LocalStorageBossRepository(() => storage).list()
  assert.equal(restored[0].nickname, '')
  assert.equal(restored[1].nickname, '')
  assert.equal(displayNickname(restored[0].nickname), '未填写昵称')
})
test('ID和昵称模糊搜索忽略大小写，支持中文、空查询和无结果', async () => {
  const { bosses } = setup()
  for (const [id, nickname] of [['Boss-ABC', 'YaYa小鱼'], ['BOSS-xyz', 'YaYa小鱼'], ['empty-01', '']]) {
    await bosses.create({ id, nickname, hourlyRateCents: 3500, notes: '' })
  }
  const list = await bosses.list()
  assert.deepEqual(searchBosses(list, ' abc ').map(b => b.id), ['Boss-ABC'])
  assert.equal(searchBosses(list, 'boss').length, 2)
  assert.equal(searchBosses(list, 'yAyA').length, 2)
  assert.equal(searchBosses(list, '小鱼').length, 2)
  assert.equal(searchBosses(list, '').length, 3)
  assert.equal(searchBosses(list, '找不到').length, 0)
  assert.equal(searchBosses(list, 'empty')[0].nickname, '')
  assert.equal(list.length, 3)
})
test('无昵称老板正常充值、开始订单、结算和重新读取快照', async () => {
  const { storage, bosses } = setup()
  await bosses.create({ id: 'NoName', nickname: '', hourlyRateCents: 3500, notes: '' })
  await bosses.changeBalance('NoName', { type: 'recharge', amountCents: 7000, notes: '' })
  let now = 1700000000000
  const orders = new LocalStorageOrderRepository({ storage: () => storage, clock: () => now })
  const order = await orders.start('NoName')
  now += 900000
  await orders.settle()
  assert.equal((await orders.list())[0].nicknameSnapshot, '')
  assert.equal((await bosses.list())[0].balanceCents, 7000)
  await orders.complete(order.id)
  assert.equal((await bosses.list())[0].balanceCents, 6125)
  assert.equal((await new LocalStorageOrderRepository({ storage: () => storage }).list())[0].status, 'completed')
})
