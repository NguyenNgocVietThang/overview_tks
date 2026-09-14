'use strict';

// Chay toi da `limit` ham async cung luc tu 1 danh sach `tasks` (() => Promise).
// Tra ve mang ket qua dang { status: 'fulfilled'|'rejected', value|reason },
// giong Promise.allSettled - 1 tac vu loi khong dung cac tac vu con lai.
async function runWithConcurrencyLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        const value = await tasks[currentIndex]();
        results[currentIndex] = { status: 'fulfilled', value };
      } catch (reason) {
        results[currentIndex] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.max(0, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = { runWithConcurrencyLimit };
