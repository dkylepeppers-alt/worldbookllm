/**
 * Shared types and schemas used by both the server and the web client.
 *
 * This package is intentionally a near-empty barrel for now (Milestone 0);
 * notebook, source, and chat types land here in Milestone 1.
 */

export const APP_NAME = 'worldbookllm';

export interface HealthStatus {
  status: 'ok';
}
