'use strict';

const employeeDirectory = require('./employeeDirectory');
const hrLeaveRepository = require('./hrLeaveRepository');

function createTelegramLinkService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
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

  return { ensureLinkForUser };
}

const defaultService = createTelegramLinkService();

module.exports = {
  createTelegramLinkService,
  ensureLinkForUser: defaultService.ensureLinkForUser
};
