const prisma = require('../db/prismaClient');

class InsufficientCreditsError extends Error {
  constructor(orgId) {
    super(`Organization ${orgId} has no credits remaining`);
    this.orgId = orgId;
  }
}

// Deducts exactly 1 credit for `sessionId` and records the transaction, in
// the same DB transaction as the caller's candidate_session creation — so a
// failed deduction rolls back the session too, and the balance can never go
// negative (the conditional WHERE only matches rows with balance > 0).
// Phase 4.6 moved this from interview/template creation to session (i.e.
// candidate invite) creation — see docs/DECISIONS.md.
async function deductCreditForSession(tx, orgId, sessionId) {
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
      sessionId,
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
      data: { orgId, amount, type: 'GRANT', sessionId: null, addedBy },
    });

    return org;
  });
}

module.exports = { deductCreditForSession, grantCredits, InsufficientCreditsError };
