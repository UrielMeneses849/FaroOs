import { useContext } from 'react'
import { LocalMigrationContext } from '../providers/LocalMigrationContext'

export function useLocalMigration() {
  const context = useContext(LocalMigrationContext)
  if (!context) {
    throw new Error('useLocalMigration debe utilizarse dentro de LocalMigrationProvider.')
  }
  return context
}
