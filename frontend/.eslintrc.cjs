module.exports = {
  root: true,
  extends: ['@antfu'],
  rules: {
    // Drop the red console warning
    // 取消打印标红提醒
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
  },
}
