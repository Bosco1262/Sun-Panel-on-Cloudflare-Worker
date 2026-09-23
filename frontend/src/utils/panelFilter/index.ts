/**
 * Pure logic behind the home page's "search bar filters items"
 *
 * Background: the old implementation rendered a shallow copy of each matching group and the interaction
 * callbacks looked the group up in the original array by index; after filtering the matching indexes shift, so
 * hover / sorting was written to a different group. Here "match decision + view building" is extracted into
 * pure functions: a view carries only the **original group object**, indexes no longer take part in any
 * interaction, and the logic can be tested outside a component.
 *
 *
 * 首页「搜索栏过滤项目」的纯逻辑
 *
 * 背景: 旧实现把命中的分组浅拷贝一份用于渲染, 交互回调再按数组下标回原数组取分组;
 * 过滤后命中的分组下标会偏移, 于是 hover / 排序被写到了别的分组上。
 * 这里把「命中判定 + 视图构建」抽成纯函数: 视图只携带**原始分组对象**,
 * 下标不再参与任何交互, 顺带让这段逻辑可以脱离组件测试。
 */

/**
 * Group view: carries the original group object plus the items currently to be rendered
 *
 * 分组视图: 携带原始分组对象 + 当前要展示的项目列表
 */
export interface ItemGroupView<T> {
  /**
   * The original group object (interaction callbacks modify it directly instead of looking it up by index)
   *
   * 原始分组对象 (交互回调直接改它, 不要用下标回查)
   */
  group: T
  /**
   * Items currently rendered: the same reference as group.items when not filtering, a matching subset when filtering
   *
   * 当前展示的项目: 未过滤时与 group.items 同一引用, 过滤时是命中的子集
   */
  items?: Panel.ItemInfo[]
}

/**
 * Whether a single item matches the keyword
 *
 * The fields match the original implementation (title / url / description, case-insensitive); an empty keyword
 * counts as matching everything (callers only use this while filtering).
 *
 *
 * 单个项目是否命中关键词
 *
 * 命中范围与原实现一致: 标题 / 网址 / 描述, 忽略大小写;
 * 空关键词视为全部命中 (调用方只在过滤时使用)。
 */
export function matchItem(item: Panel.ItemInfo, keyword: string): boolean {
  const kw = (keyword ?? '').trim().toLowerCase()
  if (!kw)
    return true

  const fields = [item?.title, item?.url, item?.description]
  return fields.some(field => typeof field === 'string' && field.toLowerCase().includes(kw))
}

/**
 * Builds the group view list the home page renders
 *
 * - enabled=false or an empty keyword: every group is returned as-is (items keeps its original reference, so drag sorting is unaffected)
 * - enabled=true: only groups with a match are kept and items is the matching subset;
 *   groups whose items are not loaded yet (items === undefined) count as no match and the caller recomputes once they are loaded
 *
 *
 * 构建首页要渲染的分组视图列表
 *
 * - enabled=false 或关键词为空: 原样返回全部分组 (items 保持原引用, 拖拽排序不受影响)
 * - enabled=true: 只保留有命中的分组, items 为命中子集;
 *   项目尚未加载 (items === undefined) 的分组按未命中处理, 加载完成后由调用方重算
 */
export function buildItemGroupViews<T extends { items?: Panel.ItemInfo[] }>(
  groups: T[],
  keyword: string,
  enabled: boolean,
): ItemGroupView<T>[] {
  if (!enabled || !(keyword ?? '').trim())
    return groups.map(group => ({ group, items: group.items }))

  const views: ItemGroupView<T>[] = []
  for (const group of groups) {
    if (!group.items)
      continue
    const items = group.items.filter(item => matchItem(item, keyword))
    if (items.length > 0)
      views.push({ group, items })
  }
  return views
}
