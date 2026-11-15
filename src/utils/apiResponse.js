/**
 * Standardized Success Response Helper.
 */
class ApiResponse {
  /**
   * @param {import('express').Response} res
   * @param {number} statusCode
   * @param {string} message
   * @param {*} [data=null]
   * @param {Object} [meta=null]
   */
  static send(res, statusCode = 200, message = "Success", data = null, meta = null) {
    const payload = {
      success: true,
      message,
      data,
    };

    if (meta && Object.keys(meta).length > 0) {
      payload.meta = meta;
    }

    return res.status(statusCode).json(payload);
  }

  static ok(res, message = "Success", data = null, meta = null) {
    return ApiResponse.send(res, 200, message, data, meta);
  }

  static created(res, message = "Resource created successfully", data = null) {
    return ApiResponse.send(res, 201, message, data);
  }

  static noContent(res) {
    return res.status(204).send();
  }
}

module.exports = ApiResponse;
