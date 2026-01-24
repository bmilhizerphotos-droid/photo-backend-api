import { param, query, body, validationResult } from 'express-validator';

// Reusable validators
export const photoIdParam = param('id').isInt({ min: 1 }).withMessage('Invalid photo ID').toInt();
export const albumIdParam = param('id').isInt({ min: 1 }).withMessage('Invalid album ID').toInt();
export const personIdParam = param('id').isInt({ min: 1 }).withMessage('Invalid person ID').toInt();
export const faceIdParam = param('faceId').isInt({ min: 1 }).withMessage('Invalid face ID').toInt();
export const tagIdParam = param('tagId').isInt({ min: 1 }).withMessage('Invalid tag ID').toInt();

export const paginationQuery = [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt()
];

export const photoIdsBody = body('photoIds')
  .isArray({ min: 1 }).withMessage('photoIds must be a non-empty array')
  .custom(ids => ids.every(id => Number.isInteger(id) && id > 0))
  .withMessage('All photoIds must be positive integers');

export const albumNameBody = body('name')
  .trim()
  .notEmpty().withMessage('Album name is required')
  .isLength({ max: 255 }).withMessage('Album name must be 255 characters or less');

export const personNameBody = body('name')
  .trim()
  .notEmpty().withMessage('Person name is required')
  .isLength({ max: 255 }).withMessage('Person name must be 255 characters or less');

export const personIdBody = body('personId')
  .isInt({ min: 1 }).withMessage('Valid personId is required')
  .toInt();

export const photoIdBody = body('photoId')
  .isInt({ min: 1 }).withMessage('Valid photoId is required')
  .toInt();

// Validation result handler middleware
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};
