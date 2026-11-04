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
  username?: string | null;
  name?: string | null;
  accountType?: 'GUEST' | 'REGISTERED';
}

export type {
  LoginResultDTO,
  LoginResDTO,
  ValidateUsernameResDTO,
  GetProfileResDTO,
};
