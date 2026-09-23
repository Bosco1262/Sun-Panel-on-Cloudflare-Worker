import type { Router } from 'vue-router'

export function setupPageGuard(router: Router) {
  router.beforeEach((_to, _from, next) => {
    // The single-user version has no admin routes, so upstream's "block admin paths for non-admins" is dead logic
    // (and matching paths like /administrator with to.path.includes('admin') misfires), hence it was removed entirely.
    // Real permission checks live in the backend authMiddleware; visiting / shows the public panel and needs no guard.
    //
    // 单用户版没有 admin 路由, 上游的「非管理员拦截 admin 路径」已是死逻辑
    // (且用 to.path.includes('admin') 匹配 /administrator 之类路径会误判), 故整体移除。
    // 真正的权限校验在后端 authMiddleware; 访问 / 是公开面板, 无需拦截。
    next()
  })
}
