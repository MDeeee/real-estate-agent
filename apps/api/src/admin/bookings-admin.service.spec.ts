import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BookingsAdminService } from './bookings-admin.service.js';

function row(status: 'CONFIRMED' | 'CANCELLED') {
  return {
    id: 'cm0abcdefghijklmnopqrstuv',
    name: 'Test Visitor',
    phone: '+20 100 000 0000',
    preferredDate: new Date('2026-12-01T00:00:00Z'),
    preferredTime: '17:00',
    status,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    property: { slug: 'flat', title: 'Flat' },
  };
}

function serviceWith(existing: ReturnType<typeof row> | null) {
  const update = vi.fn(async () => row('CANCELLED'));
  const prisma = {
    booking: { findUnique: vi.fn(async () => existing), update },
  };
  return {
    service: new BookingsAdminService(prisma as unknown as PrismaService),
    update,
  };
}

describe('BookingsAdminService.cancel', () => {
  it('sets the status to CANCELLED and returns the booking with its reference', async () => {
    const { service, update } = serviceWith(row('CONFIRMED'));

    const result = await service.cancel('cm0abcdefghijklmnopqrstuv');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(result).toMatchObject({
      status: 'CANCELLED',
      reference: 'OPQRSTUV',
      preferredDate: '2026-12-01',
    });
  });

  it('returns an already cancelled booking unchanged, without writing', async () => {
    const { service, update } = serviceWith(row('CANCELLED'));

    const result = await service.cancel('cm0abcdefghijklmnopqrstuv');

    expect(update).not.toHaveBeenCalled();
    expect(result.status).toBe('CANCELLED');
  });

  it('throws NotFound for an unknown id', async () => {
    const { service, update } = serviceWith(null);

    await expect(service.cancel('cm0abcdefghijklmnopqrstuv')).rejects.toThrow(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
