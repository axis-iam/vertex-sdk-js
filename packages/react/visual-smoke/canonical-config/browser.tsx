import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthDialog, IamProvider, SignIn, SignInButton } from '@axis-iam/vertex-react'
import { CustomAuth } from './CustomAuth.js'

const query = new URLSearchParams(location.search)
const entry = query.get('entry') ?? 'embedded'
const theme = query.get('theme') ?? 'light'
const locale = query.get('locale') === 'zh-CN' ? 'zh-CN' : 'en'
function Dialog() {
  const [open, setOpen] = useState(false)
  return <AuthDialog mode="embedded" open={open} onOpenChange={setOpen}
    style={{ maxWidth: 420 }} signInProps={{ allowSignUp: false }}>
    <SignInButton>Open canonical sign-in</SignInButton>
  </AuthDialog>
}
const host = document.getElementById('app')!
createRoot(host).render(<IamProvider clientId="canonical-client" issuerUri={location.origin}
  redirectUri={`${location.origin}/callback`} audience="application-resource"
  colorScheme={theme === 'system' ? 'system' : theme === 'dark' ? 'dark' : 'light'} locale={locale}
  appearance={{ primaryColor: '#164e63', borderRadius: '10px' }}
  darkAppearance={{ backgroundColor: '#14212b', textColor: '#f1f5f9' }}>
  {entry === 'dialog' ? <Dialog /> : entry === 'custom' ? <CustomAuth /> : <SignIn mode="embedded" allowSignUp={false} />}
</IamProvider>)
