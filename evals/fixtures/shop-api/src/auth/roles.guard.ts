// Auth/security surface: role-based access guard.
export class RolesGuard {
  canActivate(role: string) {
    return role === "admin" || role === "user";
  }
}
