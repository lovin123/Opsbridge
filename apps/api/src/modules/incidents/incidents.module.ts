import { Module } from '@nestjs/common';
import { NexconnModule } from '../nexconn/nexconn.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [NexconnModule, NotificationsModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
