import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOSS_STORAGE_KEY, LEGACY_BOSS_STORAGE_KEY, LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { formatMoney, parseMoney, remainingServiceTime } from '../src/utils/money.ts'

function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  return { data, storage, repo: new LocalStorageBossRepository(() => storage) }
}
const input = { id: 'boss-01', nickname: '小鱼', hourlyRateCents: 3500, notes: '' }

test('旧资料迁移：ID、单价与创建时间保留，余额归零，旧数据留作备份', async () => {
  const { data, repo, storage } = setup()
  const old = JSON.stringify([{ id: input.id, nickname: input.nickname, hourlyRate: 35.1, createdAt: '2026-10-01T00:00:00.000Z', notes: '旧备注' }])
  data.set(LEGACY_BOSS_STORAGE_KEY, old)
  const [boss] = await repo.list()
  assert.equal(boss.balanceCents, 0)
  assert.equal(boss.hourlyRateCents, 3510)
  assert.equal(boss.createdAt, '2026-10-01T00:00:00.000Z')
  assert.equal(data.get(LEGACY_BOSS_STORAGE_KEY), old)
  await repo.changeBalance(boss.id, { type: 'recharge', amountCents: 100, notes: '' })
  assert.equal((await new LocalStorageBossRepository(() => storage).list())[0].balanceCents, 100)
})

test('充值、增加、扣除以及刷新后的余额和流水保持一致；同时间倒序', async () => {
  const { repo, storage } = setup()
  assert.equal((await repo.create(input)).balanceCents, 0)
  await repo.changeBalance(input.id, { type: 'recharge', amountCents: 7000, notes: '充值备注' })
  await repo.changeBalance(input.id, { type: 'manual_add', amountCents: 500, notes: '补录' })
  await repo.changeBalance(input.id, { type: 'manual_deduct', amountCents: 1000, notes: '扣除' })
  const reloaded = new LocalStorageBossRepository(() => storage)
  assert.equal((await reloaded.list())[0].balanceCents, 6500)
  const entries = await reloaded.entries(input.id)
  assert.deepEqual(entries.map(e => e.type), ['manual_deduct', 'manual_add', 'recharge'])
  assert.deepEqual(entries.map(e => [e.deltaCents, e.beforeCents, e.afterCents]), [[-1000, 7500, 6500], [500, 7000, 7500], [7000, 0, 7000]])
  assert.equal(new Set(entries.map(e => e.id)).size, 3)
  assert.equal(entries[2].notes, '充值备注')
  assert.ok(entries.every(e => e.bossId === input.id && Number.isFinite(Date.parse(e.createdAt))))
})

test('余额不足不会写流水或改余额；恰好扣完允许归零', async () => {
  const { repo, data } = setup()
  await repo.create(input)
  await repo.changeBalance(input.id, { type: 'recharge', amountCents: 100, notes: '' })
  const before = data.get(BOSS_STORAGE_KEY)
  await assert.rejects(repo.changeBalance(input.id, { type: 'manual_deduct', amountCents: 101, notes: '' }), /余额不足/)
  assert.equal(data.get(BOSS_STORAGE_KEY), before)
  await repo.changeBalance(input.id, { type: 'manual_deduct', amountCents: 100, notes: '' })
  assert.equal((await repo.list())[0].balanceCents, 0)
})

test('整数分运算精确；非法金额被拒绝；老板之间流水隔离', async () => {
  const { repo } = setup()
  await repo.create(input)
  await repo.create({ ...input, id: 'boss-02' })
  await repo.changeBalance(input.id, { type: 'recharge', amountCents: parseMoney('0.1'), notes: '' })
  await repo.changeBalance(input.id, { type: 'manual_add', amountCents: parseMoney('0.20'), notes: '' })
  assert.equal((await repo.list())[0].balanceCents, 30)
  assert.equal((await repo.entries('boss-02')).length, 0)
  for (const amountCents of [0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(repo.changeBalance(input.id, { type: 'recharge', amountCents, notes: '' }), /金额/)
  }
  assert.equal((await repo.entries(input.id)).length, 2)
})

test('存储失败时余额和流水一起保持原值', async () => {
  const { repo, storage, data } = setup()
  await repo.create(input)
  const before = data.get(BOSS_STORAGE_KEY)
  const broken = new LocalStorageBossRepository(() => ({ ...storage, setItem: () => { throw new Error('quota') } }))
  await assert.rejects(broken.changeBalance(input.id, { type: 'recharge', amountCents: 7000, notes: '' }), /保存失败/)
  assert.equal(data.get(BOSS_STORAGE_KEY), before)
  assert.equal((await repo.list())[0].balanceCents, 0)
  assert.deepEqual(await repo.entries(input.id), [])
})

test('改单价实时换算，不产生流水，不改变余额；删除资料仍保留流水', async () => {
  const { repo } = setup()
  await repo.create(input)
  await repo.changeBalance(input.id, { type: 'recharge', amountCents: 7000, notes: '' })
  assert.equal(remainingServiceTime(7000, 3500), '约 2 小时')
  const updated = await repo.update(input.id, { nickname: input.nickname, hourlyRateCents: 7000, notes: '' })
  assert.equal(updated.balanceCents, 7000)
  assert.equal(remainingServiceTime(updated.balanceCents, updated.hourlyRateCents), '约 1 小时')
  assert.equal((await repo.entries(input.id)).length, 1)
  assert.equal(remainingServiceTime(7000, 0), '单价为零，无法换算')
  await repo.remove(input.id)
  assert.equal((await repo.entries(input.id)).length, 1)
  assert.equal((await repo.list()).length, 0)
})

test('金额文本解析和两位小数格式；异常账目不覆盖', async () => {
  assert.equal(formatMoney(3500), '¥35.00')
  assert.equal(formatMoney(1), '¥0.01')
  assert.equal(parseMoney(' 70.00 '), 7000)
  for (const text of ['', '-1', '1.001', '1e3', 'NaN', '99999999999999999']) assert.throws(() => parseMoney(text), /金额/)
  const { repo, data } = setup()
  await repo.create(input)
  const raw = JSON.parse(data.get(BOSS_STORAGE_KEY)!)
  raw.bosses[0].balanceCents = 100
  const damaged = JSON.stringify(raw)
  data.set(BOSS_STORAGE_KEY, damaged)
  await assert.rejects(repo.changeBalance(input.id, { type: 'recharge', amountCents: 1, notes: '' }), /格式异常/)
  assert.equal(data.get(BOSS_STORAGE_KEY), damaged)
})

test('迁移保存失败保留旧资料；大额余额溢出不写入', async () => {
  const { data, storage, repo } = setup()
  const old = JSON.stringify([{ id: input.id, nickname: input.nickname, hourlyRate: 35, createdAt: new Date().toISOString(), notes: '' }])
  data.set(LEGACY_BOSS_STORAGE_KEY, old)
  const broken = new LocalStorageBossRepository(() => ({ ...storage, setItem: () => { throw new Error('quota') } }))
  await assert.rejects(broken.list(), /保存失败/)
  assert.equal(data.get(BOSS_STORAGE_KEY), undefined)
  assert.equal(data.get(LEGACY_BOSS_STORAGE_KEY), old)
  await repo.changeBalance(input.id, { type: 'recharge', amountCents: Number.MAX_SAFE_INTEGER, notes: '' })
  const before = data.get(BOSS_STORAGE_KEY)
  await assert.rejects(repo.changeBalance(input.id, { type: 'manual_add', amountCents: 1, notes: '' }), /安全金额/)
  assert.equal(data.get(BOSS_STORAGE_KEY), before)
})
