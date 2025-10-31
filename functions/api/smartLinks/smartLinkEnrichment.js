/**
 * Smart Link Metadata Enrichment
 * Auto-enriches link metadata from Firestore collections
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Auto-enrich metadata from Firestore based on content space
 * @param {string} space - Content space (lake, product, category, etc.)
 * @param {string} linkId - Link identifier
 * @returns {Promise<Object|null>} Enriched metadata or null if not found
 */
async function enrichMetadata(space, linkId) {
  try {
    switch (space) {
      case 'lake':
        return await enrichLakeMetadata(linkId);
      
      case 'product':
        return await enrichProductMetadata(linkId);
      
      case 'category':
        return await enrichCategoryMetadata(linkId);
      
      case 'store':
        return await enrichStoreMetadata();
      
      case 'reads':
        return enrichReadsMetadata(linkId);
      
      default:
        return null;
    }
  } catch (error) {
    console.error(`[Enrichment] Error for ${space}/${linkId}:`, error);
    return null;
  }
}

/**
 * Enrich lake/paddling location metadata
 */
async function enrichLakeMetadata(linkId) {
  const lakeDoc = await db.collection('paddlingOutSpots').doc(linkId).get();
  if (!lakeDoc.exists) return null;
  
  const data = lakeDoc.data();
  return {
    title: data.title || `${linkId} - Paddle Conditions`,
    description: data.subtitle || 'Real-time paddle forecast with ML predictions',
    imageUrl: (data.imgSrc && data.imgSrc[0]) || null,
    type: 'paddling_location',
    customFields: {
      hasParking: data.hasParking || false,
      hasRestrooms: data.hasRestrooms || false,
      youtubeLink: data.youtubeLink || null
    },
    enriched: true
  };
}

/**
 * Enrich product metadata
 */
async function enrichProductMetadata(linkId) {
  // Try by document ID first
  const productDoc = await db.collection('kaaykoproducts').doc(linkId).get();
  
  if (productDoc.exists) {
    const data = productDoc.data();
    return formatProductMetadata(data, linkId);
  }
  
  // Try by productID field
  const snapshot = await db.collection('kaaykoproducts')
    .where('productID', '==', linkId)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const data = snapshot.docs[0].data();
  return formatProductMetadata(data, linkId);
}

/**
 * Format product metadata consistently
 */
function formatProductMetadata(data, linkId) {
  return {
    title: `${data.title || linkId} - $${data.price || '??'}`,
    description: data.description || 'Unique Kaayko apparel - Vote now, pay later',
    imageUrl: (data.imgSrc && data.imgSrc[0]) || null,
    price: data.price ? `$${data.price}` : null,
    votes: data.votes || 0,
    type: 'store_product',
    enriched: true
  };
}

/**
 * Enrich product category metadata
 */
async function enrichCategoryMetadata(linkId) {
  const snapshot = await db.collection('kaaykoproducts')
    .where('tags', 'array-contains', linkId)
    .limit(50)
    .get();
  
  if (snapshot.empty) return null;
  
  const products = snapshot.docs.map(d => d.data());
  const productCount = products.length;
  const prices = products.map(p => parseFloat(p.price || 0)).filter(p => p > 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  
  return {
    title: `${linkId.charAt(0).toUpperCase() + linkId.slice(1)} Collection`,
    description: `${productCount} unique designs${minPrice ? ` starting at $${minPrice}` : ''}`,
    imageUrl: (products[0]?.imgSrc && products[0].imgSrc[0]) || null,
    productCount,
    type: 'product_category',
    enriched: true
  };
}

/**
 * Enrich store homepage metadata
 */
async function enrichStoreMetadata() {
  const snapshot = await db.collection('kaaykoproducts').count().get();
  const productCount = snapshot.data().count;
  
  return {
    title: 'Kaayko Store - Vote Now, Pay Later',
    description: `${productCount} unique designs. Sarcastic T-shirts & paddling apparel.`,
    imageUrl: 'https://kaayko.com/assets/store-hero.jpg',
    productCount,
    type: 'store_catalog',
    enriched: true
  };
}

/**
 * Enrich blog/reads metadata
 * TODO: Implement when blog collection exists
 */
function enrichReadsMetadata(linkId) {
  return {
    title: 'Kaayko Reads - Paddling Stories',
    description: 'Adventures, tips, and insights from the paddling community',
    imageUrl: 'https://kaayko.com/assets/blog-hero.jpg',
    type: 'blog_article',
    enriched: false  // Not implemented yet
  };
}

module.exports = {
  enrichMetadata
};
