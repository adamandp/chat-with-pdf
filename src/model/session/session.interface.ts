interface JwtPayload {
  sub: string;
  sid: string;
}

interface CreateTokenDTO {
  payload: Pick<JwtPayload, 'sub'>;
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
