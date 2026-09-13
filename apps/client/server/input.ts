export const MAX_MESSAGE_LENGTH = 10_000;
export const MAX_ROOM_ID_LENGTH = 128;

export function requireMessageText(value: unknown): string {
  if (typeof value !== "string") throw new Error("text is required");
  const text = value.trim();
  if (!text) throw new Error("text is required");
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`text must be at most ${MAX_MESSAGE_LENGTH} characters`);
  return text;
}

export function requireRoomId(value: unknown, allowSlash = false): string {
  if (typeof value !== "string") throw new Error("roomId is required");
  const roomId = value.trim();
  if (!roomId) throw new Error("roomId is required");
  if (roomId.length > MAX_ROOM_ID_LENGTH) throw new Error(`roomId must be at most ${MAX_ROOM_ID_LENGTH} characters`);
  if (!allowSlash && roomId.includes("/")) throw new Error("roomId may not contain '/'");
  return roomId;
}
