declare namespace Panel {

    interface Info extends ItemInfo {

    }

    interface ItemInfo extends Common.InfoBase {
        icon: ItemIcon |null
        title: string
        url: string
        sort?: number
        lanUrl?: string
        description?: string
        openMethod: number
        itemIconGroupId ?:number
        // Unique identifier: used with custom CSS/JS to style the card
        // 唯一标识: 配合自定义 CSS/JS 美化卡片
        onlyName?: string
    }

    interface ItemIconGroup extends Common.InfoBase {
        icon?: string
        title?: string
        sort?:number
        // 0 = detail icon (bar), 1 = small icon (square)
        // 0 详情图标(长条形), 1 小图标(正方形)
        cardStyle?:number
        // Empty means "follow the globals"
        // 空 = 跟随全局
        textColor?:string
        // 1 = hide the description
        // 1 = 隐藏描述信息
        hideDescription?:number
        // Group unique identifier (aligned with upstream v1.8.1): English/digits/-/_, usable as an OpenAPI field
        // 分组唯一标识 (对齐上游 v1.8.1): 英文/数字/-/_, 可用作 OpenAPI 字段
        onlyName?:string
    }

    interface ItemIcon {
        itemType: number
        src ?: string
        text ?: string
        // bgColor ?: string
        backgroundColor ?: string
    }

    /**
     * Site icon candidate (the multi-candidate dialog of "fetch icon")
     *
     * 站点图标候选 (「获取图标」多候选弹窗)
     */
    interface FaviconCandidate {
        url: string
        sizes?: string
        type?: string
        source: 'link' | 'favicon.ico' | 'icon-horse'
    }

    interface State {
        networkMode:PanelStateNetworkModeEnum | null
        panelConfig:panelConfig
        searchEngine:DeskModule.SearchBox.SearchEngineConfig
    }

    interface panelConfig{
        backgroundImageSrc?:string
        backgroundBlur?:number
        backgroundMaskNumber?:number
        iconStyle?:PanelPanelConfigStyleEnum
        iconTextColor?:string
        iconTextInfoHideDescription?:boolean
        iconTextIconHideTitle?:boolean
        logoText?:string
        logoImageSrc?:string
        // Show/hide toggles of the logo and the clock (aligned with upstream v1.8.1)
        // LOGO 与时钟的显示开关 (对齐上游 v1.8.1)
        logoShow?:boolean
        clockShow?:boolean
        clockShowSecond?:boolean
        clockColor?:string
        searchBoxShow?:boolean
        searchBoxSearchIcon?:boolean
        searchBoxBorderColor?:string
        searchBoxPlaceholderColor?:string
        // Search-bar colours (aligned with upstream v1.8.1: background / text / border)
        // 搜索栏颜色 (对齐上游 v1.8.1: 背景/文字/边框)
        searchBoxBackgroundColor?:string
        searchBoxTextColor?:string
        marginTop?:number
        marginBottom?:number
        maxWidth?:number
        maxWidthUnit:string
        marginX?:number
        footerHtml?:string
        netModeChangeButtonShow?:boolean
    }

    interface userConfig{
        panel?:panelConfig
        searchEngine?:DeskModule.SearchBox.SearchEngineConfig
    }

    interface ItemIconSortRequest{
        sortItems:Common.SortItemRequest[]
        itemIconGroupId:number
    }
}

