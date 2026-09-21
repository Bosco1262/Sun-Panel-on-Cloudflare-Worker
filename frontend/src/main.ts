import { createApp } from 'vue'
import App from './App.vue'
import { setupI18n } from './locales'
import { setupAssets, setupScrollbarStyle } from './plugins'
import { setupStore } from './store'
import { setupRouter } from './router'
import 'virtual:svg-icons-register' // svg图标注册

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
  // 引导失败 (路由/挂载异常) 至少留下日志, 方便定位白屏原因
  console.error('app bootstrap failed:', err)
})
