import { describe, expect, it, vi } from 'vitest';
import { ttlCached } from './ttl-cache.js';

describe('ttlCached', () => {
  it('loads once within the ttl and again after it expires', async () => {
    let clock = 0;
    const load = vi.fn(() => Promise.resolve(`v${load.mock.calls.length}`));
    const get = ttlCached(60_000, load, () => clock);

    expect(await get()).toBe('v1');
    clock = 59_999;
    expect(await get()).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
    clock = 60_000;
    expect(await get()).toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers and does not cache failures', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue('ok');
    const get = ttlCached(60_000, load);

    await expect(Promise.all([get(), get()])).rejects.toThrow('db down');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await get()).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
