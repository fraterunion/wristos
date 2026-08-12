export type CurrentUser = {
  userId: string;
  email: string;
  tenantId: string;
  role?: string;
  isDemo: boolean;
};

export type JwtPayload = CurrentUser;
