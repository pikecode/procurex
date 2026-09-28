import { Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.auth!.user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.auth!.user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const notification = await this.notifications.markRead(id, request.auth!.user.id);
    if (!notification) throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification was not found' });
    return notification;
  }
}
