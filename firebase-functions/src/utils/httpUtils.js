/**
 * Shared HTTP utilities to eliminate code duplication
 * Used across forecast services and APIs
 */
const https = require('https');
const { logger } = require('firebase-functions');

/**
 * Make HTTP request with retry logic and timeout
 * @param {string} url - The URL to request
 * @param {object} options - Request options (method, headers, etc.)
 * @param {number} timeout - Request timeout in milliseconds (default: 30000)
 * @returns {Promise<object>} - Parsed JSON response
 */
function makeRequest(url, options = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(timeout, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

/**
 * Make HTTP request with retry logic
 * @param {string} url - The URL to request
 * @param {object} options - Request options
 * @param {number} retries - Number of retry attempts (default: 3)
 * @param {number} timeout - Request timeout in milliseconds (default: 30000)
 * @returns {Promise<object>} - Parsed JSON response
 */
async function makeRequestWithRetry(url, options = {}, retries = 3, timeout = 30000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`Making request to ${url} (attempt ${attempt}/${retries})`);
            const result = await makeRequest(url, options, timeout);
            logger.info(`✅ Request successful on attempt ${attempt}`);
            return result;
        } catch (error) {
            logger.warn(`❌ Attempt ${attempt}/${retries} failed: ${error.message}`);
            
            if (attempt === retries) {
                throw error;
            }
            
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

module.exports = {
    makeRequest,
    makeRequestWithRetry
};
