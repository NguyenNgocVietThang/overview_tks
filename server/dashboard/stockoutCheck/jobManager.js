'use strict';

const crypto = require('crypto');

function createJobStore({ ttlAfterDoneMs = 45 * 60 * 1000, now = Date.now } = {}) {
  const jobs = new Map();

  function createJob() {
    const id = crypto.randomUUID();
    jobs.set(id, {
      id,
      status: 'running',
      createdAt: now(),
      updatedAt: now(),
      doneAt: null,
      invalidCodes: [],
      totalValidCodes: 0,
      progress: {},
      result: null,
      error: null
    });
    return id;
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    if (job.doneAt !== null && now() - job.doneAt > ttlAfterDoneMs) {
      jobs.delete(jobId);
      return null;
    }
    return job;
  }

  function updateProgress(jobId, patch) {
    const job = jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, {
      progress: patch.progress ? { ...job.progress, ...patch.progress } : job.progress
    });
    job.updatedAt = now();
  }

  function setResult(jobId, result) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = 'done';
    job.result = result;
    job.updatedAt = now();
    job.doneAt = now();
  }

  function setError(jobId, error) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = 'error';
    job.error = error;
    job.updatedAt = now();
    job.doneAt = now();
  }

  return { createJob, getJob, updateProgress, setResult, setError };
}

module.exports = { createJobStore };
