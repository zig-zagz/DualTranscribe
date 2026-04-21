import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    cognito_id_token?: string;
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    cognito_id_token?: string;
  }
}
