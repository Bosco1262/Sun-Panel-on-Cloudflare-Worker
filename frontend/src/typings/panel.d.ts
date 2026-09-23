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
        // -1 follows the globals, 0 = detail icon (bar), 1 = small icon (square)
        // -1 跟随全局, 0 详情图标(长条形), 1 小图标(正方形)
        cardStyle?:number
        // Empty means "follow the globals"
        // 空 = 跟随全局
        textColor?:string
        // 1 = hide the description
        // 1 = 隐藏描述信息
        hideDescription?:number
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
        clockShowSecond?:boolean
        clockColor?:string
        searchBoxShow?:boolean
        searchBoxSearchIcon?:boolean
        searchBoxBorderColor?:string
        searchBoxPlaceholderColor?:string
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

