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
        onlyName?: string // 唯一标识: 配合自定义 CSS/JS 美化卡片
    }

    interface ItemIconGroup extends Common.InfoBase {
        icon?: string
        title?: string
        sort?:number
        cardStyle?:number // -1 跟随全局, 0 详情图标(长条形), 1 小图标(正方形)
        textColor?:string // 空 = 跟随全局
        hideDescription?:number // 1 = 隐藏描述信息
    }

    interface ItemIcon {
        itemType: number
        src ?: string
        text ?: string
        // bgColor ?: string
        backgroundColor ?: string
    }

    interface State {
        rightSiderCollapsed: boolean
        leftSiderCollapsed: boolean
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

