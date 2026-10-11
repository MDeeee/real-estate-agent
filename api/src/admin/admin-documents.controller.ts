import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  type Page,
  type PaginationQuery,
  paginationQuerySchema,
} from '../common/pagination.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import type {
  IngestResult,
  UploadedFile,
} from '../ingestion/ingestion.types.js';
import { AdminTokenGuard } from './admin-token.guard.js';
import {
  type DocumentListItem,
  DocumentsAdminService,
} from './documents-admin.service.js';
import { UploadFilesInterceptor } from './upload-error.interceptor.js';

const idParamSchema = z.string().min(1).max(64);

@Controller('admin/documents')
@UseGuards(AdminTokenGuard)
export class AdminDocumentsController {
  constructor(
    @Inject(IngestionService) private readonly ingestion: IngestionService,
    @Inject(DocumentsAdminService)
    private readonly documents: DocumentsAdminService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(UploadFilesInterceptor)
  async upload(
    @UploadedFiles() files: UploadedFile[] | undefined,
  ): Promise<IngestResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Attach at least one .md file in the "files" field.',
      );
    }
    const results: IngestResult[] = [];
    for (const file of files) {
      results.push(await this.ingestion.ingestUpload(file));
    }
    return results;
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: PaginationQuery,
  ): Promise<Page<DocumentListItem>> {
    return this.documents.list(query);
  }

  @Post(':id/reindex')
  @HttpCode(200)
  reindex(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<IngestResult> {
    return this.ingestion.reindex(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<void> {
    return this.documents.remove(id);
  }
}
