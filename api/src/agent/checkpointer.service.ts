import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Env } from '../config/env.schema.js';

export const CHECKPOINT_SCHEMA = 'langgraph';

/** Conversation memory: LangGraph checkpoints in their own Postgres schema. */
@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  readonly saver: PostgresSaver;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.saver = PostgresSaver.fromConnString(
      config.get('DATABASE_URL', { infer: true }),
      { schema: CHECKPOINT_SCHEMA },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.saver.setup();
  }

  async onModuleDestroy(): Promise<void> {
    await this.saver.end();
  }
}
