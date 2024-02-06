function notFound(req, res, next) {
  res.status(404);
  res.send('Not found')
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  /* eslint-enable no-unused-vars */
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode);
  res.send('Not found')
}

module.exports = {
  notFound,
  errorHandler
};
