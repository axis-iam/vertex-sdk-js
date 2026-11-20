import { ConnectedAppSessionTransport } from '@axis-iam/vertex'
import { BffSessionClient, MemorySessionProvider, type BffSessionProvider } from '@axis-iam/vertex/server'
import { createBff, expressSessionBinding, getBffUser } from '@axis-iam/vertex-express'
import { mountBff } from '@axis-iam/vertex-nestjs'
import { IamProvider, useAuthFlow, SignIn, AuthDialog } from '@axis-iam/vertex-react'
const provider: BffSessionProvider = new MemorySessionProvider({ workers: 1, replicas: 1 })
const browser = new ConnectedAppSessionTransport({ origin: 'https://app.example.test' })
void [provider, browser, BffSessionClient, createBff, expressSessionBinding, getBffUser, mountBff, IamProvider, useAuthFlow, SignIn, AuthDialog]
