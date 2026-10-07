const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const [root, action] = process.argv.slice(2)
if (!fs.realpathSync.native(root).toLowerCase().startsWith(path.join(fs.realpathSync.native(require('node:os').tmpdir()), 'yaya-squirrel-check-').toLowerCase())) throw Error('只允许隔离数据。')
const directory = path.join(root, 'isolated-app-data/Yaya-companion-manager/sqlite')
fs.mkdirSync(directory,{recursive:true})
const {openFormalDatabase} = require('../.electron-main/sqlite-service.cjs')
const service = openFormalDatabase(path.join(directory,'yaya-companion.db'),true)
if(action==='seed') {
  service.execute('bosses.create',[{id:'UPGRADE-CHECK',nickname:'隔离升级测试',hourlyRateCents:3500,notes:''}])
  service.execute('balances.changeBalance',['UPGRADE-CHECK',{type:'recharge',amountCents:7000,notes:'升级前保存'}])
}
const state={bosses:service.execute('bosses.list',[]),history:service.execute('history.read',[])}
service.close()
const snapshot=path.join(root,'business-before.json')
if(action==='seed')fs.writeFileSync(snapshot,JSON.stringify(state))
else assert.deepEqual(state,JSON.parse(fs.readFileSync(snapshot,'utf8')))
console.log(action==='seed'?'隔离账目已保存':'升级后隔离老板、余额和历史完全一致')
