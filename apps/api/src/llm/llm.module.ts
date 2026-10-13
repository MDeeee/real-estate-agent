import { Module } from '@nestjs/common';
import { AGENT_MODEL } from './agent-model.js';
import { ChatModelFactory } from './chat-model.factory.js';
import { LangChainAgentModel } from './langchain-agent-model.js';

@Module({
  providers: [
    ChatModelFactory,
    { provide: AGENT_MODEL, useClass: LangChainAgentModel },
  ],
  exports: [AGENT_MODEL, ChatModelFactory],
})
export class LlmModule {}
