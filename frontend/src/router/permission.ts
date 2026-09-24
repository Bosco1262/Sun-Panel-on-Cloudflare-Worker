import type { Router } from 'vue-router'
import { useAuthStore } from '@/store'

export function setupPageGuard(router: Router) {
  // useAuthStore stays inside the callback on purpose: the guard fires at navigation time, when pinia is
  // already installed (main.ts sets the store up before the router), while a module-level call would run
  // during the import of router/index.ts — before setupStore — and crash.
  //
  // useAuthStore 刻意留在回调内: 守卫在导航时触发, 此时 pinia 已安装 (main.ts 先装 store 再装 router);
  // 若放在模块顶层, 会在 router/index.ts 被导入时执行 —— 早于 setupStore, 直接崩溃。
  router.beforeEach((to, _from, next) => {
    // /login stays public; every other route requires a signed-in session. The token itself is never
    // persisted (improvement plan §9.4 — the session travels in the HttpOnly cookie), so the persisted
    // userInfo is the only client-side marker of "signed in on this device". A stale cookie still passes
    // the guard, but the first API call then answers 1001 and the request layer redirects to /login after
    // clearing the state — so an expired session only ever costs one "登录状态已过期" warning, never a
    // home-page flash with a misleading "云端配置获取失败" toast.
    //
    // /login 保持公开; 其余路由一律要求已登录。token 本身不落盘 (改进计划 §9.4 —— 会话由 HttpOnly Cookie
    // 承担), 持久化的 userInfo 是客户端唯一可用的「本机已登录」标记。过期的 Cookie 仍能通过守卫,
    // 但第一个 API 会以 1001 应答, 请求层清掉状态后跳回 /login —— 会话过期只付出一条
    // 「登录状态已过期」, 不会再闪一下首页并弹出误导性的「云端配置获取失败」。
    if (to.path === '/login') {
      next()
      return
    }

    if (!useAuthStore().userInfo) {
      next({ path: '/login' })
      return
    }

    next()
  })
}
