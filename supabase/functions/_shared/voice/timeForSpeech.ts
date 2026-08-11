const spokenHour = (hour: number) => hour % 12 || 12

export function formatTimeForSpeech(value: string, timeZone = 'America/Mexico_City') {
  let hour: number
  let minute: number
  const clock = value.match(/^(\d{1,2}):(\d{2})$/)
  if (clock) {
    hour = Number(clock[1])
    minute = Number(clock[2])
  } else {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return value
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]))
    hour = Number(parts.hour)
    minute = Number(parts.minute)
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return value

  const period = hour === 0 ? 'de la noche'
    : hour < 12 ? 'de la mañana'
      : hour === 12 ? 'del día'
        : hour < 19 ? 'de la tarde' : 'de la noche'
  const minutes = minute === 0 ? ''
    : minute === 15 ? ' y cuarto'
      : minute === 30 ? ' y media' : ` con ${minute} minutos`
  return `${spokenHour(hour)}${minutes} ${period}`
}
