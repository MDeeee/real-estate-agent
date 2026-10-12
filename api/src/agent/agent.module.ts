import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { AgentGraphService } from './agent-graph.service.js';
import { AgentRetrievalService } from './agent-retrieval.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { CheckpointerService } from './checkpointer.service.js';

@Module({
  imports: [LlmModule, PropertiesModule, IngestionModule, BookingsModule],
  controllers: [ChatController],
  providers: [
    CheckpointerService,
    AgentRetrievalService,
    AgentGraphService,
    ChatService,
  ],
})
export class AgentModule {}
