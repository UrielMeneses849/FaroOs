export interface StorageFolderSummary {
  id: string
  name: string
  path: string
  bytes: number
  fileCount: number
  scanComplete: boolean
}

export interface StorageCandidate {
  id: string
  name: string
  path: string
  bytes: number
  modifiedAt: number
  ageDays: number
  area: string
  kind: string
  reason: string
}

export interface StorageBrowserEntry {
  id: string
  name: string
  path: string
  bytes: number
  modifiedAt: number
  ageDays: number
  kind: string
  isDirectory: boolean
  canMoveToTrash: boolean
  fileCount: number
  scanComplete: boolean
  suggestedReason?: string | null
}

export interface StorageFolderBrowser {
  folderId: string
  rootName: string
  path: string
  entries: StorageBrowserEntry[]
  scannedEntries: number
  scanComplete: boolean
  /** Whether individual files in this folder can be managed. */
  canManage: boolean
  /** Whether direct child folders can be moved as a whole to macOS Trash. */
  canManageFolders: boolean
}

export interface StorageApp {
  id: string
  name: string
  path: string
  bytes: number
  modifiedAt: number
  lastAccessedAt?: number | null
  activityAgeDays?: number | null
  scanComplete: boolean
  classification: 'NORMAL_REMOVABLE' | 'APPLE_REMOVABLE' | 'SYSTEM_PROTECTED' | string
  removalReason: string
}

export interface StorageTrashSummary {
  bytes: number
  fileCount: number
  scanComplete: boolean
}

export interface StorageCategory {
  id: string
  name: string
  bytes: number
  potentiallyRecoverableBytes: number
  managedByFaro: boolean
  protected: boolean
  scanComplete: boolean
  note: string
}

export interface StorageAccumulation {
  id: string
  name: string
  bytes: number
  fileCount: number
  oldestAgeDays: number
  risk: string
  reason: string
  /** Largest/oldest representative files, capped to keep the scan responsive. */
  items: StorageCandidate[]
}

export interface StorageDevelopmentArtifact {
  id: string
  name: string
  path: string
  project: string
  bytes: number
  modifiedAt: number
  kind: string
  lifecycle: string
  scanComplete: boolean
}

export interface StorageRecoveryStep {
  id: string
  name: string
  bytes: number
  lifecycle: string
  reason: string
}

export interface StorageIntelligence {
  classifiedBytes: number
  unexplainedBytes: number
  manageableBytes: number
  protectedBytes: number
  recoverableBytes: number
  minimumFreeBytes: number
  bytesToOperatingMargin: number
  health: string
  categories: StorageCategory[]
  accumulations: StorageAccumulation[]
  development: StorageDevelopmentArtifact[]
  recoveryPlan: StorageRecoveryStep[]
}

export interface StorageOverview {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  scannedAt: number
  folders: StorageFolderSummary[]
  candidates: StorageCandidate[]
  screenshots: StorageCandidate[]
  apps: StorageApp[]
  appsScanLimited: boolean
  trash: StorageTrashSummary
  scannedEntries: number
  scanLimited: boolean
  warnings: string[]
  intelligence: StorageIntelligence
}

/** A light-weight disk reading for surfaces such as Dashboard. Unlike a full
 * StorageOverview it never walks personal folders. */
export interface StorageCapacity {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  minimumOperatingFreeBytes: number
  health: 'saludable' | 'precaucion' | 'bajo' | 'critico'
}

export interface StorageTrashResult {
  movedCount: number
  reclaimedBytes: number
  failed: string[]
  warnings: string[]
}
