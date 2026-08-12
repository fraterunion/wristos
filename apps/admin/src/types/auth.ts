export type AuthUser = {
  userId: string;
  email: string;
  tenantId: string;
  role?: string;
  isDemo?: boolean;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};
