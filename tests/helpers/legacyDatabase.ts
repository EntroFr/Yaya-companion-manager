import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../../electron/sqlite/schema.ts'
export const legacyStart = 1700000000000
// 构造真正的 1.0.0 schema 3 文件，使用其原字段和分段流水。
export function createLegacyDatabase(file: string,status: 'active'|'paused'|'completed'='active') {
  const db=new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT')
    for(const m of migrations.filter(m=>m.version<=3)) {db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.version,m.name,legacyStart)}
    db.prepare('INSERT INTO app_metadata VALUES (?,?)').run('origin','native')
    db.prepare('INSERT INTO boss_identities VALUES (?,?,?)').run('legacy-profile','A',legacyStart)
    db.prepare('INSERT INTO boss_profiles VALUES (?,?,?,?,?,?,?)').run('legacy-profile','A','旧老板',3500,status==='completed'?5658:6125,legacyStart,'原备注')
    const done=status==='completed'
    db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-order','legacy-profile','A','旧老板',3500,legacyStart,done?legacyStart+1380000:null,status,done?1380000:status==='paused'?900000:0,done?1380:900,done?1342:875,done?1342:null,done?5658:null,done?'用户手动结束':null,legacyStart,0)
    if(status==='paused')db.prepare('INSERT INTO order_pauses VALUES (?,?,?,NULL)').run('legacy-order',0,legacyStart+900000)
    const insert=db.prepare('INSERT INTO balance_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    insert.run('recharge','legacy-profile','A','旧老板',null,'recharge',7000,0,7000,null,legacyStart,'原充值')
    insert.run('segment-1','legacy-profile','A','旧老板','legacy-order','order_consumption',-875,7000,6125,900,legacyStart+900000,'15分钟自动结算')
    if(done)insert.run('segment-2','legacy-profile','A','旧老板','legacy-order','order_consumption',-467,6125,5658,1380,legacyStart+1380000,'结束补结算')
    db.exec('COMMIT')
  }finally{db.close()}
}
