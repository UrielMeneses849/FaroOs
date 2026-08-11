export function assertFaroCalendarMutation(args: Record<string, unknown>) {
  if (args.provider !== 'faro' || args.targetKind === 'google') {
    throw new Error('Google Calendar es de solo lectura.')
  }
}
