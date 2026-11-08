export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'Invalid input') {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message = 'Too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(message = 'Send JSON.') {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }
}
