import { IsString, IsOptional, IsObject, IsArray, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobDto {
  @ApiPropertyOptional({ description: 'Job type discriminator', default: 'clip' })
  @IsOptional()
  @IsString()
  type?: string = 'clip';

  @ApiProperty({
    description: 'Arbitrary job payload consumed by the worker',
    type: 'object',
    additionalProperties: true,
    example: { demoUrl: 'https://…/match.dem', round: 12 },
  })
  @IsObject()
  payload: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Max retry attempts before the job is marked failed',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;
}
