const path = require('path');

/**
 * Resolves a stored file path (which may be a public URL-style path) to an absolute path
 * that can be accessed from the filesystem. Supports local uploads/images as well as
 * pre-resolved absolute paths and remote URLs.
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {string} options.filepath
 * @returns {string | null}
 */
function resolveStoragePath({ req, filepath }) {
  if (!filepath || typeof filepath !== 'string') {
    return null;
  }

  if (/^https?:\/\//i.test(filepath)) {
    return filepath;
  }

  const uploadsRoot = req?.app?.locals?.paths?.uploads;
  const imagesRoot = req?.app?.locals?.paths?.imageOutput;
  const publicRoot = req?.app?.locals?.paths?.publicPath;

  if (filepath.startsWith('/uploads/')) {
    if (!uploadsRoot) {
      return null;
    }
    const relative = filepath.replace(/^\/uploads\//, '');
    return path.join(uploadsRoot, relative);
  }

  if (filepath.startsWith('/images/')) {
    if (!imagesRoot) {
      return null;
    }
    const relative = filepath.replace(/^\/images\//, '');
    return path.join(imagesRoot, relative);
  }

  if (path.isAbsolute(filepath)) {
    return filepath;
  }

  if (publicRoot) {
    return path.join(publicRoot, filepath);
  }

  return filepath;
}

module.exports = {
  resolveStoragePath,
};
