import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LeaseQueryDto {
  @ApiPropertyOptional({
    description: 'Seconds to long-poll for a job (0 = return immediately)',
    minimum: 0,
    maximum: 60,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  wait?: number; // seconds to long-poll, default 0 = immediate
}
