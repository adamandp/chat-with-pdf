interface JwtPayload {
  sub: string;
  sid?: string;
}

interface CreateTokenDTO {
  payload: JwtPayload;
}

interface RefreshAccessTokenResDTO {
  accessToken: string;
}

interface CreateTokenResDTO {
  refreshToken: string;
  accessToken: string;
}

export type {
  JwtPayload,
  CreateTokenDTO,
  CreateTokenResDTO,
  RefreshAccessTokenResDTO,
};
