import {
  BadRequestException,
  Body,
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
import { CsrfHeaderGuard } from '../common/csrf-header.guard.js';
import {
  type Page,
  type PaginationQuery,
  paginationQuerySchema,
} from '../common/pagination.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import {
  type IngestResult,
  MAX_FILES_PER_REQUEST,
  type UploadedFile,
} from '../ingestion/ingestion.types.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import {
  type DocumentListItem,
  DocumentsAdminService,
} from './documents-admin.service.js';
import { UploadFilesInterceptor } from './upload-error.interceptor.js';

const idParamSchema = z.string().min(1).max(64);

/** One approval: the slug, and the `existingContentHash` of the version the admin saw. */
const replacementSchema = z.strictObject({
  slug: z.string().min(1).max(120),
  existingContentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** A repeated multipart field arrives as one string or an array of them. */
function parseReplacement(value: string, ctx: z.RefinementCtx): unknown {
  try {
    return JSON.parse(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a JSON object' });
    return z.NEVER;
  }
}

/**
 * Text fields of the multipart upload. `replacements` (repeat the field, once
 * per listing) holds JSON `{"slug": ..., "existingContentHash": ...}` for each
 * listing the admin agreed to overwrite, naming the exact version they saw in
 * the conflict; a slug that no uploaded file carries is ignored. A request
 * without a body (no multipart data at all) reaches the handler's own message.
 */
const uploadFieldsSchema = z
  .object({
    replacements: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => (value === undefined ? [] : [value].flat()))
      .pipe(
        z
          .array(
            z
              .string()
              .max(512)
              .transform(parseReplacement)
              .pipe(replacementSchema),
          )
          .max(MAX_FILES_PER_REQUEST),
      ),
  })
  .default({ replacements: [] });
type UploadFields = z.infer<typeof uploadFieldsSchema>;

@Controller('admin/documents')
@UseGuards(AdminAuthGuard, CsrfHeaderGuard)
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
    @Body(new ZodValidationPipe(uploadFieldsSchema)) fields: UploadFields,
  ): Promise<IngestResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Attach at least one .md file in the "files" field.',
      );
    }
    const replacements = new Map(
      fields.replacements.map((r) => [r.slug, r.existingContentHash]),
    );
    const results: IngestResult[] = [];
    for (const file of files) {
      results.push(await this.ingestion.ingestUpload(file, { replacements }));
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
