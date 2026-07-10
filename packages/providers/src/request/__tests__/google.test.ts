import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ProviderError, type GenerationParams } from '../../types.js';
import { buildChatRequest } from '../build-request.js';
import {
  buildVertexTokenRequest,
  createVertexJwt,
  parseVertexTokenResponse,
} from '../google-auth.js';

const googleParams: GenerationParams = {
  model: 'gemini-2.5-flash',
  messages: [
    { role: 'system', content: 'Use the supplied canon.' },
    { role: 'user', content: 'Describe the brass moon.' },
  ],
  stream: true,
  apiKey: 'test-key',
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  stop: ['END'],
  seed: 7,
  reasoningEffort: 'high',
  includeReasoning: true,
};

describe('Google request building', () => {
  it('builds the pinned AI Studio request', () => {
    const request = buildChatRequest('makersuite', googleParams);

    expect(request).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=test-key&alt=sse',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Describe the brass moon.' }] }],
        systemInstruction: { parts: [{ text: 'Use the supplied canon.' }] },
        safetySettings: expect.arrayContaining([
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
        ]),
        generationConfig: {
          stopSequences: ['END'],
          candidateCount: 1,
          maxOutputTokens: 4096,
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          seed: 7,
          thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
        },
      },
    });
    expect((request.body.safetySettings as unknown[]).length).toBe(5);
  });

  it('builds Vertex Express URLs with optional project IDs', () => {
    const regional = buildChatRequest('vertexai', {
      ...googleParams,
      extra: { region: 'europe-west4' },
    });
    const project = buildChatRequest('vertexai', {
      ...googleParams,
      extra: { region: 'global', projectId: 'story-project' },
    });

    expect(regional.url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?key=test-key&alt=sse',
    );
    expect(project.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/story-project/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?key=test-key&alt=sse',
    );
    expect((regional.body.safetySettings as unknown[]).length).toBe(10);
  });

  it('builds Vertex Full requests from an injected access token', () => {
    const request = buildChatRequest('vertexai', {
      ...googleParams,
      apiKey: undefined,
      stream: false,
      extra: {
        authMode: 'full',
        accessToken: 'access-token',
        projectId: 'story-project',
        region: 'us-central1',
      },
    });

    expect(request.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/story-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(request.headers.Authorization).toBe('Bearer access-token');
  });

  it('requires the credential for the selected authentication mode', () => {
    expect(() => buildChatRequest('makersuite', { ...googleParams, apiKey: undefined })).toThrow(
      new ProviderError('Google AI Studio (Gemini) requires an API key.', 'makersuite'),
    );
    expect(() =>
      buildChatRequest('vertexai', {
        ...googleParams,
        apiKey: undefined,
        extra: { authMode: 'full', projectId: 'story-project' },
      }),
    ).toThrow(
      new ProviderError('Google Vertex AI Full mode requires an access token.', 'vertexai'),
    );
  });
});

describe('Vertex service-account helpers', () => {
  it('creates a verifiable pinned JWT assertion and token request', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = createVertexJwt(
      { client_email: 'writer@example.test', private_key: privatePem, project_id: 'story-project' },
      1_700_000_000,
    );
    const [header, payload, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({
      iss: 'writer@example.test',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);

    expect(buildVertexTokenRequest(jwt)).toEqual({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
  });

  it('parses access tokens without accepting malformed responses', () => {
    expect(parseVertexTokenResponse({ access_token: ' token ' })).toBe('token');
    expect(() => parseVertexTokenResponse({ error: 'invalid_grant' })).toThrow(
      new ProviderError('Vertex AI token exchange did not return an access token.', 'vertexai'),
    );
  });
});
