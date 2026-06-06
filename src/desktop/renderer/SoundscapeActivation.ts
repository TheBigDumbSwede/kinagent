export interface SoundscapeActivationPayload {
  groupId?: unknown;
  kinId?: unknown;
}

export function soundscapeKeyFromPayload(payload: SoundscapeActivationPayload | undefined): string | null {
  const groupId = typeof payload?.groupId === "string" && payload.groupId ? payload.groupId : null;
  if (groupId) {
    return `group:${groupId}`;
  }

  const kinId = typeof payload?.kinId === "string" && payload.kinId ? payload.kinId : null;
  return kinId ? `kin:${kinId}` : null;
}

export function shouldDeactivateActiveSoundscape(
  activeKey: string | null,
  payload: SoundscapeActivationPayload | undefined
): boolean {
  const key = soundscapeKeyFromPayload(payload);
  return Boolean(key && activeKey === key);
}
