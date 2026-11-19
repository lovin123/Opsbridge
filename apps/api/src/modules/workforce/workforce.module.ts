import { Module } from '@nestjs/common';
import { NexconnModule } from '../nexconn/nexconn.module';
import { WorkforceController } from './workforce.controller';
import { WorkforceService } from './workforce.service';

@Module({
  imports: [NexconnModule],
  controllers: [WorkforceController],
  providers: [WorkforceService],
})
export class WorkforceModule {}
