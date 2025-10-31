/**
 * Smart Link Default Destinations
 * Generates intelligent default URLs based on content space
 */

/**
 * Generate default destinations for each platform
 * @param {string} space - Content space (lake, product, category, etc.)
 * @param {string} linkId - Link identifier
 * @param {Object} overrides - Optional destination overrides
 * @returns {Object} Destinations object with ios, android, web
 */
function getDefaultDestinations(space, linkId, overrides = {}) {
  const {
    iosDestination,
    androidDestination,
    webDestination
  } = overrides;

  switch (space) {
    case 'lake':
      return {
        ios: iosDestination || `kaayko://paddlingOut?id=${linkId}`,
        android: androidDestination || `kaayko://paddlingOut?id=${linkId}`,
        web: webDestination || `https://kaayko.com/paddlingout.html?id=${linkId}`
      };
    
    case 'product':
      return {
        ios: iosDestination || `kaayko://store?productID=${linkId}`,
        android: androidDestination || `kaayko://store?productID=${linkId}`,
        web: webDestination || `https://kaayko.com/store.html?id=${linkId}`
      };
    
    case 'category':
      return {
        ios: iosDestination || `kaayko://store?category=${linkId}`,
        android: androidDestination || `kaayko://store?category=${linkId}`,
        web: webDestination || `https://kaayko.com/store.html?category=${linkId}`
      };
    
    case 'store':
      return {
        ios: iosDestination || `kaayko://store`,
        android: androidDestination || `kaayko://store`,
        web: webDestination || `https://kaayko.com/store.html`
      };
    
    case 'reads':
      return {
        ios: iosDestination || `kaayko://reads?articleId=${linkId}`,
        android: androidDestination || `kaayko://reads?articleId=${linkId}`,
        web: webDestination || `https://kaayko.com/reads.html?article=${linkId}`
      };
    
    case 'spot':
      return {
        ios: iosDestination || `kaayko://spot?id=${linkId}`,
        android: androidDestination || `kaayko://spot?id=${linkId}`,
        web: webDestination || `https://kaayko.com/spot.html?id=${linkId}`
      };
    
    case 'qr':
      return {
        ios: iosDestination || `kaayko://qr?code=${linkId}`,
        android: androidDestination || `kaayko://qr?code=${linkId}`,
        web: webDestination || `https://kaayko.com/?qr=${linkId}`
      };
    
    case 'promo':
      return {
        ios: iosDestination || `kaayko://promo?code=${linkId}`,
        android: androidDestination || `kaayko://promo?code=${linkId}`,
        web: webDestination || `https://kaayko.com/promo.html?code=${linkId}`
      };
    
    case 'custom':
      return {
        ios: iosDestination || `kaayko://custom/${linkId}`,
        android: androidDestination || `kaayko://custom/${linkId}`,
        web: webDestination || `https://kaayko.com/${linkId}`
      };
    
    default:
      return {
        ios: iosDestination || `kaayko://${space}/${linkId}`,
        android: androidDestination || `kaayko://${space}/${linkId}`,
        web: webDestination || `https://kaayko.com/${space}/${linkId}`
      };
  }
}

/**
 * Get app store URLs for fallback
 * @returns {Object} iOS and Android app store URLs
 */
function getAppStoreURLs() {
  return {
    ios: 'https://apps.apple.com/us/app/kaayko/id123456789',  // TODO: Update with real App Store ID
    android: 'https://play.google.com/store/apps/details?id=com.kaayko.app'  // TODO: Update with real Play Store ID
  };
}

module.exports = {
  getDefaultDestinations,
  getAppStoreURLs
};
