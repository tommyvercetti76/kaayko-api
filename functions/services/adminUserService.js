/**
 * Admin User Management Service
 * 
 * Manages admin users in Firestore with role-based access control
 * 
 * Roles:
 * - super-admin: Full system access, can manage other admins
 * - admin: Full access to content/links, cannot manage admins
 * - editor: Can create/edit content, cannot delete
 * - viewer: Read-only access
 * 
 * Permissions (granular control):
 * - smartlinks:create, smartlinks:read, smartlinks:update, smartlinks:delete
 * - users:create, users:read, users:update, users:delete
 * - analytics:read, settings:update
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

// Role definitions with default permissions
const ROLE_PERMISSIONS = {
  'super-admin': '*', // All permissions
  'admin': [
    'smartlinks:create', 'smartlinks:read', 'smartlinks:update', 'smartlinks:delete',
    'analytics:read', 'qr:create'
  ],
  'editor': [
    'smartlinks:create', 'smartlinks:read', 'smartlinks:update',
    'analytics:read', 'qr:create'
  ],
  'viewer': [
    'smartlinks:read', 'analytics:read'
  ]
};

/**
 * Create or update admin user
 * @param {string} uid - Firebase Auth UID
 * @param {Object} data - User data
 */
async function createAdminUser(uid, data) {
  const {
    email,
    displayName,
    role = 'viewer',
    permissions = null,
    metadata = {}
  } = data;

  // Validate role
  if (!Object.keys(ROLE_PERMISSIONS).includes(role)) {
    throw new Error(`Invalid role: ${role}. Must be one of: ${Object.keys(ROLE_PERMISSIONS).join(', ')}`);
  }

  // Get default permissions for role
  const defaultPermissions = ROLE_PERMISSIONS[role] === '*' 
    ? ['*'] 
    : ROLE_PERMISSIONS[role];

  const userDoc = {
    uid,
    email,
    displayName: displayName || email.split('@')[0],
    role,
    permissions: permissions || defaultPermissions,
    metadata: {
      ...metadata,
      environment: process.env.FUNCTIONS_EMULATOR ? 'local' : 'production'
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: null,
    enabled: true
  };

  await db.collection('admin_users').doc(uid).set(userDoc);

  return {
    uid,
    ...userDoc,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Get admin user by UID
 */
async function getAdminUser(uid) {
  const doc = await db.collection('admin_users').doc(uid).get();
  
  if (!doc.exists) {
    return null;
  }

  return {
    uid: doc.id,
    ...doc.data()
  };
}

/**
 * Get admin user by email
 */
async function getAdminUserByEmail(email) {
  const snapshot = await db.collection('admin_users')
    .where('email', '==', email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return {
    uid: doc.id,
    ...doc.data()
  };
}

/**
 * List all admin users
 */
async function listAdminUsers(filters = {}) {
  let query = db.collection('admin_users');

  if (filters.role) {
    query = query.where('role', '==', filters.role);
  }

  if (filters.enabled !== undefined) {
    query = query.where('enabled', '==', filters.enabled);
  }

  const snapshot = await query.get();

  return snapshot.docs.map(doc => ({
    uid: doc.id,
    ...doc.data()
  }));
}

/**
 * Update admin user
 */
async function updateAdminUser(uid, updates) {
  const userRef = db.collection('admin_users').doc(uid);
  const doc = await userRef.get();

  if (!doc.exists) {
    throw new Error('Admin user not found');
  }

  // Validate role if being updated
  if (updates.role && !Object.keys(ROLE_PERMISSIONS).includes(updates.role)) {
    throw new Error(`Invalid role: ${updates.role}`);
  }

  // Update permissions if role changed
  if (updates.role && !updates.permissions) {
    updates.permissions = ROLE_PERMISSIONS[updates.role] === '*'
      ? ['*']
      : ROLE_PERMISSIONS[updates.role];
  }

  const updateData = {
    ...updates,
    updatedAt: FieldValue.serverTimestamp()
  };

  await userRef.update(updateData);

  const updated = await userRef.get();
  return {
    uid: updated.id,
    ...updated.data()
  };
}

/**
 * Delete admin user (soft delete - just disable)
 */
async function deleteAdminUser(uid) {
  await db.collection('admin_users').doc(uid).update({
    enabled: false,
    deletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { success: true, uid };
}

/**
 * Record user login
 */
async function recordLogin(uid) {
  await db.collection('admin_users').doc(uid).update({
    lastLoginAt: FieldValue.serverTimestamp()
  });
}

/**
 * Check if user has permission
 */
function hasPermission(user, permission) {
  if (!user || !user.permissions) return false;
  
  // Super-admin has all permissions
  if (user.permissions.includes('*')) return true;
  
  // Check specific permission
  return user.permissions.includes(permission);
}

/**
 * Initialize first super-admin user
 * IMPORTANT: Run this once to create your first admin
 */
async function initializeFirstAdmin(email, password) {
  try {
    // Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
      displayName: 'Super Admin'
    });

    // Create admin user record
    await createAdminUser(userRecord.uid, {
      email,
      displayName: 'Super Admin',
      role: 'super-admin',
      metadata: {
        isFirstAdmin: true,
        createdVia: 'initialization'
      }
    });

    console.log('✅ First super-admin created successfully!');
    console.log('   Email:', email);
    console.log('   UID:', userRecord.uid);

    return {
      success: true,
      uid: userRecord.uid,
      email
    };

  } catch (error) {
    console.error('❌ Failed to create first admin:', error.message);
    throw error;
  }
}

module.exports = {
  createAdminUser,
  getAdminUser,
  getAdminUserByEmail,
  listAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  recordLogin,
  hasPermission,
  initializeFirstAdmin,
  ROLE_PERMISSIONS
};
