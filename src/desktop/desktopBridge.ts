import { invoke } from '@tauri-apps/api/core'
import { isFaroTauriRuntime } from '../core/platform/runtime'
import type { FaroDesktopVoiceAction } from '../features/voice/desktopVoiceEvents'
import type { FaroVoiceSnapshot } from '../features/voice/faroVoiceConfig'
import type { ComputerConfig, ComputerNativeRequest, ComputerNativeResult } from '../features/computer/computerTypes'
import type { StorageCapacity, StorageFolderBrowser, StorageOverview, StorageTrashResult } from '../features/storage/storageTypes'
import type {
  ArchiveBatchProcessResult, ArchiveOauthStartResult, ArchiveOverview, ArchiveProcessResult, ArchivePurgeResult,
  GoogleDriveConfigurationInput,
} from '../features/storage/archiveTypes'
import type {
  VaultClipboardResponse, VaultCredentialDetail, VaultCredentialInput, VaultCredentialPatch,
  VaultCredentialSummary, VaultGeneratedPassword, VaultGeneratorOptions, VaultListResponse,
  VaultStatus,
} from '../features/vault/vaultTypes'

export const FARO_DESKTOP_VOICE_SNAPSHOT_EVENT = 'faro://voice-snapshot'

export function isFaroDesktop() {
  return isFaroTauriRuntime()
}

async function desktopInvoke<T>(command: string, args?: Record<string, unknown>) {
  if (!isFaroDesktop()) return undefined
  return invoke<T>(command, args)
}

export const showFaroMainWindow = () => desktopInvoke('show_main_command')
export const hideFaroMainWindow = () => desktopInvoke('hide_main_command')
export const toggleFaroMainWindow = () => desktopInvoke('toggle_main_command')
export const showFaroMini = () => desktopInvoke('show_mini_command')
export const announceFaroCalendarEvent = (message: string) => desktopInvoke('announce_calendar_event_command', { message })
export const hideFaroMini = () => desktopInvoke('hide_mini_command')
export const toggleFaroMini = () => desktopInvoke('toggle_mini_command')
export const focusFaroMain = () => desktopInvoke('focus_main_command')
export const setFaroMiniAlwaysOnTop = (alwaysOnTop: boolean) => desktopInvoke('set_mini_always_on_top', { alwaysOnTop })
export const getDesktopBiometricStatus = () => desktopInvoke<DesktopBiometricStatus>('desktop_biometric_status_command')
export const authenticateDesktopBiometrics = (reason: string) => desktopInvoke<void>('authenticate_desktop_biometrics_command', { reason })
export const publishFaroDesktopVoiceSnapshot = (snapshot: FaroVoiceSnapshot) => desktopInvoke('set_voice_snapshot', { snapshot })
export const getFaroDesktopVoiceSnapshot = () => desktopInvoke<FaroVoiceSnapshot | null>('get_voice_snapshot')
export const requestFaroVoiceAction = (action: FaroDesktopVoiceAction) => desktopInvoke('request_voice_action_command', { action })
export const submitFaroVoiceTranscript = (transcript: string) => desktopInvoke('submit_voice_transcript_command', { transcript })
export const openFaroMainRoute = (route: '/finance' | '/calendar' | '/backlog') => desktopInvoke('open_main_route_command', { route })
export const quitFaro = () => desktopInvoke('quit_faro_command')
export const getDesktopWakeModel = () => desktopInvoke<number[] | null>('get_wake_model_command')
export const getDesktopPreferences = () => desktopInvoke<DesktopPreferences>('get_desktop_preferences_command')
export const updateDesktopPreferences = (patch: Partial<DesktopPreferences>) => desktopInvoke<DesktopPreferences>('update_desktop_preferences_command', { patch })
export const setDesktopLaunchAtLogin = (enabled: boolean) => desktopInvoke<boolean>('set_launch_at_login_command', { enabled })
export const saveWakeEnrollmentSample = (runId: string, index: number, bytes: number[]) => desktopInvoke('save_wake_enrollment_sample_command', { runId, index, bytes })
export const clearWakeEnrollment = (runId: string) => desktopInvoke('clear_wake_enrollment_command', { runId })
export const getComputerConfig = () => desktopInvoke<ComputerConfig>('get_computer_config_command')
export const updateComputerConfig = (config: ComputerConfig) => desktopInvoke<ComputerConfig>('update_computer_config_command', { config })
export const executeComputerTool = (request: ComputerNativeRequest) => desktopInvoke<ComputerNativeResult>('computer_execute_command', { request })
export const openDesktopExternalUrl = (url: string) => executeComputerTool({
  tool: 'openUrl',
  arguments: { url },
  route: 'deterministic',
  llmUsed: false,
})
export const getDesktopStorageCapacity = () => desktopInvoke<StorageCapacity>('storage_capacity_command')
export const scanDesktopStorage = () => desktopInvoke<StorageOverview>('scan_storage_command')
export const browseDesktopStorageFolder = (folderId: string, parentId?: string) => desktopInvoke<StorageFolderBrowser>('storage_browse_folder_command', { folderId, parentId })
export const revealDesktopStorageFolder = (folderId: string, parentId?: string) => desktopInvoke<void>('storage_reveal_folder_command', { folderId, parentId })
export const revealDesktopStorageItem = (candidateId: string) => desktopInvoke<void>('storage_reveal_item_command', { candidateId })
export const moveDesktopStorageToTrash = (candidateIds: string[]) => desktopInvoke<StorageTrashResult>('storage_move_to_trash_command', { candidateIds })
export const getDesktopArchiveOverview = () => desktopInvoke<ArchiveOverview>('archive_overview_command')
export const acknowledgeDesktopArchiveMonthlyReview = () => desktopInvoke<ArchiveOverview>('archive_acknowledge_monthly_review_command')
export const updateDesktopArchiveSettings = (patch: { trashGraceDays?: number, monthlyReviewEnabled?: boolean }) => desktopInvoke<ArchiveOverview>('archive_update_settings_command', { patch })
export const configureDesktopGoogleDrive = (input: GoogleDriveConfigurationInput) => desktopInvoke<ArchiveOverview>('archive_configure_google_drive_command', { input })
export const startDesktopArchiveGoogleDriveOAuth = () => desktopInvoke<ArchiveOauthStartResult>('archive_start_google_drive_oauth_command')
export const processDesktopArchiveCandidate = (candidateId: string, operation: 'backup' | 'archive') => desktopInvoke<ArchiveProcessResult>('archive_process_storage_candidate_command', { input: { candidateId, operation } })
export const processDesktopArchiveCandidates = (candidateIds: string[], operation: 'backup' | 'archive') => desktopInvoke<ArchiveBatchProcessResult>('archive_process_storage_candidates_command', { input: { candidateIds, operation } })
export const runDesktopArchiveSafeUploadTest = () => desktopInvoke<ArchiveProcessResult>('archive_run_safe_upload_test_command')
export const openDesktopArchiveRemoteItem = (itemId: string) => desktopInvoke<void>('archive_open_remote_item_command', { itemId })
export const openDesktopArchiveRootFolder = () => desktopInvoke<void>('archive_open_root_folder_command')
export const restoreDesktopArchiveItem = (itemId: string, confirmation: string) => desktopInvoke<ArchiveProcessResult>('archive_restore_item_command', { itemId, confirmation })
export const purgeDesktopArchiveTrash = (itemIds: string[], confirmation: string) => desktopInvoke<ArchivePurgeResult>('archive_purge_faro_trash_command', { itemIds, confirmation })
export const getDesktopVaultStatus = () => desktopInvoke<VaultStatus>('vault_status_command')
export const createDesktopVault = () => desktopInvoke<VaultStatus>('vault_create_command')
export const unlockDesktopVault = () => desktopInvoke<VaultStatus>('vault_unlock_command')
export const lockDesktopVault = () => desktopInvoke<VaultStatus>('vault_lock_command')
export const listDesktopVault = (query?: string) => desktopInvoke<VaultListResponse>('vault_list_command', { query })
export const getDesktopVaultCredential = (id: string) => desktopInvoke<VaultCredentialDetail>('vault_get_command', { id })
export const createDesktopVaultCredential = (input: VaultCredentialInput) => desktopInvoke<VaultCredentialSummary>('vault_create_credential_command', { input })
export const updateDesktopVaultCredential = (id: string, patch: VaultCredentialPatch) => desktopInvoke<VaultCredentialSummary>('vault_update_credential_command', { id, patch })
export const deleteDesktopVaultCredential = (id: string, confirmation: string) => desktopInvoke<void>('vault_delete_credential_command', { id, confirmation })
export const generateDesktopVaultPassword = (options: VaultGeneratorOptions) => desktopInvoke<VaultGeneratedPassword>('vault_generate_password_command', { options })
export const updateDesktopVaultSettings = (patch: { autoLockMinutes?: number, lockOnBlur?: boolean }) => desktopInvoke<VaultStatus>('vault_update_settings_command', { patch })
export const copyDesktopVaultUsername = (id: string) => desktopInvoke<VaultClipboardResponse>('vault_copy_username_command', { id })
export const copyDesktopVaultPassword = (id: string) => desktopInvoke<VaultClipboardResponse>('vault_copy_password_command', { id })
export const openDesktopVaultUrl = (id: string) => desktopInvoke<void>('vault_open_url_command', { id })

export interface DesktopPreferences {
  wakeEnabled: boolean
  wakeThreshold: number
  launchAtLogin: boolean
  notificationsEnabled: boolean
  calendarLeadMinutes: number
  miniAlwaysOnTop: boolean
}

export interface DesktopBiometricStatus {
  available: boolean
  reason?: string | null
}
