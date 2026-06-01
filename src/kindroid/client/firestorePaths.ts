export function userKinsPath(uid: string): string {
  return `Users/${uid}/AIs`;
}

export function kinDocumentPath(uid: string, kinId: string): string {
  return `Users/${uid}/AIs/${kinId}`;
}

export function kinChatMessagesPath(uid: string, kinId: string): string {
  return `${kinDocumentPath(uid, kinId)}/ChatMessages`;
}

export function userGroupsPath(uid: string): string {
  return `Users/${uid}/Groups`;
}

export function groupDocumentPath(uid: string, groupId: string): string {
  return `Users/${uid}/Groups/${groupId}`;
}

export function groupChatMessagesPath(uid: string, groupId: string): string {
  return `${groupDocumentPath(uid, groupId)}/ChatMessages`;
}

export function groupPinnedMessagesPath(uid: string, groupId: string): string {
  return `${groupDocumentPath(uid, groupId)}/PinnedMessages`;
}

export function userDocumentPath(uid: string): string {
  return `Users/${uid}`;
}
