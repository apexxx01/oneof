/**
 * Belt and braces on top of the web core's router. Everything the extension reads is the
 * user's own words, so every model call it makes must route ONLY_ON_DEVICE. If the router
 * ever said otherwise, the call is refused here before it reaches Firebase AI Logic.
 */
import { route, type Route } from '../../../src/lib/ai';
import type { Task } from '../../../src/lib/ledger';

export type ExtensionTask = Extract<Task, 'draft' | 'blur' | 'extract'>;

export class NotOnDeviceError extends Error {
  constructor(task: string, mode: string) {
    super(`Refused: ${task} would run as ${mode}. The extension only runs on-device.`);
  }
}

export function assertOnDevice(task: ExtensionTask): Route {
  const r = route(task, 'own');
  if (r.mode !== 'ONLY_ON_DEVICE') throw new NotOnDeviceError(task, r.mode);
  return r;
}
