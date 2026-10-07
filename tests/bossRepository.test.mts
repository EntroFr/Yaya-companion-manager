import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOSS_STORAGE_KEY, LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'

function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  return { data, storage, repo: new LocalStorageBossRepository(() => storage) }
}
const input = { id: '老板-01', nickname: '小鱼', hourlyRateCents: 3500, notes: '' }

test('创建、重新读取、修改和删除；ID 与创建时间保持不变', async () => {
  const { repo, storage } = setup()
  const created = await repo.create(input)
  const reloaded = new LocalStorageBossRepository(() => storage)
  assert.deepEqual(await reloaded.list(), [created])
  const updated = await reloaded.update(input.id, { nickname: '小鱼的新备注名', hourlyRateCents: 4250, notes: '晚上上线' })
  assert.equal(updated.id, created.id)
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.hourlyRateCents, 4250)
  assert.equal(updated.notes, '晚上上线')
  await reloaded.remove(input.id)
  assert.deepEqual(await repo.list(), [])
})

test('拒绝空 ID、去除首尾空格后的重复 ID，失败不会增加数据', async () => {
  const { repo } = setup()
  await assert.rejects(repo.create({ ...input, id: '  ' }), /ID 不能为空/)
  await repo.create({ ...input, id: ` ${input.id} ` })
  await assert.rejects(repo.create(input), /已存在/)
  assert.equal((await repo.list()).length, 1)
})

test('拒绝无效单价，允许零单价', async () => {
  const { repo } = setup()
  for (const hourlyRateCents of [-1, NaN, Infinity, 3512.3]) {
    await assert.rejects(repo.create({ ...input, hourlyRateCents }), /单价/)
  }
  await repo.create({ ...input, hourlyRateCents: 0 })
})

test('损坏的本地数据不会被覆盖', async () => {
  const { repo, data } = setup()
  data.set(BOSS_STORAGE_KEY, '损坏数据')
  await assert.rejects(repo.list(), /格式异常/)
  await assert.rejects(repo.create(input), /格式异常/)
  assert.equal(data.get(BOSS_STORAGE_KEY), '损坏数据')
})

test('存储写入失败给出中文错误，原数据保留', async () => {
  const { repo, storage } = setup()
  await repo.create(input)
  const broken = new LocalStorageBossRepository(() => ({ ...storage, setItem: () => { throw new Error('quota') } }))
  await assert.rejects(broken.update(input.id, { nickname: '新名称', hourlyRateCents: 4000, notes: '' }), /保存失败/)
  await assert.rejects(broken.remove(input.id), /保存失败/)
  assert.equal((await repo.list())[0].nickname, input.nickname)
})


