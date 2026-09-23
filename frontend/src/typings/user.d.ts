declare namespace User{

	interface Info{
		id?:number
		name ?:string
		createTime?:string
		username?:string
		password?:string
		headImage?:string
		status?:number
		role?:number
		mail?:string
		// userId was replaced by id
		// userId 已由 id 代替
		// userId?:string
		token?:string
		isAdmin?:number
	}


}