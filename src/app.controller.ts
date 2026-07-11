import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('meta')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Liveness/health probe' })
  health() {
    return { status: 'ok', service: 'aimtrace-api', time: new Date().toISOString() };
  }

  @Get()
  root() {
    return {
      name: 'aimtrace-api',
      version: '0.1.0',
      docs: 'See README.md for worker job leasing API',
    };
  }
}
