# 品牌资源

- `avatar.webp`：用户提供的原始图片，658 × 658；侧栏头像使用，44 × 44、圆角、等比例显示。
- `app-icon.png`：256 × 256 PNG，供预览及其他平台后续使用。
- `app-icon.ico`：16、24、32、48、64、128、256 像素多尺寸 Windows 图标；窗口、应用 EXE 和安装程序共用。

资源不依赖网络。Vite 自动复制到 `dist/brand`，生产应用从打包资源加载。
以后替换原图后，运行 `node_modules/.bin/electron.cmd scripts/generate-brand-icons.cjs` 重新生成图标，再运行 `pnpm make:win`。
生成脚本只执行本地解码、等比例缩放和格式转换，不访问业务数据。
