import { post } from '@/utils/request'

export function getList<T>() {
  return post<T>({
    url: '/file/getList',
  })
}

export function deletes<T>(ids: number[]) {
  return post<T>({
    url: '/file/deletes',
    data: { ids },
  })
}

/**
 * Cleans up unreferenced files (R2 objects + file records)
 *
 * 清理未被引用的文件 (R2 对象 + file 记录)
 */
export function cleanUnused<T>() {
  return post<T>({
    url: '/file/cleanUnused',
  })
}
