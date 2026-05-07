import { Plan } from "../../domain/plan";

export function markDispatched(plan: Plan): Plan {
  return {
    ...plan,
    status: "DISPATCHED",
    updatedAt: new Date().toISOString(),
  };
}

