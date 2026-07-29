interface ProgressBarProps { value: number; label?: string }

export function ProgressBar({ value, label = 'Progreso' }: ProgressBarProps) {
  const safeValue = Math.min(100, Math.max(0, value))
  return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}><span style={{ width: `${safeValue}%` }} /></div>
}
