// 只转换本地图片格式，不修改品牌素材内容；使用项目已有 Electron。
const { app, nativeImage, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.whenReady().then(async () => {
  const directory = path.join(__dirname, '../public/brand')
  // nativeImage 不直接解码 WebP；用 Chromium 解码，再交给 nativeImage 转换尺寸。
  const decoder = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await decoder.loadURL('about:blank')
  const dataUrl = `data:image/webp;base64,${fs.readFileSync(path.join(directory, 'avatar.webp')).toString('base64')}`
  const decoded = await decoder.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(dataUrl)}; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/png');
  })()`)
  const source = nativeImage.createFromDataURL(decoded)
  if (source.isEmpty()) throw new Error('无法读取品牌头像。')
  const { width, height } = source.getSize()
  const side = Math.min(width, height)
  const square = source.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  fs.writeFileSync(path.join(directory, 'app-icon.png'), square.resize({ width: 256, height: 256, quality: 'best' }).toPNG())
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map(size => square.resize({ width: size, height: size, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  images.forEach((png, index) => {
    const entry = 6 + index * 16
    header[entry] = header[entry + 1] = sizes[index] % 256
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  fs.writeFileSync(path.join(directory, 'app-icon.ico'), Buffer.concat([header, ...images]))
  console.log(`品牌图标已生成：原图 ${width} × ${height}；ICO 包含 ${sizes.join('/')} 像素。`)
  decoder.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
