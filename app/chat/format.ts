export const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the help center",
  lookup_order: "Looking up your orders",
  pause_subscription: "Preparing a pause",
  resume_subscription: "Resuming your subscription",
  reactivate_subscription: "Preparing reactivation",
  cancel_subscription: "Preparing cancellation",
  change_plan: "Preparing a plan change",
  change_dietary_track: "Preparing a dietary change",
  list_orders: "Fetching your order history",
  issue_refund: "Preparing a refund",
  escalate_to_human: "Escalating to a human",
};

/** Format an ISO YYYY-MM-DD date as DD-MM-YYYY for display. */
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};
