'use strict';

const {
  computeDurationSessions,
  getSessionStartTime
} = require('./hrLeaveService');

const SESSION_ORDER = ['Sáng', 'Chiều'];
const DEFAULT_NOTICE_HOURS = 10;
const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

class LeaveMessageResolutionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LeaveMessageResolutionError';
    this.code = code;
  }
}

function fail(code) {
  throw new LeaveMessageResolutionError(code);
}

function hasValue(value) {
  return value != null && value !== '';
}

function parseIsoDate(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function normalizeMessageInstant(value) {
  let instant;
  if (value instanceof Date) {
    instant = new Date(value.getTime());
  } else if (typeof value === 'number') {
    const milliseconds = Number.isInteger(value) && Math.abs(value) < 100000000000
      ? value * 1000
      : value;
    instant = new Date(milliseconds);
  } else if (typeof value === 'string') {
    instant = new Date(value);
  } else {
    fail('INVALID_MESSAGE_TIME');
  }
  if (!Number.isFinite(instant.getTime())) fail('INVALID_MESSAGE_TIME');
  return instant;
}

function bangkokDateFromInstant(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
}

function validateSession(session) {
  if (session != null && !SESSION_ORDER.includes(session)) fail('INVALID_SESSION');
}

function nextSession(date, session) {
  const index = SESSION_ORDER.indexOf(session);
  if (index === -1) fail('INVALID_SESSION');
  if (index === 0) return { date: new Date(date), session: SESSION_ORDER[1] };
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  return { date: nextDate, session: SESSION_ORDER[0] };
}

function advanceSessions(date, session, count) {
  let boundary = { date: new Date(date), session };
  for (let index = 0; index < count; index += 1) boundary = nextSession(boundary.date, boundary.session);
  return boundary;
}

function getBangkokSessionStartTime(date, session) {
  const localSessionStart = getSessionStartTime(date, session);
  if (!localSessionStart) return null;
  return new Date(Date.UTC(
    localSessionStart.getFullYear(),
    localSessionStart.getMonth(),
    localSessionStart.getDate(),
    localSessionStart.getHours() - 7,
    localSessionStart.getMinutes(),
    localSessionStart.getSeconds(),
    localSessionStart.getMilliseconds()
  ));
}

function normalizeDuration(value, unit) {
  if (!hasValue(value) && !hasValue(unit)) return null;
  if (!hasValue(unit) || !['day', 'session'].includes(unit)) fail('UNSUPPORTED_DURATION_UNIT');
  if (!Number.isInteger(value) || value <= 0) fail('INVALID_DURATION');
  return unit === 'day' ? value * 2 : value;
}

function findFirstSessionAtOrAfterInstant(reference, noticeHours) {
  const hours = noticeHours == null ? DEFAULT_NOTICE_HOURS : noticeHours;
  if (!Number.isFinite(hours) || hours < 0) fail('INVALID_NOTICE_HOURS');
  const threshold = new Date(reference.getTime() + hours * 60 * 60 * 1000);
  let date = bangkokDateFromInstant(threshold);

  for (;;) {
    for (const session of SESSION_ORDER) {
      const sessionStartsAt = getBangkokSessionStartTime(date, session);
      if (sessionStartsAt && sessionStartsAt.getTime() >= threshold.getTime()) {
        return { date: new Date(date), session };
      }
    }
    date = new Date(date);
    date.setDate(date.getDate() + 1);
  }
}

function findFirstSessionAtOrAfter(referenceTime, noticeHours) {
  return findFirstSessionAtOrAfterInstant(normalizeMessageInstant(referenceTime), noticeHours);
}

function resolveLeaveMessage(extracted, messageTime, options = {}) {
  const data = extracted || {};
  if (data.intent !== 'leave_request') fail('NOT_LEAVE_REQUEST');
  if (!Number.isFinite(data.confidence) || data.confidence < 0.75) fail('LOW_CONFIDENCE');
  const messageInstant = normalizeMessageInstant(messageTime);

  validateSession(data.start_session);
  validateSession(data.end_session);

  const hasStartDate = hasValue(data.start_date);
  const hasStartSession = hasValue(data.start_session);
  const hasEndDate = hasValue(data.end_date);
  const hasEndSession = hasValue(data.end_session);
  const startDate = hasStartDate ? parseIsoDate(data.start_date) : null;
  const endDate = hasEndDate ? parseIsoDate(data.end_date) : null;
  if ((hasStartDate && !startDate) || (hasEndDate && !endDate)) fail('INVALID_DATE');
  if (hasEndSession && !hasEndDate) fail('CONTRADICTORY_INTERVAL');
  if (hasEndDate && !hasStartDate) fail('CONTRADICTORY_INTERVAL');

  const durationSessions = normalizeDuration(data.duration_value, data.duration_unit);
  let resolvedStart;
  let resolvedEnd;

  if (hasEndDate) {
    resolvedStart = { date: startDate, session: data.start_session || SESSION_ORDER[0] };
    resolvedEnd = { date: endDate, session: data.end_session || SESSION_ORDER[1] };
    const explicitTotal = computeDurationSessions(
      resolvedStart.date, resolvedStart.session, resolvedEnd.date, resolvedEnd.session
    );
    if (explicitTotal == null) fail('CONTRADICTORY_INTERVAL');
    if (durationSessions != null && durationSessions !== explicitTotal) fail('CONTRADICTORY_INTERVAL');
  } else if (hasStartDate || hasStartSession) {
    resolvedStart = {
      date: startDate || bangkokDateFromInstant(messageInstant),
      session: data.start_session || SESSION_ORDER[0]
    };
    resolvedEnd = durationSessions == null
      ? { date: new Date(resolvedStart.date), session: hasStartSession ? resolvedStart.session : SESSION_ORDER[1] }
      : advanceSessions(resolvedStart.date, resolvedStart.session, durationSessions - 1);
  } else if (durationSessions != null) {
    resolvedStart = findFirstSessionAtOrAfterInstant(messageInstant, options.noticeHours);
    resolvedEnd = advanceSessions(resolvedStart.date, resolvedStart.session, durationSessions - 1);
  } else {
    fail('MISSING_LEAVE_INTERVAL');
  }

  const totalSessions = computeDurationSessions(
    resolvedStart.date, resolvedStart.session, resolvedEnd.date, resolvedEnd.session
  );
  if (totalSessions == null) fail('CONTRADICTORY_INTERVAL');

  return {
    startDate: resolvedStart.date,
    startSession: resolvedStart.session,
    endDate: resolvedEnd.date,
    endSession: resolvedEnd.session,
    totalSessions,
    reason: data.reason == null ? '' : String(data.reason),
    handover: data.handover == null ? '' : String(data.handover)
  };
}

module.exports = {
  LeaveMessageResolutionError,
  SESSION_ORDER,
  getBangkokSessionStartTime,
  findFirstSessionAtOrAfter,
  resolveLeaveMessage
};
