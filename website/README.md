# 丫丫的陪玩日记官网

独立静态官网，采用原生 JavaScript + CSS + Vite，无 React、后端、账号或数据库。部署时只需静态文件；不依赖 Electron。构建工具需要 Node.js 20.19+ / 22.12+（推荐当前 Node.js LTS）和 pnpm。

## 本地运行

在仓库根目录打开终端：

```powershell
cd website
pnpm install --ignore-workspace
pnpm dev
```

访问 http://127.0.0.1:5180/，与桌面项目的 5173 端口分开。

```powershell
pnpm lint
pnpm build
pnpm preview
```

构建目录为 `website/dist/`，预览地址 http://127.0.0.1:5181/。无需修改主项目的 package 配置。

## 下载配置

只编辑 `src/config.js` 中的 `site.download`：

```js
download: {
  url: 'downloads/YayaDiary-1.2.0-Portable.zip',
  filename: 'YayaDiary-1.2.0-Portable.zip',
  available: true,
}
```

本轮默认 `available: false`，按钮提示文件待发布，避免链接指向不存在的文件。现有旧 Portable ZIP 未包含最新卸载功能，本轮没有重新打包，也没有把旧包复制到官网。

发布前将经过验收的最新 ZIP 放入 `public/downloads/`，再开启 available。ZIP 被官网 .gitignore 排除，不强制纳入 Git。单页的相对路径同时支持域名根目录和子目录部署。

建议大文件通过 GitHub Releases 提供下载。上传 ZIP 到应用仓库的 Release 后，将 url 改成实际资产地址，例如：

```js
url: 'https://github.com/你的账号/你的仓库/releases/download/v1.2.0/YayaDiary-1.2.0-Portable.zip'
```

并设置 available: true。随后重新构建官网。不要把示例账号当作真实链接。

## 图片与内容

- 品牌头像：`public/brand/avatar.webp`。
- 教程截图：`public/tutorial/`，建议 960×540，PNG/WebP/JPG。
- 教程标题、文字、截图文件名集中于 `src/content.js` 的 tutorials。
- 设置对应步骤 `screenshot: 'add-boss.webp'` 即可替换占位区域；留空继续显示占位。
- 首页工作台为明确标注的界面示意，不是真实业务截图。
- 公开截图请使用虚构资料。

## 公网部署

可部署在任意静态主机。上传 dist 文件夹中的全部内容（包括 assets、brand、tutorial、downloads），无需 Node.js 在服务器上常驻。

自动部署平台通常配置：项目根目录 website；安装命令 pnpm install --ignore-workspace；构建命令 pnpm build；发布目录 dist。若平台以仓库根目录执行，则使用 cd website 后再安装和构建，发布目录 website/dist。

GitHub Pages 可将构建产物作为 Pages artifact 发布；当前 base 为 ./，适配仓库子路径。ZIP 建议放 GitHub Releases，避免随静态站点和 Git 仓库分发大文件。

尚未执行公开发布；需要实际主机账户、域名或 Pages 配置。发布前务必确认下载文件已存在，或 Releases URL 能正常返回 ZIP。

## 本仓库视觉检查

`website/scripts/check-layout.cjs` 使用主项目已有 Electron 作为隔离 Chromium 检查工具（只用于测试，官网本身不依赖 Electron）。启动官网 dev server 后，从仓库根目录运行它，可检查 8 张卡片、16 步教程、下载目标和桌面/手机溢出情况。截图输出到被忽略的 website/.checks/。

## 文案参考

Windows 11 快捷方式步骤参照 Microsoft 官方说明：
https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-desktop-icons-in-windows

静态构建和部署参考 Vite 官方文档：
https://vite.dev/guide/static-deploy.html
