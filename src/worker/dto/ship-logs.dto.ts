import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkerLogLineDto {
  @ApiProperty({ description: 'One console-log line from the worker' })
  @IsString()
  @MaxLength(2000)
  line!: string;

  @ApiPropertyOptional({ description: 'Job the line belongs to, if any' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  jobId?: string;

  @ApiPropertyOptional({ description: 'Worker-side ISO timestamp' })
  @IsOptional()
  @IsISO8601()
  at?: string;
}

export class ShipLogsDto {
  @ApiProperty({ type: [WorkerLogLineDto], description: 'Batch of log lines' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WorkerLogLineDto)
  lines!: WorkerLogLineDto[];
}
