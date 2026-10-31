import { IamConfigurationError } from './types'
import type { IamConfig } from './types'

/** Reject retired discovery overrides even for untyped JavaScript consumers. */
export function validateIamConfig(config: IamConfig): void {
  for (const option of ['authMethods', 'socialProviders']) {
    if (option in config) {
      throw new IamConfigurationError(`Unsupported IAM configuration option: ${option}`)
    }
  }
}
