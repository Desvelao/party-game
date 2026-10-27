/** Plain description of a keyboard event target (no DOM types, so it is node-testable). */
export interface KeyTargetInfo {
  tagName?: string;
  id?: string;
  isContentEditable?: boolean;
}

const FORM_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function isFormControl(t: KeyTargetInfo | null | undefined): boolean {
  if (!t) return false;
  return !!t.isContentEditable || FORM_TAGS.has((t.tagName ?? '').toUpperCase());
}

/**
 * Should a keydown be treated as game input (latched + preventDefault)?
 * Only while a round is running, never inside form controls, and on buttons
 * only for the big #dash button (Space/Enter elsewhere must still activate them; movement
 * keys still count, as a menu/vote button is often left focused after use).
 */
export function shouldCaptureKey(phase: string, target: KeyTargetInfo | null | undefined, code = ''): boolean {
  if (phase !== 'countdown' && phase !== 'playing') return false;
  if (isFormControl(target)) return false;
  if (target && (target.tagName ?? '').toUpperCase() === 'BUTTON' && target.id !== 'dash' && target.id !== 'mine') {
    return code !== 'Space' && code !== 'Enter';
  }
  return true;
}
