const Joi = require('joi');

const uuidParamSchema = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4', 'uuidv5'] }).required()
});

const schemas = {
  register: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    terms: Joi.any().optional()
  }),
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  emptyBody: Joi.object({}).max(0),
  audit: Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required()
  }),
  apiAudit: Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required()
  }),
  localAudit: Joi.object({
    restaurantName:    Joi.string().trim().min(1).max(200).required(),
    city:              Joi.string().trim().min(1).max(100).required(),
    url:               Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
    metaTitle:         Joi.string().allow('').max(300).optional(),
    metaDescription:   Joi.string().allow('').max(500).optional(),
    h1:                Joi.string().allow('').max(300).optional(),
    h2:                Joi.string().allow('').max(300).optional(),
    wordCount:         Joi.number().integer().min(0).allow('').optional(),
    pageSpeed:         Joi.number().min(0).allow('').optional(),
    googleRating:      Joi.number().min(1).max(5).allow('').optional(),
    reviewCount:       Joi.number().integer().min(0).allow('').optional(),
    hasSchema:         Joi.string().valid('yes','no').optional(),
    compName:          Joi.string().allow('').max(200).optional(),
    compRating:        Joi.number().min(1).max(5).allow('').optional(),
    compReviewCount:   Joi.number().integer().min(0).allow('').optional(),
    compPageSpeed:     Joi.number().min(0).allow('').optional(),
    compWordCount:     Joi.number().integer().min(0).allow('').optional(),
    compMetaTitle:     Joi.string().allow('').max(300).optional(),
    compMetaDescription: Joi.string().allow('').max(500).optional(),
    compHasSchema:     Joi.string().valid('yes','no').optional(),
    sampleReviews:     Joi.string().allow('').max(8000).optional(),
    menuItems:         Joi.string().allow('').max(3000).optional()
  }),
  compare: Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    competitorUrl: Joi.string().uri({ scheme: ['http', 'https'] }).required()
  }),
  scheduledAudit: Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    frequency: Joi.string().valid('daily', 'weekly', 'monthly').default('weekly')
  }),
  forgotPassword: Joi.object({
    email: Joi.string().email().required()
  }),
  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(6).required()
  }),
  paymentVerify: Joi.object({
    razorpay_order_id: Joi.string().required(),
    razorpay_payment_id: Joi.string().required(),
    razorpay_signature: Joi.string().required()
  }),
  apiKeyCreate: Joi.object({
    name: Joi.string().trim().min(1).max(100).default('Default')
  }),
  idParamOnly: {
    params: uuidParamSchema
  },
  updateProfile: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().required()
  }),
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required()
  }),
  deleteAccount: Joi.object({
    confirmPassword: Joi.string().required()
  }),
  chat: Joi.object({
    message: Joi.string().trim().min(1).max(2000).optional(),
    context: Joi.string().trim().max(4000).allow('').optional(),
    image: Joi.object({
      mimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif').required(),
      data: Joi.string().base64().max(6000000).required(),
      name: Joi.string().trim().max(200).allow('').optional()
    }).optional(),
    page: Joi.string().trim().max(200).allow('').optional(),
    history: Joi.array()
      .items(
        Joi.object({
          role: Joi.string().valid('user', 'assistant').required(),
          content: Joi.string().trim().min(1).max(2000).required()
        }).unknown(false)
      )
      .max(20)
      .optional()
  }).or('message', 'image')
};

function normalizeSchemaDefinition(schemaDef) {
  if (!schemaDef) return null;
  if (Joi.isSchema(schemaDef)) {
    return { body: schemaDef };
  }
  return schemaDef;
}

const validate = (schemaName) => (req, res, next) => {
  const schemaDef = normalizeSchemaDefinition(schemas[schemaName]);
  if (!schemaDef) return next();

  const segments = ['body', 'params', 'query'];
  const validationOptions = { abortEarly: false, stripUnknown: true };

  for (const segment of segments) {
    if (!schemaDef[segment]) continue;

    const { error, value } = schemaDef[segment].validate(req[segment], validationOptions);
    if (error) {
      const message = error.details.map((d) => `${segment}.${d.path.join('.') || 'value'} ${d.message.replace(/"/g, '')}`).join(', ');
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message });
      }
      // For form submissions, render a consistent validation error page.
      return res.status(400).render('error', {
        title: 'Validation Error',
        message,
        statusCode: 400,
        user: req.user || null
      });
    }

    req[segment] = value;
  }

  next();
};

module.exports = { validate, schemas };
