export function notFound(_request, response) {
  response.status(404).json({
    error: {
      status_code: 404,
      message: 'Not found.',
      details: {},
    },
  });
}
