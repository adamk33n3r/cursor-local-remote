import { loginRequiresCookie } from "../../../lib/login";
import { HostsList } from "../../components/hosts-list";

export default function HostsPage() {
  return <HostsList showLogout={loginRequiresCookie()} />;
}
