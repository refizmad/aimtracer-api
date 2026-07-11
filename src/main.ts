import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 5500);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Browser talks to the Next BFF only in production. Allow local web origin for dev.
  const webOrigin = configService.get<string>('AUTH_RETURN_BASE_URL');
  app.enableCors({
    origin: webOrigin ? [webOrigin, 'http://127.0.0.1:3000', 'http://localhost:3000'] : true,
    credentials: true,
  });

  // Swagger / OpenAPI docs — local development only, never in production.
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('aimtrace-api')
      .setDescription('Clip job queue + worker leasing + friends auth API')
      .setVersion('0.1.0')
      .addApiKey(
        { type: 'apiKey', name: 'x-machine-token', in: 'header' },
        'machine-token',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-bootstrap-token', in: 'header' },
        'bootstrap-token',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-admin-token', in: 'header' },
        'admin-token',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-session-token', in: 'header' },
        'session-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    console.log(`📖 Swagger UI at http://localhost:${port}/docs`);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 aimtrace-api listening on :${port} (Fastify)`);
}
bootstrap();
