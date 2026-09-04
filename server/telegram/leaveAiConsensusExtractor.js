'use strict';

const { resolveLeaveMessage } = require('../hr/leaveMessageResolver');
const leaveAiExtractor = require('./leaveAiExtractor');

const CONFIDENCE_THRESHOLD = 0.75;

class LeaveAiConsensusError extends Error {
  constructor(code) {
    super(`Leave AI consensus failed: ${code}`);
    this.name = 'LeaveAiConsensusError';
    this.code = code;
  }
}

function loadConfig() {
  return require('../config');
}

function dateKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildVote(extraction, context, resolver) {
  if (!extraction || extraction.confidence < CONFIDENCE_THRESHOLD) return null;
  if (extraction.intent === 'other') {
    return { key: 'other', extraction };
  }
  if (extraction.intent !== 'leave_request') return null;

  const resolved = resolver(extraction, context.messageTime, { noticeHours: context.noticeHours });
  return {
    key: JSON.stringify([
      'leave_request',
      dateKey(resolved.startDate),
      resolved.startSession,
      dateKey(resolved.endDate),
      resolved.endSession,
      resolved.totalSessions
    ]),
    extraction
  };
}

function resolveDependencies(dependencies) {
  const needsConfig = dependencies.models === undefined || dependencies.singleModel === undefined;
  const config = needsConfig ? loadConfig() : null;
  const configuredModels = dependencies.models === undefined ? config.AI_LEAVE_API_MODELS : dependencies.models;
  return {
    models: [...new Set(Array.isArray(configuredModels) ? configuredModels.filter(Boolean) : [])],
    singleModel: dependencies.singleModel === undefined ? config.AI_LEAVE_API_MODEL : dependencies.singleModel,
    extractOne: dependencies.extractOne || leaveAiExtractor.extractLeaveMessage,
    resolver: dependencies.resolver || resolveLeaveMessage,
    now: dependencies.now || Date.now
  };
}

function chooseWinner(votes) {
  return [...votes].sort((left, right) => (
    right.extraction.confidence - left.extraction.confidence
    || left.latencyMs - right.latencyMs
    || left.modelIndex - right.modelIndex
  ))[0];
}

async function extractLeaveMessage(text, context, dependencies = {}) {
  const { models, singleModel, extractOne, resolver, now } = resolveDependencies(dependencies);
  if (models.length < 2) {
    const model = models[0] || singleModel;
    return extractOne(text, context, { model });
  }

  return new Promise((resolve, reject) => {
    const controllers = models.map(() => new AbortController());
    const votesByKey = new Map();
    let settled = 0;
    let finished = false;

    const settleWithoutVote = () => {
      settled += 1;
      if (!finished && settled === models.length) {
        finished = true;
        reject(new LeaveAiConsensusError('AI_LEAVE_NO_CONSENSUS'));
      }
    };

    models.forEach((model, modelIndex) => {
      const startedAt = now();
      Promise.resolve()
        .then(() => extractOne(text, context, { model, signal: controllers[modelIndex].signal }))
        .then(extraction => {
          if (finished) return;
          let vote;
          try {
            vote = buildVote(extraction, context, resolver);
          } catch (_error) {
            vote = null;
          }
          if (!vote) return;

          const completedVote = {
            ...vote,
            latencyMs: Math.max(0, now() - startedAt),
            modelIndex
          };
          const bucket = votesByKey.get(vote.key) || [];
          bucket.push(completedVote);
          votesByKey.set(vote.key, bucket);
          if (bucket.length < 2) return;

          finished = true;
          const winner = chooseWinner(bucket);
          controllers.forEach(controller => controller.abort());
          resolve(winner.extraction);
        })
        .catch(() => {})
        .finally(settleWithoutVote);
    });
  });
}

module.exports = {
  CONFIDENCE_THRESHOLD,
  LeaveAiConsensusError,
  extractLeaveMessage,
  __test__: {
    buildVote,
    chooseWinner,
    dateKey
  }
};
