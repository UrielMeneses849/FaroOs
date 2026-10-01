export interface VaultStatus {
  exists: boolean
  locked: boolean
  timeoutMinutes: 1 | 5 | 15 | 30 | number
  lockOnBlur: boolean
}

export interface VaultSecurityOverview {
  credentialCount: number
  reusedCount: number
  weakCount: number
  oldCount: number
}

export interface VaultCredentialSummary {
  id: string
  serviceName: string
  username: string
  url: string
  favorite: boolean
  tags: string[]
  updatedAt: number
  passwordChangedAt: number
  strength: 'Débil' | 'Aceptable' | 'Fuerte' | 'Muy fuerte' | string
  reusedWith: number
  passwordAgeDays: number
}

export interface VaultCredentialDetail extends VaultCredentialSummary {
  password: string
  notes: string
  createdAt: number
}

export interface VaultListResponse {
  credentials: VaultCredentialSummary[]
  security: VaultSecurityOverview
  timeoutMinutes: number
  lockOnBlur: boolean
}

export interface VaultCredentialInput {
  serviceName: string
  username: string
  password: string
  url?: string
  notes?: string
  favorite?: boolean
  tags?: string[]
}

export interface VaultCredentialPatch {
  serviceName?: string
  username?: string
  password?: string
  url?: string
  notes?: string
  favorite?: boolean
  tags?: string[]
}

export interface VaultGeneratorOptions {
  length?: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  avoidAmbiguous: boolean
}

export interface VaultGeneratedPassword {
  password: string
  length: number
  strength: string
}

export interface VaultClipboardResponse {
  message: string
}
