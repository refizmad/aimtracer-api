import { IsOptional, IsInt, Min, Max, IsString, IsEnum, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum JobStatusUpdate {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export class UpdateProgressDto {
  @ApiPropertyOptional({ description: 'Completion percentage', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ description: 'Current processing stage, e.g. "rendering"' })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ description: 'Human-readable status message' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ enum: JobStatusUpdate, description: 'Terminal or in-progress state' })
  @IsOptional()
  @IsEnum(JobStatusUpdate)
  status?: JobStatusUpdate;

  @ApiPropertyOptional({
    description: 'Final result payload (set when status = COMPLETED)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  result?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Error detail (set when status = FAILED)' })
  @IsOptional()
  @IsString()
  error?: string;
}
