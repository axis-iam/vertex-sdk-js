type AccountIconName = 'profile' | 'methods' | 'password' | 'security' | 'sessions' | 'permissions' | 'check' | 'info' | 'close' | 'back' | 'authenticator' | 'recovery'

const paths: Record<AccountIconName, string> = {
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  methods: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  password: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v3',
  security: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7zM8 12l3 3 5-6',
  sessions: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  permissions: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
  check: 'm5 12 4 4L19 6',
  info: 'M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  close: 'm6 6 12 12M6 18 18 6',
  back: 'm14 6-6 6 6 6',
  authenticator: 'M7 2h10v20H7zM10 5h4M12 18h.01',
  recovery: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h3',
}

export function AccountIcon({ name, size = 20 }: { name: AccountIconName; size?: number }) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
