// The Car Thing has no NTP (its clock sits in 2024), so the page keeps time by
// the laptop: every snapshot/time event carries the server's Date.now().
export function createClock() {
  let skew = null;
  return {
    sync(serverNow, localNow = Date.now()) { skew = serverNow - localNow; },
    now(localNow = Date.now()) { return skew === null ? localNow : localNow + skew; },
  };
}
