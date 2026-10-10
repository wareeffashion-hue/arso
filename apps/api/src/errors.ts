import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * شكل الخطأ الموحد (القسم 42). لا SQL ولا stack trace للعميل أبدًا.
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
    retryable: boolean;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_BY_STATUS: Record<number, { code: string; message: string; retryable: boolean }> = {
  400: { code: 'BAD_REQUEST', message: 'صيغة الطلب غير صحيحة', retryable: false },
  401: { code: 'UNAUTHENTICATED', message: 'سجّل الدخول للمتابعة', retryable: false },
  403: { code: 'FORBIDDEN', message: 'لا تملك صلاحية هذا الإجراء', retryable: false },
  404: { code: 'NOT_FOUND', message: 'العنصر غير موجود', retryable: false },
  409: {
    code: 'CONFLICT',
    message: 'تغيّر هذا العنصر قبل لحظات. راجع آخر نسخة ثم أعد المحاولة',
    retryable: false,
  },
  422: { code: 'VALIDATION_FAILED', message: 'بعض القيم غير صالحة', retryable: false },
  429: { code: 'RATE_LIMITED', message: 'طلبات كثيرة. حاول بعد قليل', retryable: true },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'الخدمة غير متاحة مؤقتًا', retryable: true },
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody['error'];

    if (exception instanceof ApiError) {
      status = exception.status;
      body = {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
        request_id: requestId,
        retryable: exception.retryable,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const d = DEFAULT_BY_STATUS[status] ?? {
        code: 'ERROR',
        message: 'تعذّر إتمام الطلب',
        retryable: false,
      };
      body = { ...d, request_id: requestId };
    } else {
      // خطأ غير متوقع: يُسجَّل كاملًا في الخادم، ولا يصل منه شيء للعميل
      this.logger.error({ requestId, err: exception });
      body = {
        code: 'INTERNAL_ERROR',
        message: 'حدث خطأ غير متوقع. فريقنا يتابعه',
        request_id: requestId,
        retryable: true,
      };
    }
    res.status(status).json({ error: body } satisfies ErrorBody);
  }
}
