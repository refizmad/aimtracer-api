import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import {
  assertProductionConfig,
  isProduction,
} from './common/prod-config';

async function bootstrap() {
  // Before Nest DI: refuse a half-configured production process.
  assertProductionConfig(process.env);

  const prod = isProduction(process.env);
  const logLevel = (process.env.LOG_LEVEL || (prod ? 'info' : 'debug')).toLowerCase();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Coolify / reverse proxies: rate-limit and access logs use real client IP.
      trustProxy: true,
      logger: {
        level: logLevel,
      },
    }),
    {
      // Nest application logger (services using Logger)
      logger: prod
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    },
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

  // BFF is server-side; CORS is a backstop. Never reflect * in production.
  const webOrigin = (configService.get<string>('AUTH_RETURN_BASE_URL') || '').trim();
  if (prod) {
    app.enableCors({
      origin: webOrigin ? [webOrigin] : false,
      credentials: true,
    });
  } else {
    app.enableCors({
      origin: webOrigin
        ? [webOrigin, 'http://127.0.0.1:3000', 'http://localhost:3000']
        : true,
      credentials: true,
    });
  }

  // Swagger — local development only.
  if (!prod) {
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
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
