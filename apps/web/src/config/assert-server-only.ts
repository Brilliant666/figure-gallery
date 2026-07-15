export function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error('This module is restricted to the server runtime')
  }
}
