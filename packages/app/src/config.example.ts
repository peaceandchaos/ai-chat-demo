// Template for src/config.ts, which is gitignored. Copy this file to
// src/config.ts and set the origin of your chat server.
//
// The app holds no provider credentials. Provider keys stay on the server,
// and the app identifies itself with a device id from the Keychain.

// The chat server's origin. Release builds accept only HTTPS; development
// builds also accept http://localhost and private network addresses.
export const PROXY_BASE_URL = 'https://chat.example.com';
