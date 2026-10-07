# 丫丫的陪玩日记官网

独立静态官网：原生 JavaScript + CSS + Vite。没有后端，不依赖 Electron。

## 本地运行

```powershell
cd website
pnpm install --ignore-workspace
pnpm dev
```

访问 http://127.0.0.1:5180/。本地未配置 GitHub 仓库时，base 为 /，下载仍使用 public/downloads/ 中的本地 ZIP。

```powershell
pnpm lint
pnpm build
pnpm preview
```

构建输出 website/dist；预览端口 5181。工作流使用 Node.js 24 LTS、pnpm 11.19.0（与现有锁文件生成环境一致），只安装和构建官网。

## 当前仓库信息

已核对 origin：https://github.com/EntroFr/Yaya-companion-manager.git。owner 为 EntroFr，repo 为 Yaya-companion-manager。生产构建默认 base 为 /Yaya-companion-manager/，下载使用该仓库的 Releases；开发模式仍保留本地下载。

deployment.js 统一计算 Pages base 和 Release URL。Actions 通过 VITE_GITHUB_REPOSITORY=${{ github.repository }} 使用真实仓库标识；普通项目仓库 base=/仓库名/，owner.github.io 仓库 base=/。

本地准备核对路径时，复制 .env.example 为 .env.local 并填写真实值：

```dotenv
VITE_GITHUB_REPOSITORY=EntroFr/Yaya-companion-manager
```

.env.local 被忽略，不需要提交。重新运行 pnpm build 后，资源应以 /Yaya-companion-manager/ 开头，下载指向 GitHub Releases。这不需要改动 Electron。

## GitHub Pages 部署

1. 当前 origin 已配置；提交部署配置后，将当前默认分支推送到 origin。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
3. 确认 Actions 已启用；默认分支应为 master 或 main（当前本地为 master）。如使用其他名称，调整 workflow 的 push.branches。
4. 推送官网修改后，或在 Actions 中手动运行 Deploy website to GitHub Pages。
5. 等待 build 和 deploy 成功，打开 deploy 输出的 Pages URL。

workflow 路径：.github/workflows/website-pages.yml。仅在默认分支的 website/ 或该 workflow 变化时自动部署；也支持 workflow_dispatch。构建步骤只执行 website/ 的 frozen-lockfile 安装、lint、build。上传前明确移除 dist 中的 ZIP，确保 Portable 不进入 Pages artifact。不会安装或构建 Electron，也不会创建 Release 或上传 ZIP。

部署采用 GitHub 官方 Pages artifact 和 OIDC 流程。仅部署 job 获得 pages:write、id-token:write；构建 job 只有 contents:read。Pages 配置需要在 GitHub 网站手动启用。

官网发布到 https://EntroFr.github.io/Yaya-companion-manager/，用户主页仓库使用根目录地址。若以后绑定自定义域名，需要另行配置 base 和域名，不要把默认项目路径直接照搬。

## Release asset 下载

本阶段没有上传任何 ZIP。必须先确保 GitHub 已存在 v1.2.1 tag，再在 Releases → Draft a new release 中选择现有 v1.2.1 tag，不要移动或重建 tag。

将经过验收的 YayaDiary-1.2.1-Portable.zip 作为 asset 手动上传，再 Publish release。文件应保持该名称，大小与 SHA256 建议再次核对。

Actions 构建后的下载目标为：

```text
https://github.com/EntroFr/Yaya-companion-manager/releases/download/v1.2.1/YayaDiary-1.2.1-Portable.zip
```

只有 Release 已发布且文件上传成功，下载才可用。不要上传至 Git 仓库，ZIP 继续被忽略。公开官网供用户下载时，Release asset 也应能匿名访问。

目前 website/public/downloads/ 中的本地 ZIP 仍保留，适用于本地开发下载检查；不会由 Pages workflow 上传。若手动上传 dist 到其他主机，也应排除 ZIP，避免重复分发。

## 更新网站与下载版本

- 修改教程、图片或样式并推送默认分支，Actions 自动重新发布；只更改业务程序代码不会触发网站部署。
- 替换软件版本时，先手动发布新 Release 和对应 ZIP，然后编辑 src/config.js 唯一的 version，例如 1.2.1；网站展示、文件名和 Release URL 会同步变化。
- 保持 Release tag 为 v版本号、资产名称为 YayaDiary-版本号-Portable.zip。
- 如果 Release 位于不同仓库，应明确修改下载配置；不要把 Pages 仓库标识误用于其他仓库的下载。
- 新版本软件本身的构建、tag 和发布是独立工作，不由官网 workflow 执行。

## 教程与检查

public/tutorial/ 管理截图；content.js 管理步骤和文件名。缺失图片显示占位；已有图片支持放大。首页工作台仍为标注的界面示意。公开截图请使用虚构资料。

scripts/check-layout.cjs 使用主项目已有 Electron 做本地隔离检查，不属于 Pages 构建依赖；目前该脚本仍针对本地下载配置，远端 Release 发布后可另行检查真实下载。

## 官方参考

- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://vite.dev/guide/static-deploy.html
- https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-desktop-icons-in-windows
