'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mirror pattern trong userRepository.test.js: require lai module tu dau moi
// lan, ghi de truc tiep phuong thuc can mock — khong dung thu vien mock rieng.
function freshGoogleAuthService({ clientId, verifyIdTokenImpl }) {
  process.env.GOOGLE_CLIENT_ID = clientId === undefined ? 'test-client-id.apps.googleusercontent.com' : clientId;
  delete require.cache[require.resolve('../config')];
  delete require.cache[require.resolve('./googleAuthService')];

  const { OAuth2Client } = require('google-auth-library');
  if (verifyIdTokenImpl) {
    OAuth2Client.prototype.verifyIdToken = verifyIdTokenImpl;
  }

  return require('./googleAuthService');
}

test('verifyGoogleIdToken: token hop le -> tra ve email/name da trim, emailVerified boolean', async () => {
  const googleAuthService = freshGoogleAuthService({
    verifyIdTokenImpl: async function () {
      return {
        getPayload: () => ({
          email: '  User@Gmail.com  ',
          email_verified: true,
          name: '  Nguyễn Văn A  '
        })
      };
    }
  });

  const profile = await googleAuthService.verifyGoogleIdToken('fake-id-token');
  assert.equal(profile.email, 'User@Gmail.com');
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.name, 'Nguyễn Văn A');
});

test('verifyGoogleIdToken: email_verified false -> emailVerified = false (khong throw, de route tu quyet dinh)', async () => {
  const googleAuthService = freshGoogleAuthService({
    verifyIdTokenImpl: async function () {
      return { getPayload: () => ({ email: 'chua-xac-minh@gmail.com', email_verified: false, name: 'A' }) };
    }
  });

  const profile = await googleAuthService.verifyGoogleIdToken('fake-id-token');
  assert.equal(profile.emailVerified, false);
});

test('verifyGoogleIdToken: token gia mao/het han -> throw (khong nuot loi)', async () => {
  const googleAuthService = freshGoogleAuthService({
    verifyIdTokenImpl: async function () {
      throw new Error('Wrong number of segments in token');
    }
  });

  await assert.rejects(() => googleAuthService.verifyGoogleIdToken('token-gia-mao'));
});

test('verifyGoogleIdToken: GOOGLE_CLIENT_ID chua cau hinh -> throw ngay, khong goi Google', async () => {
  const googleAuthService = freshGoogleAuthService({
    clientId: '',
    verifyIdTokenImpl: async function () {
      throw new Error('khong nen goi toi day');
    }
  });

  await assert.rejects(() => googleAuthService.verifyGoogleIdToken('bat-ky-token'));
});
