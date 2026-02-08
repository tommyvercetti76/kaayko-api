/**
 * Firebase Admin Mock — Intercepts firebase-admin before any module loads it.
 *
 * This mock provides:
 * - Firestore: collection/doc/get/set/update/delete/where/orderBy/limit/offset
 * - Auth: verifyIdToken, createUser, updateUser, deleteUser, revokeRefreshTokens, getUser
 * - Storage: bucket().getFiles, bucket().file().getSignedUrl
 * - FieldValue: serverTimestamp, increment, arrayUnion, arrayRemove, delete
 * - Timestamp: fromMillis, now
 *
 * Each mock function returns chainable objects by default.
 * Tests can override behaviour per-test via jest.spyOn or by mutating the exported mocks.
 */

// ─── Firestore mocks ──────────────────────────────────────────

const mockDocData = {};     // docPath → data
const mockCollectionData = {}; // collectionPath → [ { id, data() } ]

const mockDocRef = (path) => ({
  id: path.split('/').pop(),
  path,
  get: jest.fn(async () => {
    const data = mockDocData[path];
    return { exists: !!data, data: () => data || {}, id: path.split('/').pop(), ref: mockDocRef(path) };
  }),
  set: jest.fn(async (data) => { mockDocData[path] = data; }),
  update: jest.fn(async (data) => { mockDocData[path] = { ...mockDocData[path], ...data }; }),
  delete: jest.fn(async () => { delete mockDocData[path]; }),
  collection: jest.fn((sub) => mockCollectionRef(`${path}/${sub}`))
});

const mockQuerySnapshot = (docs = []) => ({
  empty: docs.length === 0,
  size: docs.length,
  docs,
  forEach: (fn) => docs.forEach(fn)
});

const mockCollectionRef = (path) => {
  const ref = {
    doc: jest.fn((id) => mockDocRef(`${path}/${id || 'auto-id-' + Math.random().toString(36).slice(2)}`)),
    add: jest.fn(async (data) => {
      const id = 'auto-' + Math.random().toString(36).slice(2, 10);
      mockDocData[`${path}/${id}`] = data;
      return { id, ...mockDocRef(`${path}/${id}`) };
    }),
    get: jest.fn(async () => {
      const docs = mockCollectionData[path] || [];
      return mockQuerySnapshot(docs);
    }),
    where: jest.fn(() => ref),
    orderBy: jest.fn(() => ref),
    limit: jest.fn(() => ref),
    offset: jest.fn(() => ref),
    startAfter: jest.fn(() => ref),
    select: jest.fn(() => ref),
    count: jest.fn(() => ({ get: jest.fn(async () => ({ data: () => ({ count: 0 }) })) }))
  };
  return ref;
};

const mockFirestore = {
  collection: jest.fn((path) => mockCollectionRef(path)),
  doc: jest.fn((path) => mockDocRef(path)),
  runTransaction: jest.fn(async (fn) => {
    const tx = {
      get: jest.fn(async (ref) => ref.get()),
      set: jest.fn((ref, data) => ref.set(data)),
      update: jest.fn((ref, data) => ref.update(data)),
      delete: jest.fn((ref) => ref.delete())
    };
    return fn(tx);
  }),
  batch: jest.fn(() => ({
    set: jest.fn(), update: jest.fn(), delete: jest.fn(), commit: jest.fn(async () => {})
  }))
};

// ─── Auth mocks ────────────────────────────────────────────────

const mockAuth = {
  verifyIdToken: jest.fn(async (token) => {
    if (token === 'VALID_ADMIN_TOKEN') return { uid: 'admin-uid', email: 'admin@kaayko.com', email_verified: true, auth_time: Date.now() / 1000, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600 };
    if (token === 'VALID_USER_TOKEN') return { uid: 'user-uid', email: 'user@test.com', email_verified: true, auth_time: Date.now() / 1000, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600 };
    if (token === 'VALID_SUPER_ADMIN_TOKEN') return { uid: 'super-admin-uid', email: 'super@kaayko.com', email_verified: true, auth_time: Date.now() / 1000, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600 };
    if (token === 'EXPIRED_TOKEN') { const err = new Error('Token expired'); err.code = 'auth/id-token-expired'; throw err; }
    const err = new Error('Invalid token'); err.code = 'auth/argument-error'; throw err;
  }),
  createUser: jest.fn(async ({ email, password }) => ({ uid: 'new-uid-' + email.split('@')[0], email })),
  updateUser: jest.fn(async () => ({})),
  deleteUser: jest.fn(async () => ({})),
  revokeRefreshTokens: jest.fn(async () => ({})),
  getUser: jest.fn(async (uid) => ({ uid, email: `${uid}@test.com`, displayName: uid, tokensValidAfterTime: new Date().toISOString() }))
};

// ─── Storage mocks ─────────────────────────────────────────────

const mockBucket = {
  name: 'kaaykostore.appspot.com',
  getFiles: jest.fn(async () => [[]]),
  file: jest.fn((name) => ({
    name,
    getSignedUrl: jest.fn(async () => [`https://storage.googleapis.com/${name}?signed`]),
    save: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    createWriteStream: jest.fn(() => {
      const { PassThrough } = require('stream');
      const stream = new PassThrough();
      stream.on('finish', () => {});
      return stream;
    })
  }))
};

// ─── FieldValue & Timestamp ────────────────────────────────────

const FieldValue = {
  serverTimestamp: jest.fn(() => new Date()),
  increment: jest.fn((n) => n),
  arrayUnion: jest.fn((...items) => items),
  arrayRemove: jest.fn((...items) => items),
  delete: jest.fn(() => '__DELETE__')
};

const Timestamp = {
  fromMillis: jest.fn((ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })),
  now: jest.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() }))
};

// ─── Main mock ─────────────────────────────────────────────────

const adminMock = {
  initializeApp: jest.fn(),
  firestore: jest.fn(() => mockFirestore),
  auth: jest.fn(() => mockAuth),
  storage: jest.fn(() => ({ bucket: jest.fn(() => mockBucket) })),
  credential: { cert: jest.fn(), applicationDefault: jest.fn() },
  apps: [{}]
};

// Attach FieldValue/Timestamp to firestore namespace
adminMock.firestore.FieldValue = FieldValue;
adminMock.firestore.Timestamp = Timestamp;

module.exports = adminMock;

// ─── Exported for test manipulation ────────────────────────────

module.exports._mocks = {
  firestore: mockFirestore,
  auth: mockAuth,
  bucket: mockBucket,
  docData: mockDocData,
  collectionData: mockCollectionData,
  FieldValue,
  Timestamp,
  mockDocRef,
  mockCollectionRef,
  mockQuerySnapshot,
  resetAll() {
    Object.keys(mockDocData).forEach(k => delete mockDocData[k]);
    Object.keys(mockCollectionData).forEach(k => delete mockCollectionData[k]);
  }
};
