import { Plan } from "../../domain/plan";

export function submitForAcceptance(plan: Plan): Plan {
  return {
    ...plan,
    status: "IN_ACCEPTANCE",
    updatedAt: new Date().toISOString(),
  };
}

export function acceptPlan(plan: Plan): Plan {
  return {
    ...plan,
    status: "DONE",
    updatedAt: new Date().toISOString(),
  };
}

