export interface CustomerOption {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: string;
  plan: string;
  phone?: string | null;
  address?: string | null;
  paymentMethod?: string | null;
}

export interface Source {
  slug: string;
  heading: string;
  score?: number;
}

export interface Step {
  name: string;
  status: "running" | "done";
  ok?: boolean;
  summary?: string;
}

export interface AddOn {
  name: string;
  priceCents: number;
}

export interface OrderView {
  order_number: string;
  kind: string; // subscription | extra
  status: string;
  charged_cents: number;
  list_price_cents: number;
  add_ons: AddOn[];
  refund_cents: number;
  delivered_on?: string | null;
  expected_delivery_date?: string | null;
  refunded: boolean;
  refunded_at?: string | null;
  items: string[];
}

export interface TransactionView {
  type: string;
  amount_cents: number;
  description: string;
  order_number?: string | null;
  date: string;
}

export interface HistoryData {
  orders: OrderView[];
  transactions: TransactionView[];
}

export interface RefundProposal {
  order_number: string;
  amount_cents: number;
  list_price_cents?: number;
  add_ons?: AddOn[];
  kind?: string;
  reason: string;
  items?: string[];
}

export interface PauseProposal {
  indefinite: boolean;
  weeks: number | null;
  resume_date: string | null;
  reimbursement_cents: number;
  weekly_fee_cents: number;
  weeks_to_billing: number;
  /** Already paused, so the up-front credit was spent on this billing period. */
  already_paused: boolean;
}

export interface ResumeProposal {
  plan: string;
  previous_plan?: string | null;
  plan_changed: boolean;
  weekly_cents: number;
  weekly_fee_cents: number;
  charge_cents: number;
  weeks_to_billing: number;
  billing_date?: string | null;
}

export interface ReactivateProposal {
  plan: string;
  previous_plan?: string | null;
  plan_changed: boolean;
  monthly_cents: number;
  signup_fee_cents: number;
  total_cents: number;
  free: boolean;
  within_billing: boolean;
  billing_date?: string | null;
}

export interface PlanChangeProposal {
  plan: string;
  monthly_cents: number;
  weekly_cents: number;
  current_plan?: string | null;
  proration_cents: number;
  weeks_until_billing: number;
  billing_date?: string | null;
  weekly_savings_cents?: number;
}

export interface CancelProposal {
  billing_date?: string | null;
  signup_fee_cents: number;
}

export type ProposalState = "pending" | "approved" | "declined" | "error";

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: Step[];
  history?: HistoryData;
  proposal?: RefundProposal;
  proposalState?: ProposalState;
  pauseProposal?: PauseProposal;
  pauseState?: ProposalState;
  resumeProposal?: ResumeProposal;
  resumeState?: ProposalState;
  reactivateProposal?: ReactivateProposal;
  reactivateState?: ProposalState;
  planProposal?: PlanChangeProposal;
  planState?: ProposalState;
  cancelProposal?: CancelProposal;
  cancelState?: ProposalState;
}

export interface AccountData {
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    address?: string | null;
    paymentMethod?: string | null;
    plan: string;
    subscriptionStatus: string;
    billingDate?: string | null;
  };
  orders: OrderView[];
  transactions: TransactionView[];
  statusHistory: { event: string; date: string }[];
}
