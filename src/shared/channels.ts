/**
 * IPC channel names. Kept apart from the zod contract so the preload stays small.
 */
export const IPC_CHANNELS = {
  invoke: (name: string) => `invoke:${name}`,
  streamStart: (name: string) => `stream:start:${name}`,
  streamEvent: 'stream:event',
  streamCancel: 'stream:cancel',
} as const
