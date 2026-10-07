export function actualRestorePassed(record, migrationCount) {
  const restoredCount = Array.isArray(record?.checks) ? record.checks.find(item => Array.isArray(item?.migrations))?.migrations?.[0]?.count : undefined;
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  return record?.status === 'PASSED' && record?.cleanup === 'PASSED'
    && Number.isInteger(migrationCount) && migrationCount > 0 && restoredCount === migrationCount
    && Array.isArray(record?.checks) && record.checks.length > 0 && record.checks.every(item => item?.status === 'PASS')
    && Number.isInteger(record.backup?.bytes) && record.backup.bytes > 0 && record.backup?.files === 4
    && /^[0-9a-f]{64}$/.test(record.backup?.checksum ?? '')
    && nonnegative(record.measurements?.recoveryMs) && record.measurements.recoveryMs <= 4 * 60 * 60 * 1000
    && nonnegative(record.measurements?.checkpointAgeAtOutageMs) && record.measurements.checkpointAgeAtOutageMs <= 15 * 60 * 1000;
}
