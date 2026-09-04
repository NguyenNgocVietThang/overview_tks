'use strict';

const employeeDirectory = require('../hr/employeeDirectory');
const effectiveUserResolver = require('../auth/effectiveUserResolver');
const hrLeaveRepository = require('../hr/hrLeaveRepository');

class TelegramIdentityError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'TelegramIdentityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createTelegramIdentityService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
  const resolver = options.resolver || effectiveUserResolver;
  const linkRepository = options.linkRepository || hrLeaveRepository;

  async function ensureLinkForUser(user, telegramUsername = '') {
    if (!user || !user.hrManaged) return null;
    const snapshot = await directory.getSnapshot();
    const employee = findEmployeeByIdentifier(snapshot.employees, {
      email: user.email,
      phone: user.soDienThoai
    });
    if (!employee || !employee.telegramId) return null;
    return linkRepository.upsertAutomaticLink({
      userId: user.id,
      webUsername: user.username || user.email || user.soDienThoai,
      chatId: employee.telegramId,
      telegramUsername
    }, employee.sourceBranch);
  }

  async function resolveChat(chatId, telegramUsername = '') {
    const normalizedChatId = String(chatId || '').trim();
    const snapshot = await directory.getSnapshot();
    const matches = snapshot.employees.filter(employee => String(employee.telegramId || '') === normalizedChatId);
    if (matches.length > 1) {
      throw new TelegramIdentityError('Telegram ID xuất hiện ở nhiều dòng nhân sự.', 'TELEGRAM_ID_CONFLICT');
    }
    if (!matches.length) return { status: 'not_found' };
    const employee = matches[0];
    const account = await resolver.findAccountForEmployee(employee);
    if (!account) return { status: 'account_required', employee, sourceBranch: employee.sourceBranch };
    const user = await resolver.resolveUser(account);
    const link = await linkRepository.upsertAutomaticLink({
      userId: user.id,
      webUsername: user.username || user.email || user.soDienThoai,
      chatId: normalizedChatId,
      telegramUsername
    }, employee.sourceBranch);
    return { status: 'linked', employee, user, link, sourceBranch: employee.sourceBranch };
  }

  return { ensureLinkForUser, resolveChat };
}

const defaultService = createTelegramIdentityService();

module.exports = {
  TelegramIdentityError,
  createTelegramIdentityService,
  ensureLinkForUser: defaultService.ensureLinkForUser,
  resolveChat: defaultService.resolveChat
};

