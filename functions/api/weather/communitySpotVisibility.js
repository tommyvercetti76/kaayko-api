function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
}

function isPublicPaddlingSpot(data, now = Date.now()) {
  if (!data || data.archived === true) return false;
  if (!data.communitySubmission) return true;

  const status = String(data.submissionStatus || '').toLowerCase();
  if (status === 'rejected' || status === 'hidden') return false;
  if (status === 'validated' || status === 'live') return true;

  const goLiveAt = toMillis(data.goLiveAt);
  return goLiveAt !== null && goLiveAt <= now;
}

module.exports = { isPublicPaddlingSpot, toMillis };
