import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller.js';
import { PropertySearchService } from './property-search.service.js';

@Module({
  controllers: [PropertiesController],
  providers: [PropertySearchService],
  exports: [PropertySearchService],
})
export class PropertiesModule {}
