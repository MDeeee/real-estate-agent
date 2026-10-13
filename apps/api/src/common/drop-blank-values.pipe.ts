import type { PipeTransform } from '@nestjs/common';

export class DropBlankValuesPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== ''),
    );
  }
}
