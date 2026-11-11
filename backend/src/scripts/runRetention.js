// Phase 7 / DPDP: data-retention job. Anonymizes candidate sessions whose
// retention window (DATA_RETENTION_DAYS, default 180) has passed.
// Schedule daily via the host's cron (Railway/Render cron job):
//   npm run retention            -> anonymize
//   npm run retention -- --dry-run -> list only, change nothing
const prisma = require('../db/prismaClient');
const { runRetention } = require('../services/retentionService');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await runRetention({ dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
