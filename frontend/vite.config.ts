import path from 'path'
import type { PluginOption } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'

function setupPlugins(env: ImportMetaEnv): PluginOption[] {
  return [
    vue(),
    env.VITE_GLOB_APP_PWA === 'true' && VitePWA({
      injectRegister: 'auto',
      manifest: {
        name: 'Sun-Panel',
        short_name: 'Sun-Panel',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), 'src/assets/svg-icons')],
      symbolId: '[name]',
    }),
  ]
}

export default defineConfig((env) => {
  const viteEnv = loadEnv(env.mode, process.cwd()) as unknown as ImportMetaEnv

  return {
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    plugins: setupPlugins(viteEnv),
    server: {
      host: '0.0.0.0',
      port: 1002,
      open: false,
      proxy: {
        '/api': {
          target: viteEnv.VITE_APP_API_BASE_URL,
          // Allow cross-origin
          // 允许跨域
          changeOrigin: true,
          rewrite: path => path.replace('/api/', '/api/'),
        },
        '/uploads': {
          target: viteEnv.VITE_APP_API_BASE_URL,
          // Allow cross-origin
          // 允许跨域
          changeOrigin: true,
          rewrite: path => path.replace('/uploads/', '/uploads/'),
        },
      },
    },
    build: {
      // The build output goes to dist/ at the repository root, served statically by the Worker's [assets]
      // 构建产物输出到仓库根目录 dist/, 由 Worker [assets] 静态托管
      outDir: '../dist',
      emptyOutDir: true,
      reportCompressedSize: false,
      sourcemap: false,
      commonjsOptions: {
        ignoreTryCatch: false,
      },
      // Note: terserOptions.compress.drop_console used to be configured here, but without declaring
      // minify: 'terser' (Vite 4 uses esbuild by default) it had no effect at all and required installing terser
      // on the side, so it was removed — keeping console.warn/error in the Worker/browser also helps production debugging.
      //
      // 注: 这里曾配置 terserOptions.compress.drop_console, 但未声明 minify: 'terser'
      // (Vite 4 默认用 esbuild), 该配置完全不生效且需额外安装 terser, 故移除 ——
      // Worker/浏览器里保留 console.warn/error 也有助于线上排障。
    },
  }
})
