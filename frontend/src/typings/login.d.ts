declare namespace Login{

    interface LoginReqest{
        username:string 
        password:string
        vcode?:string
    }

	interface LoginResponse extends User.Info{
		token :string
	}

}