import { z } from 'zod';

import { messageSchema } from './chats.js';

export const streamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('delta'),
    text: z.string(),
    reasoning: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('done'), message: messageSchema }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['provider_error', 'configuration_error', 'internal_error']),
    message: z.string(),
    messageState: messageSchema,
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

export function encodeSseEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
