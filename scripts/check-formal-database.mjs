// 只读检查现有正式库：不初始化、不迁移、不结算，不加载业务服务。
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
const file = path.join(process.env.APPDATA,'Yaya-companion-manager/sqlite/yaya-companion.db')
if(!fs.existsSync(file))throw Error('正式数据库不存在，已停止检查；不会创建新数据库。')
const db = new DatabaseSync(file,{readOnly:true})
try {
  db.exec('PRAGMA query_only = ON; BEGIN')
  const integrity = db.prepare('PRAGMA integrity_check').all()
  if(integrity.length!==1 || integrity[0].integrity_check!=='ok')throw Error('正式库完整性检查失败。')
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  if(foreignKeys.length)throw Error('正式库外键检查失败。')
  const schemaVersion = db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version
  if(schemaVersion!==4)throw Error(`数据库版本 ${schemaVersion} 与当前1.2.0不一致。`)
  const counts = {}
  for(const table of ['boss_profiles','orders','balance_entries','tips'])counts[table]=db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count
  db.exec('ROLLBACK')
  console.log(JSON.stringify({file,exists:true,readOnly:true,integrity:'ok',foreignKeyErrors:0,schemaVersion,counts,businessDataModified:false},null,2))
} finally { db.close() }
