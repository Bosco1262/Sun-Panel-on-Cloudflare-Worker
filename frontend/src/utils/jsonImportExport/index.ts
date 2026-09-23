import CryptoJS from 'crypto-js'
import moment from 'moment'

// Current config-file version
// 当前配置文件版本
const VERSION = 1
// Lowest config-file version still supported
// 最小支持的配置文件版本号
const ALLOW_LOW_VERSION = 1
const APPNAME = 'Sun-Panel-Config'

export class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

export class ConfigVersionLowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigVersionLowError'
  }
}

export interface JsonStructure {
  version: number
  appName: 'Sun-Panel-Config'
  exportTime: string
  appVersion: string
  icons?: any
  // styleConfig: Panel.panelConfig
  md5: string
}

// Icon
// 图标
export interface Icon {
  title: string
  sort: number
  icon: Panel.ItemIcon | null
  url: string
  lanUrl: string
  description: string
  openMethod: number
  /**
   * Unique identifier (used together with custom CSS/JS); files exported by older versions do not have this field
   *
   * 唯一标识 (与自定义 CSS/JS 配合使用); 旧版本导出的文件没有此字段
   */
  onlyName?: string
}

// Icon group
// 图标组
export interface IconGroup {
  title: string
  sort: number
  children: Icon[]
}

interface ExportJsonResult {
  addIconsData(datas: IconGroup[]): ExportJsonResult
  exportFile(): void
  string(): string
}

// Exports data
// 导出数据
export function exportJson(appVersion?: string): ExportJsonResult {
  const jsonData: JsonStructure = {
    version: VERSION,
    appName: APPNAME,
    exportTime: moment().format('YYYY-MM-DD HH:mm:ss'),
    appVersion: appVersion || '',
    md5: '',
  }

  // MD5 generator
  // MD5 生成函数
  function generateMD5AndUpdate() {
    jsonData.md5 = generateMD5(JSON.stringify(jsonData))
  }

  return {
    // Add icon data
    // 添加图标信息
    addIconsData(datas: IconGroup[]) {
      jsonData.icons = datas
      return this
    },

    // Export the JSON file
    // 导出json文件
    exportFile() {
      generateMD5AndUpdate()
      const jsonString = JSON.stringify(jsonData)
      if (jsonString) {
        const blob = new Blob([jsonString], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `SunPanel-Data${moment().format('YYYYMMDDHHmm')}.sun-panel.json`
        // Some browsers only trigger the download when the <a> node is in the document
        // 部分浏览器要求 a 节点在文档中才会触发下载
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        // Release the blob URL, otherwise every export leaks one
        // 释放 blob URL, 否则每次导出都会泄漏一个
        URL.revokeObjectURL(url)
      }
    },

    // Return the JSON as a string
    // 返回字符串
    string() {
      generateMD5AndUpdate()
      return JSON.stringify(jsonData)
    },
  }
}

export interface ImportJsonResult {
  isPassCheckMd5: () => boolean
  // Whether the config (data) version is too old
  // 配置（数据）的版本是否过旧
  isPassCheckConfigVersionOld: () => boolean
  // Whether the config (data) version is too new
  // 配置（数据）的版本是否过新
  isPassCheckConfigVersionNew: () => boolean
  // Whether the import driver is the best match: equal to the config version means best, otherwise too new or too old
  // 验证程序的导入版本驱动是否为最佳 当配置文件和驱动版本相等的时候为最佳,否则不匹配过新或者过旧
  isPassCheckConfigVersionBest: () => boolean
  // A more specific type could be provided depending on the case
  // 根据实际情况提供更具体的类型定义
  jsonStruct: JsonStructure
  hasProperty: (key: string) => boolean
  geticons: () => IconGroup[] // a more specific type could be provided depending on the case
}

// Imports JSON data
// 导入json数据
export function importJsonString(jsonString: string): ImportJsonResult | null {
  let data: any
  try {
    data = JSON.parse(jsonString)
  }
  catch {
    throw new FormatError('file format error')
  }

  const jsonStruct = transformJson(data)
  if (!jsonStruct)
    throw new FormatError('file format error')

  const md5 = generateMD5(jsonString)

  if (data.version < ALLOW_LOW_VERSION)
    throw new ConfigVersionLowError('')

  return {
    isPassCheckMd5: () => md5 === jsonStruct.md5,
    isPassCheckConfigVersionOld: () => !(jsonStruct.version < VERSION),
    isPassCheckConfigVersionNew: () => !(jsonStruct.version > VERSION),
    isPassCheckConfigVersionBest: () => jsonStruct.version === VERSION,
    jsonStruct,
    hasProperty: (key: string): boolean => {
      return key in jsonStruct
    },
    geticons: (): IconGroup[] => {
      return jsonStruct.icons || []
    },
  }
}

function transformJson(jsonData: any): JsonStructure | null {
  // The top level must be an object: otherwise `key in jsonData` throws a TypeError (not our FormatError, and the
  // caller only recognises FormatError/ConfigVersionLowError, so the import would fail silently with no message)
  //
  // 顶层必须是对象: 否则 `key in jsonData` 会抛 TypeError (不是我们自己的 FormatError,
  // 调用方只会识别 FormatError/ConfigVersionLowError, 结果就是静默失败、用户没有任何提示)
  if (typeof jsonData !== 'object' || jsonData === null || Array.isArray(jsonData))
    return null

  // Check the keys that must exist
  // 检查必须存在的键
  const requiredKeys: Array<keyof JsonStructure> = ['version', 'appName', 'exportTime', 'appVersion', 'md5']
  for (const key of requiredKeys) {
    if (!(key in jsonData))
      return null
  }

  // Use a type assertion to convert the JSON data into the target type
  // 使用类型断言将 JSON 数据转换为指定类型
  const transformedData: JsonStructure = jsonData as JsonStructure

  // Return the converted data
  // 返回转换后的数据
  return transformedData
}

function generateMD5(jsonString: string): string {
  try {
    // Parse the JSON string
    // 解析 JSON 字符串
    const data: any = JSON.parse(jsonString)
    // Remove the md5 field and its value
    // 移除 md5 字段及其对应的值
    removeMD5Field(data)
    // Convert the modified JSON object back into a string
    // 将修改后的 JSON 对象转换回字符串
    const modifiedJsonString = JSON.stringify(data)
    // Compute the MD5 with crypto-js
    // 使用 crypto-js 计算 MD5 值
    const md5 = CryptoJS.MD5(modifiedJsonString).toString()
    return md5
  }
  catch (error) {
    return ''
  }
}

function removeMD5Field(obj: any): void {
  for (const key in obj) {
    if (key === 'md5') {
      // Remove the md5 field
      // 移除 md5 字段
      delete obj[key]
      return
    }
  }
}
