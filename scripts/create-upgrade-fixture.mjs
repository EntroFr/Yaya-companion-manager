// 仅用于安装升级验收，1.0.1 副本不会作为正式发布包。
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const root=resolve('out/acceptance-upgrade'),source=join(root,'source'),application=join(root,'application')
await mkdir(root,{recursive:true});await cp(resolve('out/Yaya的陪玩日记-win32-x64'),application,{recursive:true})
asar.extractAll(join(application,'resources/app.asar'),source)
const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));pkg.version='1.0.1';await writeFile(join(source,'package.json'),JSON.stringify(pkg,null,2))
await asar.createPackage(source,join(application,'resources/app.asar'))
await require('electron-winstaller').createWindowsInstaller({appDirectory:application,outputDirectory:join(root,'installer'),name:'YayaDiary',title:'Yaya的陪玩日记',exe:'YayaDiary.exe',authors:'Yaya',description:'安装升级验收副本',noMsi:true,setupExe:'YayaDiary-1.0.1-acceptance.exe'})
console.log('升级验收副本生成：',join(root,'installer/YayaDiary-1.0.1-acceptance.exe'))
