import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContextService } from './context.service';

@Module({
  imports: [AiModule],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
