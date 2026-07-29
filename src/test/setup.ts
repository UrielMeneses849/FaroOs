import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { demoData } from '../data/mockData'
import { useFaroStore } from '../store'

beforeEach(() => {
  localStorage.clear()
  useFaroStore.setState(structuredClone(demoData))
  window.history.replaceState({}, '', '/dashboard')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
