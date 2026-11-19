import { Module } from '@nestjs/common';
import { ContextModule } from '../ai-context/context.module';
import { MediaModule } from '../media/media.module';
import { NexconnModule } from '../nexconn/nexconn.module';
import { OperationsModule } from '../operations/operations.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [NexconnModule, ContextModule, OperationsModule, MediaModule],
  providers: [JobsService],
})
export class JobsModule {}
