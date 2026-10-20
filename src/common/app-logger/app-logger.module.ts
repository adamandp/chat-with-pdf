import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Request, Response } from 'express';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV')! !== 'production';

        return {
          pinoHttp: {
            level: (config.get<string>('LOG_LEVEL') as string) ?? 'trace',
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  level: 'trace',
                  options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                }
              : {
                  targets: [
                    {
                      target: 'pino/file',
                      level: 'error',
                      options: {
                        destination: './logs/error.log',
                        mkdir: true,
                      },
                    },
                    {
                      target: 'pino/file',
                      level: 'warn',
                      options: {
                        destination: './logs/warn.log',
                        mkdir: true,
                      },
                    },
                    {
                      target: 'pino/file',
                      level: 'info',
                      options: {
                        destination: './logs/info.log',
                        mkdir: true,
                      },
                    },
                  ],
                },
            autoLogging: true,
            serializers: {
              req(req: Request) {
                return {
                  method: req.method,
                  url: req.url,
                  query: req.query,
                  params: req.params,
                  headers: req.headers,
                };
              },
              res(res: Response) {
                return res;
              },
            },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
