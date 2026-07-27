const prisma = require('../db/prismaClient');
const config = require('../config');

async function hasValidConsent(candidateId) {
  const records = await prisma.consentRecord.findMany({
    where: { candidateId, consentWithdrawnAt: null },
  });
  const grantedTypes = new Set(records.map((r) => r.consentType));
  return config.requiredConsentTypes.every((type) => grantedTypes.has(type));
}

module.exports = { hasValidConsent };
