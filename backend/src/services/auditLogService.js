const prisma = require('../db/prismaClient');

async function logAuditEvent({
  actorType,
  actorId = null,
  action,
  entityType,
  entityId = null,
  modelVersion = null,
  promptRef = null,
  inputRef = null,
  outputRef = null,
  purpose = null,
}) {
  return prisma.auditLog.create({
    data: {
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      modelVersion,
      promptRef,
      inputRef,
      outputRef,
      purpose,
    },
  });
}

module.exports = { logAuditEvent };
