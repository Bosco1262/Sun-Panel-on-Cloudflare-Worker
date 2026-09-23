interface StorageData<T = any> {
  data: T
  expire: number | null
}

/**
 * Local cache (localStorage)
 *
 * Note: upstream also had an AES-encrypted branch (`ls`) and a `clear()`. The former was only used by deleted
 * dead code and its key was hardcoded in the source (obfuscation rather than security), so both were removed.
 *
 *
 * 本地缓存 (localStorage)
 *
 * 说明: 上游这里还有一条 AES 加密分支 (`ls`) 与 `clear()`, 前者只被已删除的死代码使用、
 * 且密钥硬编码在源码里 (混淆意义大于安全性), 已一并移除。
 */
export function createLocalStorage(options?: { expire?: number | null }) {
  const DEFAULT_CACHE_TIME = 60 * 60 * 24 * 7

  const { expire } = Object.assign(
    {
      expire: DEFAULT_CACHE_TIME,
    },
    options,
  )

  function set<T = any>(key: string, data: T) {
    const storageData: StorageData<T> = {
      data,
      expire: expire !== null ? new Date().getTime() + expire * 1000 : null,
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(storageData))
    }
    catch (err) {
      // Quota exceeded / private mode: a failed cache write must not affect the main flow (the panel config may hold large wallpaper URLs and footer HTML)
      // 配额满 / 隐私模式: 写缓存失败不应影响主流程 (面板配置里可能含较大的壁纸地址与页脚 HTML)
      console.warn(`[storage] write ${key} failed:`, (err as Error).message)
    }
  }

  function get(key: string) {
    const json = window.localStorage.getItem(key)
    if (json) {
      let storageData: StorageData | null = null

      try {
        storageData = JSON.parse(json)
      }
      catch {
        // Corrupted cache: fall through to the remove call below and return null
        // 缓存损坏: 走下面的 remove 清理, 返回 null
      }

      if (storageData) {
        const { data, expire } = storageData
        if (expire === null || expire >= Date.now())
          return data
      }

      remove(key)
      return null
    }
  }

  function remove(key: string) {
    window.localStorage.removeItem(key)
  }

  return {
    set,
    get,
    remove,
  }
}

/**
 * Local cache that never expires (token / user info / panel config and similar)
 *
 * 永不过期的本地缓存 (token / 用户信息 / 面板配置等)
 */
export const ss = createLocalStorage({ expire: null })
