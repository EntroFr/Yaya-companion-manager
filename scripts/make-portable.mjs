import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const asar = createRequire(import.meta.url)('@electron/asar')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {version} = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const source = path.join(root,'out/Yaya的陪玩日记-win32-x64')
const output = path.join(root,'out/portable')
const folderName = `YayaDiary-${version}`
const directory = path.join(output,folderName)
if(!fs.existsSync(path.join(source,'YayaDiary.exe'))) throw Error('请先运行 pnpm package:win。')
if(path.dirname(directory)!==output) throw Error('Portable 输出路径越界。')
fs.rmSync(directory,{recursive:true,force:true})
fs.mkdirSync(output,{recursive:true})
fs.cpSync(source,directory,{recursive:true})
// 发布清单不携带 pnpm/Vite/Forge 开发命令；Main 仍使用原来的固定正式模式。
const staging = fs.mkdtempSync(path.join(output,'.manifest-'))
const archive = path.join(directory,'resources/app.asar')
asar.extractAll(archive,staging)
const manifestFile = path.join(staging,'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile,'utf8'))
if(manifest.version!==version)throw Error('打包目录版本不一致，请重新运行 pnpm package:win。')
delete manifest.scripts
delete manifest.devDependencies
delete manifest.config
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n')
await asar.createPackage(staging,archive)
if(path.dirname(staging)!==output)throw Error('发布清单临时目录越界。')
fs.rmSync(staging,{recursive:true,force:true})
fs.writeFileSync(path.join(directory,'使用说明.txt'),`Yaya的陪玩日记 ${version} — Windows x64 Portable

完整解压文件夹后，双击 YayaDiary.exe。无需安装 Node.js 或 pnpm。
保留 resources、DLL 和其他运行文件，不要只复制 EXE。
默认使用 SQLite 正式模式。数据库：
%APPDATA%\\Yaya-companion-manager\\sqlite\\yaya-companion.db
程序目录不存放数据库，删除或更换程序目录不会删除账目。
升级：备份数据并退出旧程序；解压新版到新目录，启动新版 EXE。
同一 Windows 用户继续读取相同正式数据库；换电脑请使用备份恢复。
未签名程序仍可能受到 Windows SmartScreen 或应用控制策略限制。
Portable 不绕过这些保护。
`,'utf8')
const zip = path.join(output,`${folderName}-Portable.zip`)
// Windows 原生压缩命令；不修改或绕过脚本执行策略。
const quote = value => "'"+value.replaceAll("'","''")+"'"
const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(directory)},${quote(zip)},[IO.Compression.CompressionLevel]::Optimal,$true)`
fs.rmSync(zip,{force:true})
const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{stdio:'inherit',windowsHide:true})
if(result.error)throw result.error
if(result.status!==0)throw Error('Portable ZIP 创建失败。')
const hash=createHash('sha256').update(fs.readFileSync(zip)).digest('hex')
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),`${hash}  ${folderName}-Portable.zip\n`)
console.log(zip)
