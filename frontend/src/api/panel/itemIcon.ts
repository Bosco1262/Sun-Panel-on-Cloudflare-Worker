import { post } from '@/utils/request'

export function addMultiple<T>(req: Panel.ItemInfo[]) {
  return post<T>({
    url: '/panel/itemIcon/addMultiple',
    data: req,
  })
}

export function edit<T>(req: Panel.ItemInfo) {
  return post<T>({
    url: '/panel/itemIcon/edit',
    data: req,
  })
}

export function getListByGroupId<T>(itemIconGroupId: number | undefined) {
  return post<T>({
    url: '/panel/itemIcon/getListByGroupId',
    data: { itemIconGroupId },
  })
}

export function deletes<T>(ids: number[]) {
  return post<T>({
    url: '/panel/itemIcon/deletes',
    data: { ids },
  })
}

export function saveSort<T>(data: Panel.ItemIconSortRequest) {
  return post<T>({
    url: '/panel/itemIcon/saveSort',
    data,
  })
}

// Fetches the site icon candidates (the frontend shows a dialog when there are several)
// 获取站点图标候选列表 (多候选时前端弹窗选择)
export function getSiteFaviconCandidates<T>(url: string) {
  return post<T>({
    url: '/panel/itemIcon/getSiteFaviconCandidates',
    data: { url },
  })
}

// Stores the chosen site icon (url = the chosen candidate, pageUrl = the site address the user entered)
// 保存选中的站点图标 (url = 选中的候选, pageUrl = 用户填写的站点地址)
export function saveSiteFavicon<T>(url: string, pageUrl: string) {
  return post<T>({
    url: '/panel/itemIcon/saveSiteFavicon',
    data: { url, pageUrl },
  })
}
