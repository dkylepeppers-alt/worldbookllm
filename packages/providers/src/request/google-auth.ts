/**
 * Vertex AI service-account authentication helpers.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/google.js:40.
 * The caller performs the OAuth token exchange; this package does no I/O.
 */

import { createSign } from 'node:crypto';

import { ProviderError, type ProviderHttpRequest } from '../types.js';

export interface VertexServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export function createVertexJwt(
  serviceAccount: VertexServiceAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
    throw new ProviderError('Vertex AI service-account credentials are incomplete.', 'vertexai');
  }

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return `${input}.${signer.sign(serviceAccount.private_key, 'base64url')}`;
  } catch {
    throw new ProviderError('Vertex AI service-account private key is invalid.', 'vertexai');
  }
}

export function buildVertexTokenRequest(jwt: string): ProviderHttpRequest {
  return {
    url: 'https://oauth2.googleapis.com/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  };
}

export function parseVertexTokenResponse(data: unknown): string {
  const token =
    typeof data === 'object' && data !== null && 'access_token' in data
      ? (data as { access_token?: unknown }).access_token
      : undefined;
  if (typeof token !== 'string' || !token.trim()) {
    throw new ProviderError('Vertex AI token exchange did not return an access token.', 'vertexai');
  }
  return token.trim();
}
