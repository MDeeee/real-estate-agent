import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { AppI18nModule } from '../i18n/app-i18n.module.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { AgentGraphService } from './agent-graph.service.js';
import { AgentRetrievalService } from './agent-retrieval.service.js';
import { ChatController } from './chat.controller.js';
import { ChatThreadCookie } from './chat-thread-cookie.js';
import { ChatService } from './chat.service.js';
import { CheckpointerService } from './checkpointer.service.js';
import { AgentReplies } from './replies.js';

@Module({
  imports: [
    AppI18nModule,
    LlmModule,
    PropertiesModule,
    IngestionModule,
    BookingsModule,
  ],
  controllers: [ChatController],
  providers: [
    CheckpointerService,
    AgentReplies,
    AgentRetrievalService,
    AgentGraphService,
    ChatService,
    ChatThreadCookie,
  ],
})
export class AgentModule {}
