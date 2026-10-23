interface LoginResultDTO {
  accessToken?: string;
  refreshToken?: string;
}

interface LoginResDTO {
  accessToken?: string;
}

interface ValidateUsernameResDTO {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
}

interface GetProfileResDTO {
  id?: string;
  username?: string;
  name?: string | null;
}

export type {
  LoginResultDTO,
  LoginResDTO,
  ValidateUsernameResDTO,
  GetProfileResDTO,
};
