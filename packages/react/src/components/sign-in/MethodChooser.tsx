import type { CSSProperties } from 'react'
import type { Appearance } from '../styles'
import type { CredentialMethod } from './sign-in-flow'
import { useIamUi } from '../../provider/IamUiProvider'

export function MethodChooser({ methods, selectedMethod, onSelect, appearance: a }: {
  methods: { id: CredentialMethod }[]
  selectedMethod: CredentialMethod
  onSelect: (method: CredentialMethod) => void
  appearance: Required<Appearance>
}) {
  const { localization: l } = useIamUi()
  const choiceStyle = (isActive: boolean): CSSProperties => ({
    flex: 1,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: isActive ? 600 : 400,
    textAlign: 'center',
    cursor: 'pointer',
    border: `1px solid ${isActive ? a.primaryColor : a.borderColor}`,
    borderRadius: 6,
    backgroundColor: isActive ? `${a.primaryColor}12` : a.surfaceColor,
    color: isActive ? a.primaryColor : a.textColor,
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {methods.map((method) => (
        <button key={method.id} type="button" onClick={() => onSelect(method.id)} style={choiceStyle(selectedMethod === method.id)}>
          {l.auth.credentialMethod(method.id)}
        </button>
      ))}
    </div>
  )
}
