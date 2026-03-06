// No external dependencies — plain JS validation

const VALID_BRANDS = ['canon', 'sony'];
const VALID_GENRES = [
  'portrait', 'landscape', 'astro', 'wildlife', 'sports',
  'macro', 'indoorlowlight', 'goldenhour', 'street',
  'architecture', 'event', 'travel',
  'food', 'realestate', 'automotive', 'product',
  'concert', 'underwater', 'drone', 'newborn', 'fashion',
];
const VALID_MODES = ['apprentice', 'enthusiast', 'craftsperson', 'professional'];

function validateClassic(body) {
  const errors = [];
  const brand = (body.brand || '').toLowerCase();
  if (!VALID_BRANDS.includes(brand))
    errors.push({ field: 'brand', message: `brand must be one of: ${VALID_BRANDS.join(', ')}` });

  if (typeof body.cameraModel !== 'string' || body.cameraModel.length < 2 || body.cameraModel.length > 120)
    errors.push({ field: 'cameraModel', message: 'cameraModel must be 2-120 chars' });

  if (typeof body.lensName !== 'string' || body.lensName.length < 2 || body.lensName.length > 120)
    errors.push({ field: 'lensName', message: 'lensName must be 2-120 chars' });

  const genre = (body.genre || '').toLowerCase();
  if (!VALID_GENRES.includes(genre))
    errors.push({ field: 'genre', message: `genre must be one of: ${VALID_GENRES.join(', ')}` });

  if (typeof body.condition !== 'string' || body.condition.length < 2 || body.condition.length > 80)
    errors.push({ field: 'condition', message: 'condition must be 2-80 chars' });

  const mode = body.mode || 'apprentice';
  if (!VALID_MODES.includes(mode))
    errors.push({ field: 'mode', message: `mode must be one of: ${VALID_MODES.join(', ')}` });

  if (errors.length) return { ok: false, error: errors[0] };
  return {
    ok: true,
    data: {
      brand,
      cameraModel: body.cameraModel,
      lensName: body.lensName,
      genre,
      condition: body.condition.toUpperCase(),
      mode,
    }
  };
}

function validateSmart(body) {
  const errors = [];

  if (body.brand !== undefined) {
    const brand = (body.brand || '').toLowerCase();
    if (!VALID_BRANDS.includes(brand))
      errors.push({ field: 'brand', message: `brand must be one of: ${VALID_BRANDS.join(', ')}` });
  }
  if (body.cameraModel !== undefined && (typeof body.cameraModel !== 'string' || body.cameraModel.length < 2 || body.cameraModel.length > 120))
    errors.push({ field: 'cameraModel', message: 'cameraModel must be 2-120 chars' });

  if (body.lensName !== undefined && (typeof body.lensName !== 'string' || body.lensName.length < 2 || body.lensName.length > 120))
    errors.push({ field: 'lensName', message: 'lensName must be 2-120 chars' });

  if (!VALID_MODES.includes(body.mode))
    errors.push({ field: 'mode', message: `mode must be one of: ${VALID_MODES.join(', ')}` });

  if (!Array.isArray(body.interests) || body.interests.length < 1 || body.interests.length > 16)
    errors.push({ field: 'interests', message: 'interests must be an array of 1-16 items' });

  if (errors.length) return { ok: false, error: errors[0] };
  return {
    ok: true,
    data: {
      brand: body.brand ? (body.brand || '').toLowerCase() : undefined,
      cameraModel: body.cameraModel,
      lensName: body.lensName,
      mode: body.mode,
      interests: body.interests,
    }
  };
}

// Middleware factory — mirrors the zod-based validate() signature
function validate(schema) {
  return (req, res, next) => {
    const result = schema(req.body);
    if (!result.ok) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.message,
          field: result.error.field,
        }
      });
    }
    req.body = result.data;
    next();
  };
}

// These are passed directly to validate() as the "schema" argument
const ClassicPresetSchema = validateClassic;
const SmartPresetSchema = validateSmart;

module.exports = { validate, ClassicPresetSchema, SmartPresetSchema, VALID_GENRES };

