import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bossDetailHash, parseRoute } from '../src/app/navigation.ts'
test('首页搜索跳转按唯一ID定位详情，特殊字符和中文ID可刷新恢复', () => {
  for (const id of ['Boss-01', '老板/小鱼 #1', 'a%?&=']) {
    assert.deepEqual(parseRoute(bossDetailHash(id)), { page: 'bosses', bossId: id })
  }
  assert.deepEqual(parseRoute('#bosses'), { page: 'bosses', bossId: null })
  assert.deepEqual(parseRoute('#dashboard'), { page: 'dashboard', bossId: null })
  assert.deepEqual(parseRoute('#statistics'), { page: 'statistics', bossId: null })
  assert.deepEqual(parseRoute('#bosses/%ZZ'), { page: 'bosses', bossId: null })
})
