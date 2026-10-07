import { site, assetUrl } from './config.js'
// 仅使用实际已提供的资源；缺失的文件在构建与开发模式下都展示占位。
const images = import.meta.glob('../public/tutorial/*.{png,jpg,jpeg,webp,avif}', { eager: true, query: '?url', import: 'default' })
export function screenshotMarkup(step, escape) {
  const exists = step.screenshot && Object.hasOwn(images, `../public/tutorial/${step.screenshot}`)
  if (!exists) return `<div class="screenshot-placeholder" role="img" aria-label="${escape(step.title)}截图待补充"><span class="placeholder-symbol">▧</span><strong>${escape(step.title)}</strong><span>操作截图待补充</span></div>`
  return `<button class="screenshot-button" type="button" aria-label="放大查看：${escape(step.title)}"><img class="tutorial-image" src="${escape(assetUrl(site.tutorialDirectory + step.screenshot))}" alt="${escape(step.title)}操作截图" loading="lazy" width="960" height="540"><span>点击放大查看</span></button>`
}
export function setupScreenshotViewer() {
  const dialog = document.createElement('dialog')
  dialog.className = 'screenshot-viewer'
  dialog.setAttribute('aria-label', '教程截图预览')
  dialog.innerHTML = '<button type="button" class="viewer-close" aria-label="关闭截图预览">关闭 ×</button><img alt="">'
  document.body.append(dialog)
  const preview = dialog.querySelector('img')
  dialog.querySelector('button').addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close() })
  dialog.addEventListener('close', () => { preview.removeAttribute('src') })
  for (const button of document.querySelectorAll('.screenshot-button')) {
    const image = button.querySelector('img')
    image.addEventListener('error', () => {
      const placeholder = document.createElement('div')
      placeholder.className = 'screenshot-placeholder'
      placeholder.setAttribute('role', 'img')
      placeholder.setAttribute('aria-label', image.alt + '暂不可用')
      const title = document.createElement('strong'); title.textContent = image.alt
      const caption = document.createElement('span'); caption.textContent = '操作截图待补充'
      placeholder.append(title, caption); button.replaceWith(placeholder)
    })
    button.addEventListener('click', () => { preview.src = image.src; preview.alt = image.alt; dialog.showModal() })
  }
}
