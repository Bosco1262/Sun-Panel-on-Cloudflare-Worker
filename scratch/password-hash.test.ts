import {
  DEFAULT_PBKDF2_ITERATIONS,
  checkPassword,
  hashPassword,
  isLegacyHash,
  needsRehash,
  passwordEncryption,
  pepperId,
  resolveIterations,
  storedPepperId,
} from '../src/utils/password'

/**
 * 密码哈希升级自检 (§3.2)
 *
 * 关键性质:
 * 1. 旧的 Go 版三重 MD5 哈希必须仍能校验 (不能把老用户挡在门外);
 * 2. 配了 pepper 之后, 新哈希必须无法脱离 pepper 校验 (D1 泄露也不能离线爆破);
 * 3. pepper 缺失/被换掉时, 必须给出可区分的失败原因, 而不是假装「密码错误」。
 */

let failed = 0
let passed = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
    console.log(`  ok   ${label}`)
  }
  else {
    failed++
    console.log(`  FAIL ${label}\n       actual   = ${a}\n       expected = ${e}`)
  }
}

const PEPPER = 'test-pepper-value'
const LEGACY_FIXTURE = '579646aad11fae4dd295812fb4526245' // 12345678 的三重 MD5 (与 migrations 种子一致)

console.log('== 旧版兼容 ==')
eq('三重 MD5 夹具', passwordEncryption('12345678'), LEGACY_FIXTURE)
eq('旧哈希被识别为 legacy', isLegacyHash(LEGACY_FIXTURE), true)
eq('v2 哈希不算 legacy', isLegacyHash('pbkdf2$sha256$5000$YQ==$Yg==$abcdef01'), false)
eq('旧哈希 + 正确密码', await checkPassword('12345678', LEGACY_FIXTURE, ''), 'ok')
eq('旧哈希 + 错误密码', await checkPassword('12345679', LEGACY_FIXTURE, ''), 'mismatch')

console.log('== v2 哈希 ==')
const v2 = await hashPassword('s3cret-password', PEPPER)
eq('格式前缀', v2.startsWith(`pbkdf2$sha256$${DEFAULT_PBKDF2_ITERATIONS}$`), true)
eq('不再是 legacy', isLegacyHash(v2), false)
eq('哈希串里的 pepperId 与当前 pepper 一致', storedPepperId(v2), await pepperId(PEPPER))
eq('pepperId 长度 8', storedPepperId(v2).length, 8)
eq('相同密码两次哈希不同 (随机盐)', await hashPassword('s3cret-password', PEPPER) === v2, false)
eq('v2 + 正确密码', await checkPassword('s3cret-password', v2, PEPPER), 'ok')
eq('v2 + 错误密码', await checkPassword('s3cret-passwore', v2, PEPPER), 'mismatch')

console.log('== pepper 异常 (fail-closed 且可区分) ==')
eq('未配置 pepper -> pepper-missing', await checkPassword('s3cret-password', v2, ''), 'pepper-missing')
eq('pepper 被换 -> pepper-changed', await checkPassword('s3cret-password', v2, 'another-pepper'), 'pepper-changed')
eq('换 pepper 后即使密码正确也不通过', await checkPassword('s3cret-password', v2, 'x'), 'pepper-changed')

console.log('== 其它脏数据 ==')
eq('空哈希', await checkPassword('x', '', PEPPER), 'mismatch')
eq('无法识别的格式', await checkPassword('x', 'not-a-hash', PEPPER), 'mismatch')
eq('截断的 v2', await checkPassword('x', 'pbkdf2$sha256$5000$YQ==', PEPPER), 'mismatch')

console.log('== resolveIterations ==')
eq('默认值', resolveIterations(undefined), DEFAULT_PBKDF2_ITERATIONS)
eq('字符串覆盖', resolveIterations('210000'), 210000)
eq('非法值回退默认', resolveIterations('abc'), DEFAULT_PBKDF2_ITERATIONS)
eq('负数回退默认', resolveIterations('-1'), DEFAULT_PBKDF2_ITERATIONS)
eq('过小被夹到下限', resolveIterations('10'), 1000)
eq('过大被夹到上限', resolveIterations('99999999'), 1000000)

console.log('== needsRehash ==')
eq('legacy 需要重算', needsRehash(LEGACY_FIXTURE), true)
eq('同迭代数 v2 不需要', needsRehash(v2, DEFAULT_PBKDF2_ITERATIONS), false)
eq('调高迭代数后需要重算', needsRehash(v2, DEFAULT_PBKDF2_ITERATIONS * 2), true)
eq('脏数据不重算', needsRehash('garbage'), false)

console.log('== CPU 预算 ==')
const t0 = performance.now()
await checkPassword('s3cret-password', v2, PEPPER)
const cost = performance.now() - t0
console.log(`  校验一次耗时 ${cost.toFixed(2)} ms (默认迭代数 ${DEFAULT_PBKDF2_ITERATIONS})`)
eq('默认迭代数下校验 < 50ms (免费版 CPU 上限 10ms)', cost < 50, true)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
