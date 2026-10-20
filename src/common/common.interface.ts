import { Request } from 'express';

export interface Paging {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface WebResponse<T = unknown> {
  message?: string;
  errors?: string;
  data?: T;
  paging?: Paging;
}

export interface CookieRequest extends Request {
  cookies: {
    refreshToken?: string;
  };
}
