import { hostPickNextPath } from "../../lib/host-pick";
import { LoginForm } from "../components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm next={hostPickNextPath(params.next) ?? ""} />;
}
