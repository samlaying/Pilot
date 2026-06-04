/**
 * Pilot MCP — Background Service Worker Types
 *
 * Message shapes for the WebSocket protocol between
 * the extension and the Pilot MCP broker.
 */

/** Incoming command from the broker */
export interface CommandMessage {
  id: string | number;
  type: string;
  payload?: Record<string, any>;
  sessionId: string;
  tabId?: number;
}

/** Outgoing response to the broker */
export interface CommandResponse {
  id: string | number;
  sessionId: string;
  result?: any;
  error?: string;
}

/** Internal keepalive message */
export interface KeepaliveMessage {
  type: 'keepalive';
  role: 'extension';
  ts: number;
}

/** Hello handshake message */
export interface HelloMessage {
  type: 'hello';
  role: 'extension';
}

/** Map of session IDs to tab IDs */
export type SessionTabMap = Map<string, number>;

/** Map of session IDs to tab group IDs */
export type SessionGroupMap = Map<string, number>;
