export class WearablesError extends Error {}

export class WearablesHttpError extends WearablesError {
  httpStatus = 500;
  code = 'error';
  message = 'An unexpected error has occurred.';
}

export class InternalServerError extends WearablesHttpError {}

export class BadRequestError extends WearablesHttpError {
  httpStatus = 400;
  code = 'bad_request';
  message = 'Request not understood due to invalid syntax.';
}

export class UnauthorizedError extends WearablesHttpError {
  httpStatus = 401;
  code = 'unauthorized';
  message = 'Missing or invalid authentication.';
}

export class ForbiddenError extends WearablesHttpError {
  httpStatus = 403;
  code = 'forbidden';
  message = 'Insufficient permission to access requested resource.';
}

export class NotFoundError extends WearablesHttpError {
  httpStatus = 404;
  code = 'not_found';
  message = 'Requested resource does not exist.';
}
