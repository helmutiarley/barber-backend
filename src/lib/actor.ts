import type { UserRole } from '../entities/enums';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
