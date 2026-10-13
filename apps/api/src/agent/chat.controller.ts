import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CsrfHeaderGuard } from '../common/csrf-header.guard.js';
import { ChatThrottled } from '../common/throttling.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AGENT_MODEL, type AgentModel } from '../llm/agent-model.js';
import type { ChatEvent } from './chat-events.js';
import { ChatThreadCookie } from './chat-thread-cookie.js';
import { type ChatRequest, chatRequestSchema } from './chat.schema.js';
import { type ChatHistoryMessage, ChatService } from './chat.service.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;

function writeEvent(response: Response, event: ChatEvent): void {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

@Controller('chat')
@UseGuards(CsrfHeaderGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(AGENT_MODEL) private readonly model: AgentModel,
    @Inject(ChatThreadCookie) private readonly threads: ChatThreadCookie,
  ) {}

  @Post()
  @ChatThrottled()
  async send(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.model.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI assistant is not configured',
      );
    }
    // A visitor without a conversation gets one: the cookie rides on this response.
    const threadId = this.threads.resolve(request, response);
    const release = this.chat.acquire(threadId);

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
        threadId,
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

  /** The stored conversation of the cookie's thread; empty when there is none yet. */
  @Get('history')
  async history(
    @Req() request: Request,
  ): Promise<{ messages: ChatHistoryMessage[] }> {
    const threadId = this.threads.read(request);
    return { messages: threadId ? await this.chat.history(threadId) : [] };
  }

  /**
   * "New chat": switches the cookie to a fresh conversation. The previous one
   * stays in the database untouched; nobody can reach it without its id.
   */
  @Post('reset')
  @HttpCode(204)
  reset(@Res({ passthrough: true }) response: Response): void {
    this.threads.rotate(response);
  }
}
