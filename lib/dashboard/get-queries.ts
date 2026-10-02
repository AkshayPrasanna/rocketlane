import { getStore } from "@/lib/store/get-store";
import { createDashboardQueries } from "./queries";

export function getDashboardQueries() {
  return createDashboardQueries(getStore());
}
