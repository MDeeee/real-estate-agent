import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { Env } from '../config/env.schema.js';
import { LlmNotConfiguredError } from './llm-not-configured.error.js';

export type StructuredMethod = Env['LLM_STRUCTURED_METHOD'];

@Injectable()
export class ChatModelFactory {
  private model: BaseChatModel | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  get structuredMethod(): StructuredMethod {
    return this.config.get('LLM_STRUCTURED_METHOD', { infer: true });
  }

  /** Names of the environment variables the selected provider still lacks. */
  missingConfiguration(): string[] {
    const get = <K extends keyof Env>(key: K) =>
      this.config.get(key, { infer: true });
    const required: [string, unknown][] =
      get('LLM_PROVIDER') === 'claude'
        ? [['ANTHROPIC_API_KEY', get('ANTHROPIC_API_KEY')]]
        : [
            ['OPENAI_COMPAT_BASE_URL', get('OPENAI_COMPAT_BASE_URL')],
            ['OPENAI_COMPAT_API_KEY', get('OPENAI_COMPAT_API_KEY')],
            ['OPENAI_COMPAT_MODEL', get('OPENAI_COMPAT_MODEL')],
          ];
    return required.filter(([, value]) => !value).map(([name]) => name);
  }

  isConfigured(): boolean {
    return this.missingConfiguration().length === 0;
  }

  /** The chat model of the selected provider; built once, on first use. */
  create(): BaseChatModel {
    this.model ??= this.build();
    return this.model;
  }

  private build(): BaseChatModel {
    const missing = this.missingConfiguration();
    if (missing.length > 0) throw new LlmNotConfiguredError(missing);

    if (this.config.get('LLM_PROVIDER', { infer: true }) === 'claude') {
      // No `temperature` / `topP`: Claude 5.5 models reject non-default sampling.
      return new ChatAnthropic({
        model: this.config.get('CLAUDE_MODEL', { infer: true }),
        apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }),
      });
    }
    return new ChatOpenAI({
      model: this.config.get('OPENAI_COMPAT_MODEL', { infer: true }),
      apiKey: this.config.get('OPENAI_COMPAT_API_KEY', { infer: true }),
      temperature: 0,
      configuration: {
        baseURL: this.config.get('OPENAI_COMPAT_BASE_URL', { infer: true }),
      },
    });
  }
}
