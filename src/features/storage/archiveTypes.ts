export interface ArchiveProviderOverview {
  provider: string
  configured: boolean
  clientId: string
  clientSecretConfigured: boolean
  connected: boolean
  accountEmail?: string | null
  rootFolderName: string
  rootFolderId?: string | null
  scope: string
  statusMessage: string
  oauthInProgress: boolean
  quotaLimitBytes?: number | null
  quotaUsedBytes?: number | null
}

export interface ArchiveMetricOverview {
  itemCount: number
  backupCount: number
  archivedCount: number
  bytesBackedUp: number
  bytesArchived: number
  localBytesFreedByFaro: number
}

export interface FaroTrashItemOverview {
  id: string
  name: string
  sourcePath: string
  bytes: number
  reason: string
  action: string
  movedAt: number
  graceEndsAt: number
  status: 'trashed' | 'purged' | 'missing' | string
  eligibleForPurge: boolean
}

export interface FaroTrashOverview {
  trackedCount: number
  trackedBytes: number
  eligibleCount: number
  eligibleBytes: number
  graceDays: number
  monthlyReviewDue: boolean
  items: FaroTrashItemOverview[]
}

export interface ArchivePolicyOverview {
  protectedPathsOnly: boolean
  sensitiveFilesBlocked: boolean
  autoPurgeEnabled: boolean
  monthlyReviewEnabled: boolean
  rules: string[]
}

export interface ArchiveEventOverview {
  id: string
  createdAt: number
  kind: string
  message: string
  itemId?: string | null
}

export interface ArchiveItemOverview {
  id: string
  name: string
  sourcePath: string
  /** Folder breadcrumb in Drive. FARO keeps local paths local. */
  remotePath?: string | null
  bytes: number
  operation: 'backup' | 'archive' | string
  status: 'queued' | 'uploading' | 'verifying' | 'backed_up' | 'archived' | 'failed' | string
  verifiedAt?: number | null
  restoredAt?: number | null
  restorable: boolean
  isDirectory: boolean
}

export interface ArchiveOverview {
  provider: ArchiveProviderOverview
  archive: ArchiveMetricOverview
  trash: FaroTrashOverview
  policy: ArchivePolicyOverview
  recentEvents: ArchiveEventOverview[]
  recentItems: ArchiveItemOverview[]
  /** Copies verified in Drive and known to this Mac's FARO Archive ledger. */
  remoteItems: ArchiveItemOverview[]
}

export interface ArchivePurgeResult {
  purgedCount: number
  reclaimedBytes: number
  failed: string[]
}

export interface GoogleDriveConfigurationInput {
  clientId: string
  /** Stored only in macOS Keychain; never in FARO's local JSON or source. */
  clientSecret?: string
  /** Desktop OAuth selects an unused 127.0.0.1 loopback port per connection. */
  redirectUri?: string
}

export interface ArchiveOauthStartResult {
  started: boolean
  redirectUri: string
  message: string
}

export interface ArchiveProcessResult {
  itemId: string
  operation: string
  status: string
  bytes: number
  message: string
}

export interface ArchiveBatchProcessResult {
  operation: string
  succeeded: ArchiveProcessResult[]
  failed: string[]
  bytesProcessed: number
}
