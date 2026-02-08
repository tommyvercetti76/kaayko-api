/**
 * Email Notification Service
 * Sends email notifications for Smart Links events.
 * Uses SendGrid for production, console log for development.
 *
 * @module services/emailNotificationService
 */

const { defineString } = require('firebase-functions/params');
const { buildLinkCreatedEmail } = require('./emailTemplates');

// Email configuration
const ADMIN_EMAIL = 'rohan@kaayko.com';
const FROM_EMAIL = 'noreply@kaayko.com';

// SendGrid API key (lazy-loaded Firebase param)
const sendGridApiKey = defineString('SENDGRID_API_KEY', { default: '' });

/**
 * Send email notification when a new link is created
 * @param {Object} link - Created link object
 * @param {Object} creator - User who created the link
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendLinkCreatedNotification(link, creator) {
  try {
    const { subject, htmlBody, textBody } = buildLinkCreatedEmail(link, creator);
    return await sendEmail({ to: ADMIN_EMAIL, from: FROM_EMAIL, subject, htmlBody, textBody });
  } catch (error) {
    console.error('❌ Failed to send link creation notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email using available service (SendGrid or console log for dev)
 * @private
 */
async function sendEmail({ to, from, subject, htmlBody, textBody }) {
  const apiKey = sendGridApiKey.value();

  // Production: Use SendGrid
  if (apiKey && apiKey.length > 0) {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(apiKey);
      const [response] = await sgMail.send({ to, from, subject, text: textBody, html: htmlBody });
      console.log('✅ Email sent via SendGrid:', { to, subject, statusCode: response.statusCode });
      return { success: true, messageId: response.headers['x-message-id'], provider: 'sendgrid' };
    } catch (error) {
      console.error('❌ SendGrid send failed:', error);
      throw error;
    }
  }

  // Development/Fallback: Log to console
  console.log('\n' + '='.repeat(80));
  console.log('📧 EMAIL NOTIFICATION (Development Mode)');
  console.log('='.repeat(80));
  console.log('To:', to, '\nFrom:', from, '\nSubject:', subject);
  console.log('-'.repeat(80));
  console.log('Text Body:', textBody);
  console.log('='.repeat(80) + '\n');

  return { success: true, messageId: `dev-${Date.now()}`, provider: 'console-log' };
}

module.exports = { sendLinkCreatedNotification };
