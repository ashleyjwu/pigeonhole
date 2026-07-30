import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** pigeonhole's internal user id (uuid from the users table). */
    userId?: string;
    user: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}
