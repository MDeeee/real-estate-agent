import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatThrottled } from '../common/throttling.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AGENT_MODEL, type AgentModel } from '../llm/agent-model.js';
import type { ChatEvent } from './chat-events.js';
import {
  type ChatRequest,
  chatRequestSchema,
  threadIdSchema,
} from './chat.schema.js';
import { type ChatHistoryMessage, ChatService } from './chat.service.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;

function writeEvent(response: Response, event: ChatEvent): void {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(AGENT_MODEL) private readonly model: AgentModel,
  ) {}

  @Post()
  @ChatThrottled()
  async send(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.model.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI assistant is not configured',
      );
    }
    const release = this.chat.acquire(body.threadId);

    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) abort.abort();
    });

    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    const heartbeat = setInterval(() => {
      response.write(': keep-alive\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of this.chat.run(
        body.threadId,
        body.message,
        abort.signal,
      )) {
        if (abort.signal.aborted) break;
        writeEvent(response, event);
      }
    } finally {
      clearInterval(heartbeat);
      release();
      response.end();
    }
  }

  @Get(':threadId')
  async history(
    @Param('threadId', new ZodValidationPipe(threadIdSchema)) threadId: string,
  ): Promise<{ messages: ChatHistoryMessage[] }> {
    return { messages: await this.chat.history(threadId) };
  }
}
