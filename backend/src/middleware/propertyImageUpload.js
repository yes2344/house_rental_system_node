import multer from 'multer';
import { ApiError } from '../errors.js';

const parseMultipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fields: 2,
    parts: 3,
    fieldNameSize: 100,
    fieldSize: 2048,
  },
}).single('image');

export function propertyImageUpload(request, response, next) {
  request.uploadStage = 'multipart_parse';
  parseMultipart(request, response, (error) => {
    if (!error) {
      request.uploadFileCount = request.file ? 1 : 0;
      request.uploadFileSizeBytes = request.file?.size ?? 0;
      request.uploadStage = 'multipart_validated';
      next();
      return;
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      next(new ApiError(400, 'Upload one image using the image field.'));
      return;
    }
    if (error instanceof multer.MulterError) {
      next(new ApiError(400, 'The image upload request is invalid.'));
      return;
    }
    next(error);
  });
}
