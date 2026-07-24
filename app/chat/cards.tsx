"use client";

import { money } from "@/lib/money";
import { fmtDate } from "./format";
import type {
  CancelProposal,
  PauseProposal,
  PlanChangeProposal,
  ProposalState,
  ReactivateProposal,
  RefundProposal,
  ResumeProposal,
} from "./types";

export function RefundCard({
  proposal,
  state,
  paymentMethod,
  onInitiate,
  onDecline,
}: {
  proposal: RefundProposal;
  state: ProposalState;
  paymentMethod?: string | null;
  onInitiate: () => void;
  onDecline: () => void;
}) {
  const amount = money(proposal.amount_cents);
  const card = paymentMethod ?? "your card on file";
  return (
    <div data-testid="refund-card" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Refund request</p>
      <p className="mt-1 text-sm text-slate-800">
        This order can be refunded. Order <span className="font-mono text-xs">{proposal.order_number}</span>{" "}
        will be refunded <span className="font-semibold">{amount}</span> to {card}.
      </p>
      {proposal.items && proposal.items.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">{proposal.items.join(" · ")}</p>
      )}
      <p className="mt-0.5 text-xs text-slate-500">Reason: {proposal.reason}</p>

      {state === "pending" && (
        <>
          <p className="mt-2 text-sm text-slate-700">Do you wish to initiate the refund?</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={onInitiate}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark"
            >
              Yes, refund my order
            </button>
            <button
              onClick={onDecline}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            >
              Not now
            </button>
          </div>
        </>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Refund of {amount} initiated to {card}.</p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — no refund was made.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t process the refund — please try again.</p>
      )}
    </div>
  );
}

export function PauseCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PauseProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const resume = fmtDate(proposal.resume_date);
  const credit = money(proposal.reimbursement_cents);
  const fee = money(proposal.weekly_fee_cents);
  const hasCredit = proposal.reimbursement_cents > 0;
  return (
    <div data-testid="pause-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Pause request</p>
      {proposal.indefinite ? (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription <span className="font-semibold">indefinitely</span>? Your plan pauses from next week and stays paused until you resume it.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription for <span className="font-semibold">{proposal.weeks} week{proposal.weeks === 1 ? "" : "s"}</span>?
          Your plan pauses from next week and resumes on <span className="font-semibold">{resume}</span>.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {hasCredit ? (
          <>You&apos;ll be credited <span className="font-medium text-emerald-600">{credit}</span> now for the weeks skipped before billing, </>
        ) : proposal.already_paused ? (
          <>Your subscription is already paused, so this cycle&apos;s credit has been paid, </>
        ) : (
          <>No credit is due this cycle (billing is due within the week), </>
        )}
        after the <span className="font-medium">{fee}/week</span> pause fee — then {fee}/week is billed each billing date while you stay paused.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, pause it
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Paused{proposal.indefinite ? " indefinitely" : ` — resumes ${resume}`}{hasCredit ? ` (${credit} credited)` : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription is unchanged.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t pause the subscription — please try again.</p>
      )}
    </div>
  );
}

export function ResumeCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ResumeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const charge = money(proposal.charge_cents);
  const hasCharge = proposal.charge_cents > 0;
  const fee = money(proposal.weekly_fee_cents);
  return (
    <div data-testid="resume-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Resume request</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      <p className="mt-1 text-sm text-slate-800">
        Resume your <span className="font-semibold">{proposal.plan}</span> plan? It restarts from next week
        {hasCharge ? (
          <> — you&apos;ll be charged <span className="font-semibold">{charge}</span> for the weeks left until billing (net of the {fee}/week pause fee).</>
        ) : (
          <> at no charge this cycle (billing is due within the week).</>
        )}
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            {hasCharge ? `Pay ${charge} & resume` : "Resume"}
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Resumed on {proposal.plan}{hasCharge ? ` — ${charge} charged` : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays paused.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t resume the subscription — please try again.</p>
      )}
    </div>
  );
}

export function ReactivateCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ReactivateProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const fee = proposal.signup_fee_cents;
  const total = money(proposal.total_cents);
  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Reactivation</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      {proposal.free ? (
        <p className="mt-1 text-sm text-slate-800">
          Restart your <span className="font-semibold">{proposal.plan}</span> plan{" "}
          <span className="font-semibold text-emerald-600">for free</span> — you&apos;re still within your billing period, so there&apos;s no charge.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Restart on <span className="font-semibold">{proposal.plan}</span>? First charge is{" "}
          <span className="font-semibold">{money(proposal.monthly_cents)}</span>
          {fee > 0 ? (
            <>
              {" "}+ <span className="font-semibold">{money(fee)}</span> sign-up fee
            </>
          ) : null}{" "}
          = <span className="font-semibold">{total}</span>.
        </p>
      )}

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            {proposal.free ? "Reactivate for free" : `Pay ${total} & reactivate`}
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Reactivated on {proposal.plan}{proposal.free ? " (free)" : ` — ${total} charged`}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays cancelled.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t reactivate — please try again.</p>}
    </div>
  );
}

export function PlanCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PlanChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const p = proposal.proration_cents;
  const weeks = `${proposal.weeks_until_billing} week${proposal.weeks_until_billing === 1 ? "" : "s"}`;
  const proration =
    p > 0
      ? `You'll be charged ${money(p)} now (prorated for the ${weeks} until billing).`
      : p < 0
        ? `You'll be refunded ${money(-p)} (prorated for the ${weeks} until billing).`
        : "No proration is due this cycle.";
  return (
    <div data-testid="plan-card" className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">Plan change</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch{proposal.current_plan ? ` from ${proposal.current_plan}` : ""} to{" "}
        <span className="font-semibold">{proposal.plan}</span> at <span className="font-semibold">{money(proposal.monthly_cents)}/month</span>?
      </p>
      {proposal.weekly_savings_cents != null && proposal.weekly_savings_cents > 0 && (
        <p className="mt-1 text-xs text-emerald-600">
          That&apos;s <span className="font-medium">{money(proposal.weekly_savings_cents)}/week</span> less than buying those meals à la carte.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">{proration} Your new plan starts next week.</p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, switch plan
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-emerald-700">✓ Plan changed to {proposal.plan} ({money(proposal.monthly_cents)}/month).</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your plan is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t change the plan — please try again.</p>}
    </div>
  );
}

export function CancelCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: CancelProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const billing = fmtDate(proposal.billing_date);
  return (
    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Cancel subscription</p>
      <p className="mt-1 text-sm text-slate-800">Cancel your subscription? Future boxes will stop.</p>
      <p className="mt-1 text-xs text-slate-500">
        Heads up: if you resubscribe after your billing date{billing ? ` (${billing})` : ""}, a{" "}
        <span className="font-medium">{money(proposal.signup_fee_cents)}</span> sign-up fee applies. Resubscribe before then on the same plan and it&apos;s free.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700">
            Yes, cancel
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Keep my subscription
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-slate-700">✓ Subscription cancelled.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-emerald-700">Great — your subscription is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t cancel — please try again.</p>}
    </div>
  );
}
