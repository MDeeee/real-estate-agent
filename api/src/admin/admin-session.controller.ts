import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard.js';

@Controller('admin/session')
@UseGuards(AdminTokenGuard)
export class AdminSessionController {
  @Get()
  @HttpCode(204)
  verify(): void {}
}
