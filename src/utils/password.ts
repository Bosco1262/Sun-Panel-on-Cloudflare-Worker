import md5 from 'blueimp-md5'

// 与 Go 版 cmn.PasswordEncryption 一致: md5(md5(md5(password))) 小写 hex
export function passwordEncryption(password: string): string {
  return md5(md5(md5(password)))
}

export function md5Hex(str: string): string {
  return md5(str)
}
