/**
 * Email Notification Service
 * Sends email notifications for Smart Links events
 * 
 * Uses Firebase Admin SDK with Gmail SMTP or SendGrid for production
 * For development: logs email content to console
 */

const admin = require('firebase-admin');
const { defineString } = require('firebase-functions/params');

// Email configuration
const ADMIN_EMAIL = 'rohan@kaayko.com';
const FROM_EMAIL = 'noreply@kaayko.com';
const APP_NAME = 'Kaayko Smart Links';

// SendGrid API key (optional for production) - LAZY LOAD
let sendGridApiKey;
function getSendGridApiKey() {
  if (!sendGridApiKey) {
    sendGridApiKey = defineString('SENDGRID_API_KEY', { default: '' });
  }
  return sendGridApiKey;
}

/**
 * Send email notification when a new link is created
 * @param {Object} link - The created link object
 * @param {Object} creator - User who created the link (email, uid, role)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendLinkCreatedNotification(link, creator) {
  try {
    const code = link.code || link.shortCode || link.id;
    const shortUrl = link.shortUrl || `https://kaayko.com/l/${code}`;
    const destinations = link.destinations || {};
    
    // Email subject
    const subject = `✅ New Smart Link Created: ${code}`;
    
    // Email body (HTML)
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Montserrat', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
    .header { background: linear-gradient(135deg, #d4af37 0%, #c4961a 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .link-box { background: #f5f5f5; border-left: 4px solid #d4af37; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .short-url { font-size: 18px; font-weight: bold; color: #d4af37; word-break: break-all; }
    .details { margin: 20px 0; }
    .detail-row { padding: 8px 0; border-bottom: 1px solid #eee; }
    .detail-label { font-weight: 600; color: #666; display: inline-block; width: 140px; }
    .detail-value { color: #333; }
    .qr-section { text-align: center; margin: 30px 0; padding: 20px; background: #f9f9f9; border-radius: 8px; }
    .qr-image { max-width: 200px; margin: 10px auto; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #666; font-size: 12px; }
    .btn { display: inline-block; padding: 12px 24px; background: #d4af37; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 5px; }
    .btn:hover { background: #c4961a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔗 New Smart Link Created</h1>
      <p>A new short link has been added to your Kaayko Smart Links system</p>
    </div>
    
    <div class="content">
      <div class="link-box">
        <div style="color: #666; margin-bottom: 5px;">Your Short Link:</div>
        <div class="short-url">${shortUrl}</div>
      </div>
      
      <div class="details">
        <h3 style="color: #d4af37; margin-bottom: 15px;">Link Details</h3>
        
        <div class="detail-row">
          <span class="detail-label">Short Code:</span>
          <span class="detail-value"><strong>${code}</strong></span>
        </div>
        
        ${link.title ? `
        <div class="detail-row">
          <span class="detail-label">Title:</span>
          <span class="detail-value">${escapeHtml(link.title)}</span>
        </div>
        ` : ''}
        
        ${link.description ? `
        <div class="detail-row">
          <span class="detail-label">Description:</span>
          <span class="detail-value">${escapeHtml(link.description)}</span>
        </div>
        ` : ''}
        
        <div class="detail-row">
          <span class="detail-label">Web Destination:</span>
          <span class="detail-value" style="word-break: break-all;">${escapeHtml(destinations.web || 'N/A')}</span>
        </div>
        
        ${destinations.ios ? `
        <div class="detail-row">
          <span class="detail-label">iOS Destination:</span>
          <span class="detail-value" style="word-break: break-all;">${escapeHtml(destinations.ios)}</span>
        </div>
        ` : ''}
        
        ${destinations.android ? `
        <div class="detail-row">
          <span class="detail-label">Android Destination:</span>
          <span class="detail-value" style="word-break: break-all;">${escapeHtml(destinations.android)}</span>
        </div>
        ` : ''}
        
        <div class="detail-row">
          <span class="detail-label">Created By:</span>
          <span class="detail-value">${creator?.email || link.createdBy || 'System'}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="detail-value">${link.enabled !== false ? '✅ Active' : '❌ Disabled'}</span>
        </div>
        
        ${link.expiresAt ? `
        <div class="detail-row">
          <span class="detail-label">Expires:</span>
          <span class="detail-value">${formatDate(link.expiresAt)}</span>
        </div>
        ` : ''}
      </div>
      
      ${link.utm && Object.keys(link.utm).length > 0 ? `
      <div class="details">
        <h3 style="color: #d4af37; margin-bottom: 15px;">UTM Parameters</h3>
        ${Object.entries(link.utm).map(([key, value]) => `
        <div class="detail-row">
          <span class="detail-label">${key}:</span>
          <span class="detail-value">${escapeHtml(value)}</span>
        </div>
        `).join('')}
      </div>
      ` : ''}
      
      <div class="qr-section">
        <h3 style="color: #d4af37; margin-bottom: 10px;">📱 QR Code</h3>
        <p style="color: #666; margin-bottom: 15px;">Scan to access this link instantly</p>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(shortUrl)}" 
             alt="QR Code for ${code}" 
             class="qr-image">
        <div style="margin-top: 15px;">
          <a href="https://api.qrserver.com/v1/create-qr-code/?size=1024x1024&data=${encodeURIComponent(shortUrl)}" 
             class="btn">⬇️ Download High-Res QR</a>
        </div>
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="https://kaayko.com/admin/smartlinks.html" class="btn">🔗 View in Dashboard</a>
        <a href="${shortUrl}" class="btn" style="background: #666;">🔍 Test Link</a>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>${APP_NAME}</strong></p>
      <p>Enterprise Link Management System</p>
      <p style="margin-top: 10px;">This is an automated notification. Please do not reply to this email.</p>
      <p style="color: #999; margin-top: 15px;">
        Questions? Contact support at <a href="mailto:rohan@kaayko.com" style="color: #d4af37;">rohan@kaayko.com</a>
      </p>
    </div>
  </div>
</body>
</html>
    `;
    
    // Plain text version (fallback)
    const textBody = `
New Smart Link Created

Short Link: ${shortUrl}
Code: ${code}
${link.title ? `Title: ${link.title}` : ''}
${link.description ? `Description: ${link.description}` : ''}

Destinations:
- Web: ${destinations.web || 'N/A'}
${destinations.ios ? `- iOS: ${destinations.ios}` : ''}
${destinations.android ? `- Android: ${destinations.android}` : ''}

Created By: ${creator?.email || link.createdBy || 'System'}
Status: ${link.enabled !== false ? 'Active' : 'Disabled'}
${link.expiresAt ? `Expires: ${formatDate(link.expiresAt)}` : ''}

QR Code: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(shortUrl)}

View in Dashboard: https://kaayko.com/admin/smartlinks.html
Test Link: ${shortUrl}

---
${APP_NAME} - Enterprise Link Management System
This is an automated notification.
    `;
    
    // Send email using configured method
    const result = await sendEmail({
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject,
      htmlBody,
      textBody
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ Failed to send link creation notification:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send email using available service (SendGrid, SMTP, or console log for dev)
 * @private
 */
async function sendEmail({ to, from, subject, htmlBody, textBody }) {
  const apiKey = sendGridApiKey.value();
  
  // Production: Use SendGrid
  if (apiKey && apiKey.length > 0) {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(apiKey);
      
      const msg = {
        to,
        from,
        subject,
        text: textBody,
        html: htmlBody
      };
      
      const [response] = await sgMail.send(msg);
      
      console.log('✅ Email sent via SendGrid:', {
        to,
        subject,
        statusCode: response.statusCode,
        messageId: response.headers['x-message-id']
      });
      
      return {
        success: true,
        messageId: response.headers['x-message-id'],
        provider: 'sendgrid'
      };
      
    } catch (error) {
      console.error('❌ SendGrid send failed:', error);
      throw error;
    }
  }
  
  // Development/Fallback: Log to console
  console.log('\n' + '='.repeat(80));
  console.log('📧 EMAIL NOTIFICATION (Development Mode)');
  console.log('='.repeat(80));
  console.log('To:', to);
  console.log('From:', from);
  console.log('Subject:', subject);
  console.log('-'.repeat(80));
  console.log('Text Body:');
  console.log(textBody);
  console.log('='.repeat(80) + '\n');
  
  return {
    success: true,
    messageId: `dev-${Date.now()}`,
    provider: 'console-log'
  };
}

/**
 * HTML escape helper
 * @private
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

/**
 * Format date for email display
 * @private
 */
function formatDate(timestamp) {
  let date;
  if (timestamp._seconds) {
    date = new Date(timestamp._seconds * 1000);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    date = new Date(timestamp);
  }
  
  return date.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles'
  });
}

module.exports = {
  sendLinkCreatedNotification
};
