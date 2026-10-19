// Ghi log bo nho tien trinh dinh ky + canh bao som khi RSS tien sat tran RAM cua instance.
const WARN_RATIO = 0.75;

function toMb(bytes) {
  return Math.round((Number(bytes) || 0) / 1048576);
}

function startMemoryMonitor({
  intervalMs = 60000,
  limitMb = 2048,
  logger = console,
  setIntervalFn = setInterval,
  memoryUsage = () => process.memoryUsage()
} = {}) {
  function tick() {
    const m = memoryUsage();
    const rss = toMb(m.rss);
    logger.log(
      `[Memory] rss=${rss}MB heap=${toMb(m.heapUsed)}MB external=${toMb(m.external)}MB arrayBuffers=${toMb(m.arrayBuffers)}MB`
    );
    if (rss > limitMb * WARN_RATIO) {
      logger.warn(`[Memory] CANH BAO: rss=${rss}MB vuot ${Math.round(WARN_RATIO * 100)}% tran ${limitMb}MB`);
    }
  }

  const timer = setIntervalFn(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
    tick
  };
}

module.exports = { startMemoryMonitor };
