import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

function controllerWith(queryRaw: () => Promise<unknown>): HealthController {
  return new HealthController({
    $queryRaw: queryRaw,
  } as unknown as PrismaService);
}

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const controller = controllerWith(
      vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    );
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('responds 503 when the database is unreachable', async () => {
    const controller = controllerWith(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
