import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { isStepUpRequiredError } from '../core/types'
import type { AccountLoginMethod, LinkableIdentityProvider } from '../core/types'
import { useAccountLinking } from '../hooks/useAccountLinking'
import { useAccountLoginMethods } from '../hooks/useAccountLoginMethods'
import { useLinkableIdentityProviders } from '../hooks/useLinkableIdentityProviders'
import type { Appearance } from './styles'
import { buttonStyle, containerStyle, errorStyle, labelStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'
import type { IamLocalization } from '../localization'

export interface ConnectedAccountsProps {
  appearance?: Appearance
  redirectUri?: string
  redirect?: boolean
  confirmDisconnect?: boolean
  onLinkStarted?: (provider: LinkableIdentityProvider, authorizationUrl: string) => void
  onUnlinked?: () => void | Promise<void>
}

export function ConnectedAccounts({
  appearance,
  redirectUri,
  redirect = true,
  confirmDisconnect = true,
  onLinkStarted,
  onUnlinked,
}: ConnectedAccountsProps) {
  const { localization: l, locale } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const {
    methods,
    isLoading: methodsLoading,
    error: methodsError,
    refetch: refetchMethods,
  } = useAccountLoginMethods()
  const {
    providers,
    actionableProviders,
    isLoading: providersLoading,
    error: providersError,
    refetch: refetchProviders,
  } = useLinkableIdentityProviders({ includeUnsupported: true })
  const [pendingMethodId, setPendingMethodId] = useState<string | null>(null)
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<Error | null>(null)

  const refresh = async () => {
    await Promise.all([refetchMethods(), refetchProviders()])
  }

  const accountLinking = useAccountLinking({
    onAfterChange: async () => {
      await refresh()
      await onUnlinked?.()
    },
  })

  const safeError = useMemo(() => {
    return safeAccountLinkingMessage(actionError ?? accountLinking.error ?? methodsError ?? providersError, l)
  }, [accountLinking.error, actionError, l, methodsError, providersError])

  async function startProviderLink(provider: LinkableIdentityProvider) {
    setActionError(null)
    setPendingProviderId(provider.id)
    try {
      const result = await accountLinking.startLink(provider, {
        redirectUri,
        redirect,
      })
      onLinkStarted?.(provider, result.authorizationUrl)
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error(l.errors.accountLinkFailed))
    } finally {
      setPendingProviderId(null)
    }
  }

  async function unlinkMethod(method: AccountLoginMethod) {
    if (!method.unlinkable) return
    if (confirmDisconnect && typeof window !== 'undefined') {
      const confirmed = window.confirm(l.connectedAccounts.confirmDisconnect(method.displayName))
      if (!confirmed) return
    }

    setActionError(null)
    setPendingMethodId(method.methodId)
    try {
      await accountLinking.unlink(method.methodId)
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error(l.errors.accountUnlinkFailed))
    } finally {
      setPendingMethodId(null)
    }
  }

  const isLoading = methodsLoading || providersLoading

  return (
    <section style={{ ...containerStyle(a), maxWidth: 560 }} aria-label={l.connectedAccounts.aria}>
      <header style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>{l.connectedAccounts.title}</h2>
        <p style={{ margin: 0, color: a.mutedTextColor, fontSize: 14, lineHeight: '20px' }}>
          {l.connectedAccounts.description}
        </p>
      </header>

      {safeError && (
        <div role="alert" style={{ ...errorStyle(a), marginBottom: 16 }}>
          {safeError}
        </div>
      )}

      <div style={sectionStyle}>
        <h3 style={{ ...labelStyle(a), fontSize: 14, marginBottom: 10, color: a.textColor }}>{l.connectedAccounts.signInMethods}</h3>
        {isLoading && methods.length === 0 ? (
          <LoadingRows appearance={a} label={l.connectedAccounts.loading} />
        ) : methods.length === 0 ? (
          <EmptyText appearance={a}>{l.connectedAccounts.noSignInMethods}</EmptyText>
        ) : (
          <div style={listStyle}>
            {methods.map((method) => (
              <MethodRow
                key={method.methodId}
                method={method}
                appearance={a}
                localization={l}
                locale={locale}
                isPending={pendingMethodId === method.methodId}
                onUnlink={() => void unlinkMethod(method)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ ...sectionStyle, marginBottom: 0 }}>
        <h3 style={{ ...labelStyle(a), fontSize: 14, marginBottom: 10, color: a.textColor }}>{l.connectedAccounts.connectAccount}</h3>
        {providersLoading && providers.length === 0 ? (
          <LoadingRows appearance={a} count={2} label={l.connectedAccounts.loading} />
        ) : actionableProviders.length === 0 ? (
          <EmptyText appearance={a}>{l.connectedAccounts.noProviders}</EmptyText>
        ) : (
          <div style={listStyle}>
            {actionableProviders.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                appearance={a}
                localization={l}
                isPending={pendingProviderId === provider.id}
                onStart={() => void startProviderLink(provider)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function MethodRow({
  method,
  appearance,
  localization,
  locale,
  isPending,
  onUnlink,
}: {
  method: AccountLoginMethod
  appearance: Required<Appearance>
  localization: IamLocalization
  locale: string
  isPending: boolean
  onUnlink: () => void
}) {
  const title = method.kind === 'CREDENTIAL'
    ? localization.connectedAccounts.credentialType(method.credentialType)
    : method.displayName
  const detail = method.providerUserId
    ? method.providerUserId
    : method.linkedAt
      ? localization.connectedAccounts.connectedAt(formatLinkedAt(method.linkedAt, locale))
      : method.kind === 'CREDENTIAL'
        ? localization.connectedAccounts.credentialType(method.credentialType)
        : localization.connectedAccounts.connected

  return (
    <div style={rowStyle(appearance)}>
      <div style={{ minWidth: 0 }}>
        <div style={rowTitleStyle(appearance)}>{title}</div>
        <div style={rowMetaStyle(appearance)}>{detail}</div>
        {!method.unlinkable && (
          <div style={{ ...rowMetaStyle(appearance), color: appearance.warningColor }}>{localization.connectedAccounts.requiredForAccess}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onUnlink}
        disabled={!method.unlinkable || isPending}
        aria-label={localization.connectedAccounts.disconnectAria(title)}
        style={{
          ...buttonStyle(appearance, 'ghost'),
          width: 'auto',
          minWidth: 96,
          padding: '6px 10px',
          fontSize: 13,
          opacity: !method.unlinkable || isPending ? 0.55 : 1,
          cursor: !method.unlinkable || isPending ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? localization.connectedAccounts.disconnecting : localization.connectedAccounts.disconnect}
      </button>
    </div>
  )
}

function ProviderRow({
  provider,
  appearance,
  localization,
  isPending,
  onStart,
}: {
  provider: LinkableIdentityProvider
  appearance: Required<Appearance>
  localization: IamLocalization
  isPending: boolean
  onStart: () => void
}) {
  return (
    <div style={rowStyle(appearance)}>
      <div style={{ minWidth: 0 }}>
        <div style={rowTitleStyle(appearance)}>{provider.displayName}</div>
        <div style={rowMetaStyle(appearance)}>{localization.connectedAccounts.providerType(provider.providerType, provider.protocol)}</div>
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={isPending}
        aria-label={localization.connectedAccounts.connectAria(provider.displayName)}
        style={{
          ...buttonStyle(appearance),
          width: 'auto',
          minWidth: 88,
          padding: '6px 10px',
          fontSize: 13,
          opacity: isPending ? 0.65 : 1,
          cursor: isPending ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? localization.connectedAccounts.opening : localization.connectedAccounts.connect}
      </button>
    </div>
  )
}

function LoadingRows({ appearance, count = 3, label }: { appearance: Required<Appearance>; count?: number; label: string }) {
  return (
    <div style={listStyle} aria-label={label}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} style={rowStyle(appearance)}>
          <div style={{ width: '100%' }}>
            <div style={{ ...skeletonStyle(appearance), width: '42%', height: 14, marginBottom: 8 }} />
            <div style={{ ...skeletonStyle(appearance), width: '28%', height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyText({ appearance, children }: { appearance: Required<Appearance>; children: string }) {
  return <p style={{ margin: 0, color: appearance.mutedTextColor, fontSize: 14 }}>{children}</p>
}

function safeAccountLinkingMessage(error: Error | null, localization: IamLocalization): string | null {
  if (!error) return null
  if (isStepUpRequiredError(error)) {
    const methods = error.details?.methods
    return methods && methods.length > 0
      ? localization.connectedAccounts.stepUpRequiredWithMethods(methods.map((method) => localization.connectedAccounts.stepUpMethod(method)).join(', '))
      : localization.connectedAccounts.stepUpRequired
  }
  return localizeError(error, localization, 'accountLinkFailed')
}

function formatLinkedAt(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

const sectionStyle: CSSProperties = {
  marginBottom: 24,
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
}

function rowStyle(a: Required<Appearance>): CSSProperties {
  return {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 0',
  borderBottom: `1px solid ${a.borderColor}`,
  minWidth: 0,
  }
}

function rowTitleStyle(a: Required<Appearance>): CSSProperties {
  return {
  fontSize: 14,
  fontWeight: 600,
  color: a.textColor,
  overflowWrap: 'anywhere',
  }
}

function rowMetaStyle(a: Required<Appearance>): CSSProperties {
  return {
  marginTop: 2,
  fontSize: 12,
  color: a.mutedTextColor,
  overflowWrap: 'anywhere',
  }
}

function skeletonStyle(a: Required<Appearance>): CSSProperties {
  return { borderRadius: 4, backgroundColor: a.subtleColor }
}
