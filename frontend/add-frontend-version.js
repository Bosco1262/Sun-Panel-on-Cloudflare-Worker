const fs = require('fs')
// const { execSync } = require('child_process')
const moment = require('moment')

// Latest git tag
// git 最新标签
// const latestTag = execSync('git describe --tags --abbrev=0').toString().trim()

// The version number is generated in Beijing time (CI runs in UTC; utcOffset aligns it with the 'Asia/Shanghai'
// note above, otherwise a build between 00:00 and 08:00 Beijing time would produce the previous day's date)
//
// 版本号按北京时间生成 (CI 运行在 UTC, 用 utcOffset 对齐注释里的 'Asia/Shanghai',
// 否则北京时间 0:00-8:00 构建会生成前一天的日期)
const packDate = moment().utcOffset(8).format('YYYYMMDD')

// Content to append
// 要追加的内容
const contentToAppend = `\nVITE_APP_VERSION=${packDate}`
const envFilePath = '.env'
const exampleFilePath = '.env.example'

// In CI / Workers Build, .env is excluded by .gitignore; fall back to generating it from .env.example
// CI / Workers Build 环境里 .env 被 .gitignore 排除，此时用 .env.example 兜底生成
if (!fs.existsSync(envFilePath)) {
  if (fs.existsSync(exampleFilePath)) {
    fs.copyFileSync(exampleFilePath, envFilePath)
    console.log('.env not found, created from .env.example.')
  }
  else {
    fs.writeFileSync(envFilePath, '', 'utf-8')
    console.log('.env and .env.example not found, created an empty .env.')
  }
}

// Read the original file content
// 读取文件原始内容
let envContent = fs.readFileSync(envFilePath, 'utf-8')

const versionRegex = /^VITE_APP_VERSION=.*$/m
if (versionRegex.test(envContent)) {
  // Find and replace the VITE_APP_VERSION=* line with a regular expression
  // 使用正则表达式查找并替换 VITE_APP_VERSION=* 这一行
  envContent = envContent.replace(versionRegex, contentToAppend)
}
else {
  // Append the content
  // 追加内容
  envContent = envContent + contentToAppend
}

// Write the new content back to the .env file
// 将新内容写回 .env 文件
fs.writeFileSync(envFilePath, envContent)

console.log('update to .env file.', contentToAppend)
