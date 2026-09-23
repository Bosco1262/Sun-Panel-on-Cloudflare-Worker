declare namespace DeskModule.SearchBox {

    /**
     * A single search-engine entry
     *
     * 单个搜索引擎配置
     */
    interface SearchEngine {
        /**
         * Stable unique identifier (used for ordering and the current selection, so object references are never compared)
         *
         * 稳定唯一标识 (用于排序/当前选中项, 避免用对象引用比较)
         */
        id: string
        /**
         * Display name
         *
         * 显示名称
         */
        title: string
        /**
         * Search URL template; the keyword placeholder supports %s / {keyword} / {q}
         *
         * 搜索地址模板, 关键词占位符支持 %s / {keyword} / {q}
         */
        url: string
        /**
         * Icon address: an http(s) link, a site-relative path or a built-in svg
         *
         * 图标地址: http(s) 外链、站内相对路径或内置 svg
         */
        iconSrc?: string
        /**
         * Remark (optional, only to tell engines apart)
         *
         * 备注 (可选, 仅用于自己区分)
         */
        remark?: string
    }

    /**
     * Search-engine configuration (maps to user_config.search_engine_json)
     *
     * 搜索引擎配置 (对应 user_config.search_engine_json)
     */
    interface SearchEngineConfig {
        /**
         * Id of the engine currently in use; empty means the first entry of the list
         *
         * 当前使用的搜索引擎 id, 空 = 列表第一项
         */
        currentEngineId: string
        /**
         * Engine list; the order is the order shown in the search box and the selection panel
         *
         * 搜索引擎列表, 顺序即搜索框与选择面板中的展示顺序
         */
        engineList: SearchEngine[]
        /**
         * Open method: 0 = current page, 1 = new window (see SearchEngineOpenMethodEnum in enums/panel)
         *
         * 打开方式: 0=当前页面, 1=新窗口 (见 enums/panel 的 SearchEngineOpenMethodEnum)
         */
        openMethod: number
    }

    /**
     * Form validation result
     *
     * 表单校验结果
     */
    interface SearchEngineValidateResult {
        /**
         * True means validation passed
         *
         * 为 true 表示校验通过
         */
        valid: boolean
        /**
         * Name error message (an i18n key)
         *
         * 名称错误信息 (i18n key)
         */
        titleError: string
        /**
         * Search URL error message (an i18n key)
         *
         * 搜索地址错误信息 (i18n key)
         */
        urlError: string
        /**
         * Icon URL error message (an i18n key)
         *
         * 图标地址错误信息 (i18n key)
         */
        iconError: string
    }

    /**
     * URL template deduced from "the URL + the test keyword"
     *
     * 从「网址 + 测试关键词」推断出的地址模板
     */
    interface TemplateDeduceResult {
        /**
         * The deduced template, containing the %s placeholder
         *
         * 推断出的模板, 含 %s 占位符
         */
        template: string
        /**
         * The detected keyword parameter name; empty when nothing was detected
         *
         * 识别到的关键词参数名, 未识别到为空
         */
        param: string
        /**
         * Whether a keyword parameter was detected (false means the keyword can only be appended to the end of the URL)
         *
         * 是否识别到了关键词参数 (false 表示只能把关键词追加到地址末尾)
         */
        matched: boolean
    }

}
