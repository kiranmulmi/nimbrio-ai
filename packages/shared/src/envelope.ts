/** Response shapes shared by the API and its clients. */

export type ErrorBody = {
  code: string;
  message: string;
};

export type ErrorEnvelope = {
  error: ErrorBody;
};

export type DataEnvelope<T> = {
  data: T;
};

export type Envelope<T> = DataEnvelope<T> | ErrorEnvelope;

export type PageMeta = {
  total: number;
  page: number;
  pageSize: number;
};

export type PagedEnvelope<T> = {
  data: T[];
  meta: PageMeta;
};

export function isErrorEnvelope(value: Envelope<unknown>): value is ErrorEnvelope {
  return 'error' in value;
}

export type PagedResponse<T> = PagedEnvelope<T> | ErrorEnvelope;

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}
