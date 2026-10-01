export type StorageLifecycleAction = 'keep' | 'backup' | 'archive' | 'trash' | 'clean' | 'review'

export interface StorageLifecycleCandidate {
  name: string
  bytes: number
  ageDays: number
  area: string
  path?: string
}

export interface StorageLifecycleRecommendation {
  action: StorageLifecycleAction
  reason: string
  protected: boolean
}

const MEBIBYTE = 1024 * 1024
const extensions = (name: string) => name.toLowerCase().split('.').at(-1) ?? ''

export function isSensitiveStorageCandidate(candidate: Pick<StorageLifecycleCandidate, 'name' | 'path'>) {
  const value = `${candidate.path ?? ''}/${candidate.name}`.toLowerCase()
  return value.includes('/.ssh/') || value.includes('/.aws/') || value.includes('/.gnupg/')
    || value.includes('/library/keychains/') || value.includes('/library/cloudstorage/')
    || /(^|\/)\.env(?:\.|$)/.test(value) || /id_rsa|service_role|client_secret/.test(value)
    || /\.(pem|key|p12|pfx|mobileprovision|kdbx)$/.test(value)
}

/**
 * A small deterministic policy layer. It only ranks and explains; it never
 * performs an action and never equates "old" with "useless".
 */
export function recommendStorageLifecycle(candidate: StorageLifecycleCandidate): StorageLifecycleRecommendation {
  if (isSensitiveStorageCandidate(candidate)) {
    return { action: 'keep', protected: true, reason: 'Archivo sensible protegido: FARO no lo mueve ni lo envía a Archive.' }
  }

  const name = candidate.name.toLowerCase()
  const extension = extensions(name)
  const projectByproduct = /(^|\/)(node_modules|dist|build|coverage|\.next|\.cache)(\/|$)/.test((candidate.path ?? '').toLowerCase())
    || ['log', 'tmp', 'cache'].includes(extension)
  if (projectByproduct) return { action: 'clean', protected: false, reason: 'Subproducto técnico: revísalo como limpieza local, no como archivo.' }

  const isScreenshot = /screenshot|captura de pantalla|screen shot/.test(name) && ['png', 'jpg', 'jpeg', 'webp'].includes(extension)
  if (isScreenshot && candidate.ageDays >= 30) return { action: 'trash', protected: false, reason: 'Captura antigua: candidata a Papelera tras revisarla.' }

  const isPackage = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'dmg', 'pkg', 'iso'].includes(extension)
  if (isPackage && candidate.ageDays >= 21) {
    return candidate.bytes >= 500 * MEBIBYTE
      ? { action: 'archive', protected: false, reason: 'Paquete grande y antiguo: Archive puede liberar espacio después de verificar la copia.' }
      : { action: 'trash', protected: false, reason: 'Paquete antiguo: revisa si ya cumplió su función antes de mandarlo a Papelera.' }
  }

  const isVideo = ['mov', 'mp4', 'mkv', 'avi', 'm4v'].includes(extension)
  if (isVideo && candidate.bytes >= 350 * MEBIBYTE && ['Escritorio', 'Descargas'].includes(candidate.area)) {
    return { action: 'archive', protected: false, reason: 'Video grande en una carpeta de trabajo: Archive es más seguro que borrar.' }
  }

  const isDocument = ['pdf', 'doc', 'docx', 'pages', 'xlsx', 'numbers', 'ppt', 'pptx'].includes(extension)
  if (isDocument && candidate.ageDays >= 120) return { action: 'backup', protected: false, reason: 'Documento antiguo: respáldalo antes de decidir si lo archivas localmente.' }

  return { action: 'review', protected: false, reason: 'No hay una señal suficiente para decidir por ti; revísalo en Finder.' }
}
