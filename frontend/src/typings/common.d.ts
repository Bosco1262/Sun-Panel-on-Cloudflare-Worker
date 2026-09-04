declare namespace Common {
    interface ListResponse<T> {	
        list:T
        count:number
    }

    interface ListRequest{	
        limit:number
        page:number
        keyword?:string
    }

    interface InfoBase{	
        createTime?:string
        updateTime?:string
        id?:number
    }

    interface SortItemRequest{
        id:number
        sort:number
    }
}