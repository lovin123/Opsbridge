import { Module } from '@nestjs/common';
import { NexconnApiClient } from './nexconn-api.client';
import { NexconnController } from './nexconn.controller';
import { NexconnService } from './nexconn.service';

@Module({
  controllers: [NexconnController],
  providers: [NexconnApiClient, NexconnService],
  exports: [NexconnApiClient, NexconnService],
})
export class NexconnModule {}
