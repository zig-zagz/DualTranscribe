export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/live/:path*", "/api/protected/:path*"],
};
