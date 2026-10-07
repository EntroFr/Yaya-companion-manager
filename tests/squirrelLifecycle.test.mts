import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const { handleSquirrelLifecycle } = createRequire(import.meta.url)('../electron/squirrel-lifecycle.cjs')

for (const event of ['install', 'updated', 'uninstall']) {
  test(`Squirrel ${event} 等快捷方式任务完成后退出，不提前退出`, () => {
    const exits: number[] = [], child = new EventEmitter(), calls: unknown[] = []
    const handled = handleSquirrelLifecycle({ app: { exit: (code: number) => exits.push(code) }, argv: ['app', '--other', `--squirrel-${event}`, '1.1.2'], platform: 'win32', executable: 'C:/test/app-1.1.2/YayaDiary.exe', launch: (...args: unknown[]) => { calls.push(args); return child } })
    assert.equal(handled, true); assert.deepEqual(exits, [])
    assert.match(JSON.stringify(calls), event === 'uninstall' ? /--removeShortcut=YayaDiary.exe/ : /--createShortcut=YayaDiary.exe/)
    child.emit('close', 0); child.emit('error', new Error('late'))
    assert.deepEqual(exits, [0])
  })
}
test('Squirrel obsolete 立即退出，firstrun 和正常启动不拦截', () => {
  const exits: number[] = [], app = { exit: (code: number) => exits.push(code) }
  assert.equal(handleSquirrelLifecycle({ app, platform: 'win32', argv: ['app','--squirrel-obsolete'] }), true)
  assert.deepEqual(exits,[0])
  for (const argv of [['app'], ['app','--squirrel-firstrun']]) assert.equal(handleSquirrelLifecycle({ app, platform:'win32', argv }), false)
})
test('Squirrel 子进程失败或无法启动时非零退出', () => {
  for (const mode of ['error','close','throw']) {
    const exits: number[] = [], child = new EventEmitter()
    handleSquirrelLifecycle({ app:{exit:(code:number)=>exits.push(code)}, platform:'win32', argv:['app','--squirrel-install'], launch:()=>{if(mode==='throw')throw Error('blocked');return child}, log:()=>{} })
    if(mode==='error')child.emit('error',Error('blocked'))
    if(mode==='close')child.emit('close',1)
    assert.deepEqual(exits,[1])
  }
})
test('Squirrel 超时终止钩子，不无限等待安装器', async () => {
  const exits: number[] = [], child = new EventEmitter() as EventEmitter & {kill:()=>void}; let killed=false
  child.kill=()=>{killed=true}
  handleSquirrelLifecycle({ app:{exit:(code:number)=>exits.push(code)}, platform:'win32', argv:['app','--squirrel-updated'], launch:()=>child, timeoutMs:10, log:()=>{} })
  await new Promise(resolve=>setTimeout(resolve,30))
  assert.equal(killed,true);assert.deepEqual(exits,[1])
})
