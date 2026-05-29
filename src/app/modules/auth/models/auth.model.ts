export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  accessToken: string;
}

export interface LoginResponse {
  statusCode: number;
  message: string;
  data: AuthUser;
}
