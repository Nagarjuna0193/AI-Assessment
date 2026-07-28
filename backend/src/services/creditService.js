const prisma = require('../db/prismaClient');

class InsufficientCreditsError extends Error {
  constructor(orgId) {
    super(`Organization ${orgId} has no credits remaining`);
    this.orgId = orgId;
  }
}

// Deducts exactly 1 credit for `interviewId` and records the transaction, in
// the same DB transaction as the caller's interview creation — so a failed
// deduction rolls back the interview too, and the balance can never go
// negative (the conditional WHERE only matches rows with balance > 0).
async function deductCreditForInterview(tx, orgId, interviewId) {
  const result = await tx.organization.updateMany({
    where: { id: orgId, creditBalance: { gt: 0 } },
    data: { creditBalance: { decrement: 1 } },
  });

  if (result.count === 0) {
    throw new InsufficientCreditsError(orgId);
  }

  await tx.creditTransaction.create({
    data: {
      orgId,
      amount: 1,
      type: 'DEDUCTION',
      interviewId,
      addedBy: 'system',
    },
  });
}

// Ops-initiated credit grant — never called from a self-serve/candidate or
// org-user-facing path. See docs/DECISIONS.md.
async function grantCredits(orgId, amount, addedBy) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { creditBalance: { increment: amount } },
    });

    await tx.creditTransaction.create({
      data: { orgId, amount, type: 'GRANT', interviewId: null, addedBy },
    });

    return org;
  });
}

module.exports = { deductCreditForInterview, grantCredits, InsufficientCreditsError };
