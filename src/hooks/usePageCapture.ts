import { useOutletContext } from 'react-router-dom'

export function usePageCapture() {
  return useOutletContext<{ capture: () => void }>()
}
