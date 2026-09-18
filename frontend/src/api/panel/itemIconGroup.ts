import { post } from '@/utils/request'

export function edit<T>(req: Panel.ItemIconGroup) {
  return post<T>({
    url: '/panel/itemIconGroup/edit',
    data: req,
  })
}

export function getList<T>() {
  return post<T>({
    url: '/panel/itemIconGroup/getList',
  })
}

/** 分组 + 项目一次返回 (首页用, 替代「查分组 + 逐个分组查项目」的 N+1 调用) */
export function getListWithItems<T>() {
  return post<T>({
    url: '/panel/itemIconGroup/getListWithItems',
  })
}

export function deletes<T>(ids: number[]) {
  return post<T>({
    url: '/panel/itemIconGroup/deletes',
    data: { ids },
  })
}

export function saveSort<T>(sortItems: Common.SortItemRequest[]) {
  return post<T>({
    url: '/panel/itemIconGroup/saveSort',
    data: { sortItems },
  })
}
