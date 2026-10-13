import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsAdminService } from './documents-admin.service.js';

/** A Prisma fake whose transaction runs the callback against the same fake. */
function serviceWith(options: {
  document: { filename: string; property: { id: string } | null } | null;
  active?: number;
}) {
  const tx = {
    booking: {
      count: vi.fn(async () => options.active ?? 0),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    document: { delete: vi.fn(async () => ({})) },
  };
  const prisma = {
    document: { findUnique: vi.fn(async () => options.document) },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<void>) =>
      run(tx),
    ),
  };
  return {
    service: new DocumentsAdminService(prisma as unknown as PrismaService),
    tx,
  };
}

describe('DocumentsAdminService.remove', () => {
  it('refuses while an active booking exists, and deletes nothing', async () => {
    const { service, tx } = serviceWith({
      document: { filename: 'flat.md', property: { id: 'p1' } },
      active: 2,
    });

    const failure = await service.remove('d1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).message).toBe(
      'Cannot delete flat.md: its property has 2 active booking(s). Cancel them in Bookings first.',
    );
    expect(tx.booking.deleteMany).not.toHaveBeenCalled();
    expect(tx.document.delete).not.toHaveBeenCalled();
  });

  it('counts only bookings that are not cancelled', async () => {
    const { service, tx } = serviceWith({
      document: { filename: 'flat.md', property: { id: 'p1' } },
    });

    await service.remove('d1');

    expect(tx.booking.count).toHaveBeenCalledWith({
      where: { propertyId: 'p1', status: { not: 'CANCELLED' } },
    });
  });

  it('removes the cancelled bookings, then the document, when none is active', async () => {
    const { service, tx } = serviceWith({
      document: { filename: 'flat.md', property: { id: 'p1' } },
    });

    await service.remove('d1');

    expect(tx.booking.deleteMany).toHaveBeenCalledWith({
      where: { propertyId: 'p1', status: 'CANCELLED' },
    });
    expect(tx.document.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('deletes a document that has no property row', async () => {
    const { service, tx } = serviceWith({
      document: { filename: 'broken.md', property: null },
    });

    await service.remove('d1');

    expect(tx.booking.count).not.toHaveBeenCalled();
    expect(tx.document.delete).toHaveBeenCalled();
  });

  it('throws NotFound for an unknown document', async () => {
    const { service } = serviceWith({ document: null });
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });
});
