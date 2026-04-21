import NextAuth from 'next-auth'
import Cognito from 'next-auth/providers/cognito'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Cognito({
      clientId: process.env.AUTH_COGNITO_ID!,      
      clientSecret: process.env.AUTH_COGNITO_SECRET!,
      issuer: process.env.AUTH_COGNITO_ISSUER!,
      authorization: {
        params: {
          scope: "openid",
          ...(process.env.AUTH_COGNITO_IDENTITY_PROVIDER
            ? { identity_provider: process.env.AUTH_COGNITO_IDENTITY_PROVIDER }
            : {}),
        },
      },
      checks: ["pkce", "state", "nonce"],
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.id_token) token.cognito_id_token = account.id_token
      return token
    },
    async session({ session, token }) {
      session.cognito_id_token = token.cognito_id_token as string | undefined
      return session
    },
  },
})

