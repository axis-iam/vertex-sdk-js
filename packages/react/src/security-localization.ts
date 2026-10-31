export const securityEnglish = {
  title: 'Security verification', description: 'Protect sign-in with an authenticator and recovery codes.',
  loading: 'Loading security', retry: 'Try again', unavailable: 'This action is not available right now. Try another verification method or contact support.',
  totp: 'Authenticator app', enabled: 'Enabled', disabled: 'Not enabled', enroll: 'Set up authenticator', disable: 'Turn off authenticator',
  authenticatorDetail: 'Use codes from your authenticator as an extra sign-in check.',
  recoveryDetail: 'Keep backup codes somewhere safe in case you lose access to your authenticator.',
  recovery: 'Recovery codes', generate: 'Generate recovery codes', regenerate: 'Generate a new set',
  confirmGenerate: 'A new set replaces every previous recovery code. Keep the new codes somewhere safe.',
  confirmDisable: 'Turning off your authenticator signs you out. You will need to sign in again.',
  confirm: 'Continue', back: 'Back', cancel: 'Cancel setup', cancelConfirm: 'Cancel this operation? Any setup material will stop working.', keep: 'Keep setting up', cancelNow: 'Confirm cancellation',
  password: 'Current password', code: 'Verification code', verify: 'Verify and continue', choose: 'Choose a verification method', email: 'Email code', send: 'Send account code',
  provider: 'Confirm with provider', providerDone: 'I have returned from the provider', stepUp: 'Use an existing authenticator', webauthn: 'Use security key',
  begin: 'Show setup instructions', setup: 'Scan with your authenticator app, or enter the setup key manually. Then enter its six-digit code.', qr: 'Authenticator setup QR code', secret: 'Manual setup key', issuer: 'Issuer', complete: 'Confirm setup',
  committed: 'Change completed', enrolled: 'Authenticator enabled. You can now generate recovery codes.', cancelled: 'Operation cancelled', expired: 'Setup expired. Its material is no longer available. Check the latest status before starting again.',
  relogin: 'Your change succeeded. Sign in again to continue.', signIn: 'Sign in again', done: 'Done',
  uncertain: 'The result is not confirmed. Check this operation before making another change.', query: 'Check this operation', recoverCreate: 'Recover original request',
  recoveryTitle: 'Confirm your security change',
  recoverySignIn: 'Your session ended before the result could be confirmed. Sign in to the same account, then check this operation. The change will not be sent again.',
  recoveryReady: 'You are signed in again. Check the saved operation to confirm its result. No change will be sent again.',
  forgetReceipt: 'Forget saved operation', forgetHint: 'Forgetting only removes this saved status check. It does not cancel or undo the change.',
  lostMaterial: 'Setup material was not received or has been cleared. Cancel this operation before starting a new setup.',
  lostCodes: 'This set was generated, but its codes cannot be shown again. Confirm a new generation if you need another set.',
  saveCodes: 'Save these codes now. They will not be shown again.', copy: 'Copy', copied: 'Copied', download: 'Download codes',
  error: 'We could not complete that step. Check the operation and try again.', wrongCode: 'That code did not match. Try a current code.', wrongPassword: 'That password did not match. Try again.',
  sendUnavailable: 'We cannot send a code right now. Try another method or try again later.', conflict: 'Your sign-in methods changed. Check this operation and refresh security details.',
  busy: 'Another security operation is in progress. Resume it or wait for it to expire.', providerFailed: 'Provider confirmation did not complete. Use the same connected account and try again.',
  remaining: (count: number) => `${count} recovery codes remaining`, cooldown: (seconds: number) => `Send again in ${seconds}s`, close: 'Close security verification',
}
export type SecurityLocalization = typeof securityEnglish
export const securityZhCN: SecurityLocalization = {
  title: '安全验证', description: '使用验证器和恢复码保护账号登录。', loading: '正在读取安全状态', retry: '重试', unavailable: '暂时无法进行此操作，请使用其他验证方式或联系支持。',
  totp: '验证器应用', enabled: '已启用', disabled: '未启用', enroll: '设置验证器', disable: '停用验证器', recovery: '恢复码', generate: '生成恢复码', regenerate: '生成新恢复码',
  authenticatorDetail: '使用验证器中的动态码，为登录增加一道验证。',
  recoveryDetail: '妥善保存备用验证码，在无法使用验证器时完成验证。',
  confirmGenerate: '生成新的一组后，所有旧恢复码将失效。请妥善保存新恢复码。', confirmDisable: '停用验证器后将退出登录，你需要重新登录。', confirm: '继续', back: '返回',
  cancel: '取消设置', cancelConfirm: '确定取消本次操作？当前设置资料将失效。', keep: '继续设置', cancelNow: '确认取消',
  password: '当前密码', code: '验证码', verify: '验证并继续', choose: '选择验证方式', email: '邮箱验证码', send: '发送账号验证码', provider: '通过第三方确认', providerDone: '已从第三方返回', stepUp: '使用已有验证器', webauthn: '使用安全密钥',
  begin: '查看设置步骤', setup: '用验证器扫描二维码，或手动输入密钥，然后填写应用生成的六位验证码。', qr: '验证器设置二维码', secret: '手动设置密钥', issuer: '签发者', complete: '确认启用',
  committed: '变更已完成', enrolled: '验证器已启用，现在可以生成恢复码。', cancelled: '操作已取消', expired: '设置已到期，资料已清除。重新开始前请先查询最新状态。',
  relogin: '变更已成功，请重新登录后继续。', signIn: '重新登录', done: '完成', uncertain: '暂时无法确认结果。发起其他变更前，请先查询本次操作。', query: '查询本次操作', recoverCreate: '恢复原请求',
  recoveryTitle: '确认安全变更结果', recoverySignIn: '会话已结束，暂未确认变更结果。请登录同一账号后查询本次操作，不会重复提交变更。', recoveryReady: '已重新登录，请查询保存的操作以确认结果，不会重复提交变更。',
  forgetReceipt: '忘记保存的操作', forgetHint: '此操作仅移除保存的查询记录，不会取消或撤销变更。',
  lostMaterial: '设置资料未收到或已清除。请取消本次操作后重新开始。', lostCodes: '本组恢复码已生成，但无法再次查看。如有需要，请重新确认并生成新的一组。', saveCodes: '请立即保存恢复码，之后无法再次查看。',
  copy: '复制', copied: '已复制', download: '下载恢复码', error: '未能完成此步骤，请查询操作状态后重试。', wrongCode: '验证码不匹配，请输入当前有效的验证码。', wrongPassword: '密码不正确，请重试。',
  sendUnavailable: '暂时无法发送验证码，请选择其他方式或稍后重试。', conflict: '登录方式已发生变化，请查询本次操作并刷新安全状态。', busy: '已有安全操作正在进行，请继续该操作或等待其到期。', providerFailed: '第三方确认未完成，请使用已绑定的同一账号重试。',
  remaining: (count) => `剩余 ${count} 个恢复码`, cooldown: (seconds) => `${seconds} 秒后可重新发送`, close: '关闭安全验证',
}

export function securityErrorMessage(code: string | undefined, l: SecurityLocalization) {
  if (['INVALID_TOTP_CODE', 'INVALID_OTP', 'INVALID_CODE', 'INVALID_EMAIL_CODE', 'INVALID_MFA_CODE', 'PROOF_INVALID'].includes(code ?? '')) return l.wrongCode
  if (['INVALID_PASSWORD', 'INVALID_CREDENTIALS'].includes(code ?? '')) return l.wrongPassword
  if (['EMAIL_NOT_READY', 'EMAIL_DELIVERY_UNAVAILABLE', 'PROOF_DELIVERY_UNAVAILABLE'].includes(code ?? '')) return l.sendUnavailable
  if (code === 'STALE_LOGIN_METHOD_VERSION') return l.conflict
  if (code === 'MFA_OPERATION_IN_PROGRESS') return l.busy
  if (code?.startsWith('PROVIDER_')) return l.providerFailed
  if (['MANAGED_IDENTIFIER', 'METHOD_UNAVAILABLE', 'REAUTH_METHOD_UNAVAILABLE', 'REAUTH_REQUIRED'].includes(code ?? '')) return l.unavailable
  return l.error
}
