import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'https://wristcaviar.fraterunion.com',
  ]);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('X-Debug-Cors', 'manual-cors-v1');
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.getHttpAdapter().get('/__debug_cors', (req: Request, res: Response) => {
    res.status(200).json({
      marker: 'manual-cors-v1',
      origin: req.headers.origin ?? null,
      hasAllowedOrigin:
        typeof req.headers.origin === 'string' &&
        allowedOrigins.has(req.headers.origin),
      allowedOrigins: Array.from(allowedOrigins),
    });
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 4000;
  console.log('BOOT_MARKER_MANUAL_CORS_V2');
  await app.listen(port);
  console.log(`WristOS API listening on http://localhost:${port}/api`);
}

void bootstrap();