import type { DefaultSession } from 'next-auth';
import type { Role } from '@prisma/client';

declare module 'next-auth' {
  interface User {
    role: Role;
    firstName: string;
    lastName: string;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      firstName: string;
      lastName: string;
      email: string;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    role: Role;
    firstName: string;
    lastName: string;
    /** Epoch ms of the last real authentication (sign-in or reauth). Not `iat`, which moves on refresh. */
    authTime: number;
    /** Epoch ms of the last DB revocation check. */
    checkedAt: number;
  }
}
