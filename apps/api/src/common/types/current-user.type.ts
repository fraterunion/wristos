export type CurrentUser = {
  userId: string;
  email: string;
  tenantId: string;
  role?: string;
};

export type JwtPayload = CurrentUser;
