import { createApp } from 'vue'
import App from './App.vue'
import { setupI18n } from './locales'
import { setupAssets, setupScrollbarStyle } from './plugins'
import { setupStore } from './store'
import { setupRouter } from './router'
// Registers the SVG icons
// svg图标注册
import 'virtual:svg-icons-register'

async function bootstrap() {
  const app = createApp(App)
  setupAssets()

  setupScrollbarStyle()

  setupStore(app)

  setupI18n(app)

  await setupRouter(app)
  app.mount('#app')
}

bootstrap().catch((err) => {
  // A failed bootstrap (router/mount problem) should at least leave a log, so a blank page can be diagnosed
  // 引导失败 (路由/挂载异常) 至少留下日志, 方便定位白屏原因
  console.error('app bootstrap failed:', err)
})
