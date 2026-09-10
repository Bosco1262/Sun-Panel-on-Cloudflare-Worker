declare namespace DeskModule.SearchBox {

    /** 单个搜索引擎配置 */
    interface SearchEngine {
        /** 稳定唯一标识 (用于排序/当前选中项, 避免用对象引用比较) */
        id: string
        /** 显示名称 */
        title: string
        /** 搜索地址模板, 关键词占位符支持 %s / {keyword} / {q} */
        url: string
        /** 图标地址: http(s) 外链、站内相对路径或内置 svg */
        iconSrc?: string
        /** 备注 (可选, 仅用于自己区分) */
        remark?: string
    }

    /** 搜索引擎配置 (对应 user_config.search_engine_json) */
    interface SearchEngineConfig {
        /** 当前使用的搜索引擎 id, 空 = 列表第一项 */
        currentEngineId: string
        /** 搜索引擎列表, 顺序即搜索框与选择面板中的展示顺序 */
        engineList: SearchEngine[]
        /** 打开方式: 0=当前页面, 1=新窗口 (见 enums/panel 的 SearchEngineOpenMethodEnum) */
        openMethod: number
    }

    /** 表单校验结果 */
    interface SearchEngineValidateResult {
        /** 为 true 表示校验通过 */
        valid: boolean
        /** 名称错误信息 (i18n key) */
        titleError: string
        /** 搜索地址错误信息 (i18n key) */
        urlError: string
        /** 图标地址错误信息 (i18n key) */
        iconError: string
    }

    /** 从「网址 + 测试关键词」推断出的地址模板 */
    interface TemplateDeduceResult {
        /** 推断出的模板, 含 %s 占位符 */
        template: string
        /** 识别到的关键词参数名, 未识别到为空 */
        param: string
        /** 是否识别到了关键词参数 (false 表示只能把关键词追加到地址末尾) */
        matched: boolean
    }

}
