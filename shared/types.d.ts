/**
 * Types shared by the server and the client. This is a declaration-only file
 * (no runtime code), so both sides can `import type` from it.
 */

export interface PublicUser {
  id: number;
  /** Unique, used to sign in and to search. */
  username: string;
  /** Optional name shown instead of the username. */
  displayName: string | null;
  /** Public URL of the profile picture, or null to show the initial instead. */
  avatarUrl: string | null;
}

export interface UserWithPresence extends PublicUser {
  online: boolean;
}

export interface Message {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp, or null while unread */
  readAt: string | null;
}

/** Everything shown on a profile page. */
export interface Profile extends UserWithPresence {
  /** Short "about me", up to 160 characters. */
  bio: string | null;
  /** ISO timestamp of when the account was created. */
  createdAt: string;
}

/** An entry in the "People" tab: any other user, with when you last chatted. */
export interface Person extends UserWithPresence {
  /** ISO timestamp of the latest message between you, or null if you've never chatted. */
  lastAt: string | null;
}

export interface Conversation extends UserWithPresence {
  lastBody: string;
  lastSenderId: number;
  lastAt: string;
  unread: number;
}

// ---- REST API responses ----------------------------------------------------

export interface AuthResponse {
  user: PublicUser;
}

export interface ProfileResponse {
  profile: Profile;
}

export interface UsersResponse {
  users: UserWithPresence[];
}

export interface PeopleResponse {
  people: Person[];
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface MessagesResponse {
  user: UserWithPresence;
  messages: Message[];
  hasMore: boolean;
}

export interface ErrorResponse {
  error: string;
}

// ---- Socket.IO events --------------------------------------------------------

export type SendMessageAck =
  { ok: true; message: Message } | { ok?: false; error: string };

export interface ClientToServerEvents {
  "message:send": (
    payload: { to: number; body: string },
    ack: (res: SendMessageAck) => void,
  ) => void;
  typing: (payload: { to: number; typing: boolean }) => void;
  "messages:read": (payload: { from: number }) => void;
}

export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  typing: (payload: { from: number; typing: boolean }) => void;
  "messages:read": (payload: {
    readerId: number;
    senderId: number;
    upToId: number;
  }) => void;
  presence: (payload: { userId: number; online: boolean }) => void;
  /** Someone changed their display name or avatar. */
  "profile:updated": (user: PublicUser) => void;
}
